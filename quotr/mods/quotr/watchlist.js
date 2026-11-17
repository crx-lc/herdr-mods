// The watchlist and its refresh loop. Herdr's APIs come in through `host`,
// so tests drive it under Node with a fake clock and network.
import {
  BINANCE_BATCH, QuoteError, STARTER_SYMBOLS, binanceKlinesUrl, binanceUrl, decodeBinance, decodeKlinePoints, decodeYahoo,
  isCryptoPair, normalizeSymbol, yahooUrl,
} from "./quotes.js";
// Local customization: the 24-hour line keeps each kline's time (decodeKlinePoints) for the hover readout.

export const INTERVAL_MS = 60_000;
// Stock requests start at least this far apart (upstream: 1,000 ms, one at a time).
// Local customization: two at once, starts 500 ms apart: at most 2 requests a second to Yahoo,
// 9 a round for this watchlist; a 429 still stops the round and backs off as before.
export const YAHOO_SPACING_MS = 500;
export const YAHOO_CONCURRENCY = 2;

export function readPreferences(value) {
  // Nothing saved yet: a starter list, until the first edit saves the person's own.
  if (value === undefined || value === null) return { version: 1, symbols: [...STARTER_SYMBOLS], paused: false };
  const saved = typeof value === "object" ? value : null;
  const symbols = [];
  if (saved?.version === 1 && Array.isArray(saved.symbols)) {
    for (const raw of saved.symbols) {
      if (typeof raw !== "string") continue;
      try {
        const symbol = normalizeSymbol(raw);
        if (!symbols.includes(symbol)) symbols.push(symbol);
      } catch { /* Skip one bad entry, not the whole list. */ }
    }
  }
  return { version: 1, symbols, paused: saved?.version === 1 && saved.paused === true };
}

/**
 * host: {
 *   load(): unknown, save(preferences): void          // the saved watchlist
 *   fetch(url): Promise<{ status, ok, text }>          // GET, body read
 *   now(): number, sleep(ms): Promise<void>
 *   changed(): void                                    // redraw, from the loop only
 * }
 */
export class Watchlist {
  constructor(host, intervalMs = INTERVAL_MS) {
    this.host = host;
    this.intervalMs = intervalMs;
    this.preferences = readPreferences(host.load());
    this.quotes = {};
    this.errors = {};
    this.message = "";
    this.loading = false;
    this.retryAt = 0;
    this.rateFailures = 0;
    this.revision = 0;
    this.stopped = false;
    this.manual = false;
    this.dirty = true;
    this.lastYahooAt = -Infinity;
    this.wake = null;
    // Local customization: rows being refreshed now, and the newest request per symbol.
    this.inflight = new Set();
    this.requestSeq = 0;
    this.latestRequest = {};
  }

  /**
   * Local customization: quotes saved before a reload or restart, shown until fresh ones arrive.
   * Only symbols still on the list, only quotes with a time; their own fetchedAt stays, so they
   * read as old as they are.
   */
  restore(saved) {
    if (!saved || typeof saved !== "object") return 0;
    let n = 0;
    for (const symbol of this.preferences.symbols) {
      const q = saved[symbol];
      if (this.quotes[symbol] || !q || q.symbol !== symbol || !(q.price > 0) || !(q.fetchedAt > 0)) continue;
      this.quotes[symbol] = q;
      n++;
    }
    return n;
  }

  // Edits are synchronous (the store is Herdr's shared state) and return a short notice.
  edit(change) {
    const preferences = readPreferences(this.host.load());
    const message = change(preferences);
    this.host.save(preferences);
    this.adopt(preferences);
    this.revision++;
    this.dirty = true;
    this.poke();
    return message;
  }

  add(input) {
    const symbol = normalizeSymbol(input);
    return this.edit((p) => {
      if (p.symbols.includes(symbol)) return `${symbol} is already on your watchlist.`;
      p.symbols.push(symbol);
      return `Added ${symbol}.`;
    });
  }

  remove(symbol) {
    return this.edit((p) => {
      if (!p.symbols.includes(symbol)) return `${symbol} is not on your watchlist.`;
      p.symbols = p.symbols.filter((s) => s !== symbol);
      return `Removed ${symbol}.`;
    });
  }

  /**
   * Local customization: moves `symbol` to position `to` (0-based, clamped to the list), saved
   * like any edit so every copy follows. Quotes are untouched; nothing is fetched for a move.
   */
  move(symbol, to) {
    // Unlike edit(), a reorder neither wakes the refresh loop nor drops a round in flight:
    // quotes are kept per symbol, so the order changes nothing to fetch.
    const p = readPreferences(this.host.load());
    const from = p.symbols.indexOf(symbol);
    if (from < 0) return `${symbol} is not on your watchlist.`;
    const target = Math.max(0, Math.min(p.symbols.length - 1, Math.trunc(Number(to) || 0)));
    if (target === from) return "";
    p.symbols.splice(from, 1);
    p.symbols.splice(target, 0, symbol);
    this.host.save(p);
    this.adopt(p);
    return `Moved ${symbol} to position ${target + 1}.`;
  }

  pause(paused) {
    return this.edit((p) => {
      p.paused = paused;
      return paused ? "Automatic refresh paused." : "Automatic refresh resumed.";
    });
  }

  /** One round now, also while paused; a Yahoo cooldown still holds for stocks. */
  refreshNow() {
    this.manual = true;
    this.poke();
  }

  stop() {
    this.stopped = true;
    this.revision++;
    this.poke();
  }

  poke() {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** Picks up another copy's edit of the shared list at once (the main view calls it on render). */
  sync() {
    const preferences = readPreferences(this.host.load());
    if (JSON.stringify(preferences) === JSON.stringify(this.preferences)) return false;
    // Local customization: another copy's reorder (same symbols, same pause) needs no new round.
    const same = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
    if (preferences.paused === this.preferences.paused && same(preferences.symbols, this.preferences.symbols)) {
      this.adopt(preferences);
      return true;
    }
    this.adopt(preferences);
    this.revision++;
    this.dirty = true;
    this.poke();
    return true;
  }

  adopt(preferences) {
    this.preferences = preferences;
    const keep = new Set(preferences.symbols);
    for (const record of [this.quotes, this.errors]) {
      for (const key of Object.keys(record)) if (!keep.has(key)) delete record[key];
    }
  }

  /** Runs until stop(). Each round starts the interval after the previous one ends. */
  async run() {
    while (!this.stopped) {
      const manual = this.manual;
      this.manual = false;
      this.dirty = false;
      // Another copy may have edited the shared list.
      this.adopt(readPreferences(this.host.load()));
      const due = manual || (!this.preferences.paused && this.preferences.symbols.length > 0);
      if (due) await this.round(manual);
      if (this.stopped) return;
      this.host.changed();
      if (this.manual || this.dirty) continue;
      const idle = this.preferences.paused || !this.preferences.symbols.length;
      await new Promise((resolve) => {
        this.wake = resolve;
        if (!idle) this.host.sleep(this.intervalMs).then(resolve);
      });
      this.wake = null;
    }
  }

  // Local customization: Binance and Yahoo are different providers, so they refresh side by side;
  // Yahoo through a small pool (YAHOO_CONCURRENCY) whose request starts stay YAHOO_SPACING_MS apart.
  // Existing quotes are never cleared by a refresh: a row keeps its last value until a newer one
  // arrives, and `inflight` says which rows are being updated right now.
  async round(manual) {
    const revision = this.revision;
    const current = () => !this.stopped && revision === this.revision;
    const symbols = this.preferences.symbols;
    this.loading = true;
    this.message = "";
    // Local customization: let the host start side work for this round's symbols (missing logos)
    // without waiting for it: quotes never wait on it.
    try { this.host.beforeRound?.(symbols); } catch { /* side work never stops a round */ }
    this.host.changed();
    try {
      const pairs = symbols.filter(isCryptoPair);
      const tickers = symbols.filter((s) => !isCryptoPair(s));
      const crypto = (async () => {
        for (let i = 0; i < pairs.length && current(); i += BINANCE_BATCH) {
          await this.crypto(pairs.slice(i, i + BINANCE_BATCH), current, manual);
        }
      })();
      await Promise.all([crypto, this.stocks(tickers, current, manual)]);
    } finally {
      for (const s of symbols) this.inflight.delete(s);
      this.loading = false;
    }
  }

  /** Yahoo for `tickers`: cooldown respected, at most YAHOO_CONCURRENCY at once, starts spaced. */
  async stocks(tickers, current, manual = false) {
    if (!tickers.length || !current()) return;
    if (this.host.now() < this.retryAt) {
      // Pairs keep their cadence through a Yahoo cooldown; stocks wait it out.
      this.message = `Yahoo rate limited requests. Retry after ${Math.ceil((this.retryAt - this.host.now()) / 1000)}s.`;
      return;
    }
    const queue = [...tickers];
    const waiting = new Set(); // slot reserved, request not sent yet
    let limited = false;
    const worker = async () => {
      for (;;) {
        const symbol = queue.shift();
        if (symbol === undefined || limited || !current()) return;
        // Reserve this request's start slot before waiting, so workers never start closer than the spacing.
        const now = this.host.now();
        const slot = Math.max(now, this.lastYahooAt + YAHOO_SPACING_MS);
        this.lastYahooAt = slot;
        this.inflight.add(symbol);
        waiting.add(symbol);
        this.host.changed();
        if (slot > now) await this.host.sleep(slot - now);
        waiting.delete(symbol);
        if (limited || !current()) { this.inflight.delete(symbol); return; }
        this.beforeQuote(symbol, manual);
        const seq = ++this.requestSeq;
        this.latestRequest[symbol] = seq;
        try {
          const response = await this.get(yahooUrl(symbol));
          // Only the newest request for this symbol in a still-current round may write its quote.
          if (!current() || this.latestRequest[symbol] !== seq) continue;
          this.quotes[symbol] = decodeYahoo(symbol, response, this.host.now());
          delete this.errors[symbol];
        } catch (error) {
          if (!current() || this.latestRequest[symbol] !== seq) continue;
          this.errors[symbol] = error instanceof QuoteError ? error.message : "Could not reach Yahoo Finance.";
          if (error instanceof QuoteError && error.retryAfterMs !== undefined && !limited) {
            limited = true;
            this.rateFailures++;
            const backoff = Math.min(900_000, 60_000 * 2 ** Math.min(this.rateFailures - 1, 4));
            this.retryAt = this.host.now() + Math.max(backoff, error.retryAfterMs);
            this.message = "Yahoo rate limited requests. Automatic retries are delayed.";
            // Everything not yet sent (queued, or waiting for its slot) is deferred; nothing more goes out.
            for (const rest of [...queue, ...waiting]) this.errors[rest] = "Refresh deferred: Yahoo rate limited requests.";
            for (const rest of waiting) this.inflight.delete(rest);
            queue.length = 0;
          }
        } finally {
          this.inflight.delete(symbol);
          this.host.changed();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(YAHOO_CONCURRENCY, tickers.length) }, worker));
    if (current() && !limited) { this.rateFailures = 0; this.retryAt = 0; }
  }

  /**
   * Local customization: tells the host a symbol's quote request is about to go out (manual: the
   * round came from Refresh). The host may start side work for it (a logo); never waited for.
   */
  beforeQuote(symbol, manual) {
    try { this.host.beforeQuote?.(symbol, manual === true); } catch { /* side work never stops a quote */ }
  }

  async get(url) {
    const response = await this.host.fetch(url);
    return { status: response.status, ok: response.ok, text: await response.text() };
  }

  /** One request per batch; an unknown pair fails the batch, so then ask pair by pair. */
  async crypto(pairs, current, manual = false) {
    const fetchPairs = async (list) => {
      const response = await this.get(binanceUrl(list));
      if (!current()) return;
      const quotes = decodeBinance(list, response, this.host.now());
      for (const pair of list) {
        if (quotes[pair]) {
          // Keep the last line until a new one arrives.
          quotes[pair].series = this.quotes[pair]?.series ?? [];
          quotes[pair].points = this.quotes[pair]?.points ?? [];
          this.quotes[pair] = quotes[pair];
          delete this.errors[pair];
        } else this.errors[pair] = "Binance returned no quote for this pair.";
      }
    };
    const fail = (list, error) => {
      for (const pair of list) this.errors[pair] = error instanceof QuoteError ? error.message : "Could not reach Binance.";
    };
    for (const pair of pairs) this.inflight.add(pair); // local customization: the rows' updating dot
    for (const pair of pairs) this.beforeQuote(pair, manual);
    this.host.changed();
    try {
      await fetchPairs(pairs);
    } catch (error) {
      if (!current()) return;
      if (error instanceof QuoteError && error.invalidSymbol && pairs.length > 1) {
        for (const pair of pairs) {
          if (!current()) return;
          try { await fetchPairs([pair]); } catch (cause) { if (current()) fail([pair], cause); }
        }
      } else fail(pairs, error);
    } finally {
      for (const pair of pairs) this.inflight.delete(pair);
    }
    if (!current()) return;
    this.host.changed();
    // The 24-hour line, one request a pair; a failure only leaves the line as it was.
    for (const pair of pairs) {
      if (!current()) return;
      if (!this.quotes[pair]) continue;
      try {
        const points = decodeKlinePoints(await this.get(binanceKlinesUrl(pair)));
        if (current() && this.quotes[pair]) {
          this.quotes[pair].points = points;
          this.quotes[pair].series = points.map((point) => point.close);
        }
      } catch { /* The quote itself is fine. */ }
    }
    if (current()) this.host.changed();
  }
}
