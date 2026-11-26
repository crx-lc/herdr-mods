// Price history for the
// detail dialog's 1W / 1M / 1Y ranges. No Herdr imports, so `node --test` runs it.
// Same two hosts as quotes.js: Yahoo Finance for stocks and indices, Binance Spot for pairs.
import { BINANCE_KLINES, QuoteError, YAHOO_CHART, cleanVolume, isCryptoPair, normalizeSymbol } from "./quotes.js";
import { UTC_ZONE, yahooTimeZone } from "./readout.js";
import { decodeExtended, extendedUrl } from "./extended.js";

export const RANGES = ["1D", "1W", "1M", "1Y"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_BARS = 400;

/**
 * Per range: the interval asked of each source (chosen so the line stays legible:
 * roughly 60 to 260 points), how long a fetched series is reused, and how far the
 * first / last bar may sit from the window's edges before the period is called partial.
 * Stocks: weekends and holidays mean the first session can start days after the window.
 */
export const RANGE_SPECS = {
  "1W": {
    name: "1 week",
    yahoo: { interval: "30m", label: "30-minute bars", startSlackMs: 4 * DAY, endSlackMs: 5 * DAY },
    binance: { interval: "1h", intervalMs: HOUR, label: "1-hour bars" },
    ttlMs: 5 * MINUTE,
  },
  "1M": {
    name: "1 month",
    yahoo: { interval: "1d", label: "daily bars", startSlackMs: 5 * DAY, endSlackMs: 5 * DAY },
    binance: { interval: "4h", intervalMs: 4 * HOUR, label: "4-hour bars" },
    ttlMs: 30 * MINUTE,
  },
  "1Y": {
    name: "1 year",
    yahoo: { interval: "1d", label: "daily bars", startSlackMs: 7 * DAY, endSlackMs: 5 * DAY },
    binance: { interval: "1d", intervalMs: DAY, label: "daily bars" },
    ttlMs: 3 * HOUR,
  },
};

export const sourceName = (symbol) => (isCryptoPair(symbol) ? "Binance Spot" : "Yahoo Finance");

/** The same local calendar date `months` earlier, clamped to that month's last day (Mar 31 → Feb 28/29). */
export function monthsBefore(now, months) {
  const d = new Date(now);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() - months, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return target.getTime();
}

/** The rolling window a range covers, ending now: 7 calendar days, one calendar month or one calendar year. */
export function rangeWindow(range, now) {
  if (range === "1W") return { start: now - 7 * DAY, end: now };
  if (range === "1M") return { start: monthsBefore(now, 1), end: now };
  if (range === "1Y") return { start: monthsBefore(now, 12), end: now };
  throw new Error(`No history window for ${range}.`);
}

function spec(range) {
  const s = RANGE_SPECS[range];
  if (!s) throw new Error(`No history for ${range}.`);
  return s;
}

export function yahooHistoryUrl(symbol, range, window) {
  const { interval } = spec(range).yahoo;
  return YAHOO_CHART + encodeURIComponent(normalizeSymbol(symbol))
    + `?period1=${Math.floor(window.start / 1000)}&period2=${Math.floor(window.end / 1000)}`
    + `&interval=${interval}&includePrePost=false`;
}

/** The same window in daily bars: a stock's 1W day volumes (its 30-minute volumes don't add up). */
export function yahooDailyUrl(symbol, window) {
  return YAHOO_CHART + encodeURIComponent(normalizeSymbol(symbol))
    + `?period1=${Math.floor(window.start / 1000)}&period2=${Math.floor(window.end / 1000)}&interval=1d&includePrePost=false`;
}

/** The trading day a time falls on, on the exchange's calendar. */
const dayOf = (t, offsetSeconds) => Math.floor((t + offsetSeconds * 1000) / DAY);

/**
 * Yahoo's daily bars as Map(trading day → volume): only days with a volume above zero.
 * Throws QuoteError for an answer that isn't this ticker's daily bars.
 */
export function decodeYahooDayVolumes(symbol, response) {
  if (response.status === 429) throw new QuoteError("Yahoo rate limited requests.", { retryAfterMs: 60_000 });
  if (!response.ok) throw new QuoteError(`Yahoo returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Yahoo returned an unreadable response."); }
  const result = body?.chart?.result?.[0];
  const meta = result?.meta;
  if (body?.chart?.error || !meta) throw new QuoteError("Yahoo returned no daily volume.");
  let returned = null;
  try { returned = typeof meta.symbol === "string" ? normalizeSymbol(meta.symbol) : null; } catch { /* checked below */ }
  if (returned !== symbol) throw new QuoteError("Yahoo returned a different ticker.");
  if (meta.dataGranularity !== "1d") throw new QuoteError("Yahoo returned other bars than daily ones.");
  const offset = typeof meta.gmtoffset === "number" && Number.isFinite(meta.gmtoffset) ? meta.gmtoffset : 0;
  const times = Array.isArray(result.timestamp) ? result.timestamp : [];
  const volumes = result.indicators?.quote?.[0]?.volume ?? [];
  const days = new Map();
  times.forEach((seconds, i) => {
    const volume = cleanVolume(volumes[i]);
    if (positive(seconds) && volume !== null) days.set(dayOf(seconds * 1000, offset), volume);
  });
  return days;
}

/**
 * A 1W stock history with each bar's trading-day volume (`dayVolume`, `day`), drawn as one bar per
 * day. Only when every trading day the line shows has its own day volume; otherwise unchanged.
 */
export function attachDayVolumes(history, days) {
  const keyed = history.bars.map((b) => ({ ...b, day: dayOf(b.t, history.utcOffsetSeconds ?? 0) }));
  if (!keyed.length || !keyed.every((b) => days.has(b.day))) return history;
  return { ...history, bars: keyed.map((b) => ({ ...b, dayVolume: days.get(b.day) })), volumes: true, volumesByDay: true };
}

// How long the 1W day-volume request may take before the dialog gives up on it (the line is already shown).
export const DAY_VOLUME_TIMEOUT_MS = 10_000;

export function binanceHistoryUrl(pair, range, window) {
  const { interval } = spec(range).binance;
  return `${BINANCE_KLINES}?symbol=${encodeURIComponent(pair.replace("/", ""))}&interval=${interval}`
    + `&startTime=${Math.floor(window.start)}&endTime=${Math.floor(window.end)}&limit=1000`;
}

const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Sorted by time, one bar per timestamp, the most recent MAX_BARS. */
function tidy(bars) {
  bars.sort((a, b) => a.t - b.t);
  const out = [];
  for (const bar of bars) if (!out.length || out[out.length - 1].t !== bar.t) out.push(bar);
  return out.length > MAX_BARS ? out.slice(out.length - MAX_BARS) : out;
}

/** A bar keeps its own high/low when present, never inside its close; its volume when trusted, else null. */
function bar(t, close, high, low, volume = null) {
  return {
    t,
    close,
    high: positive(high) ? Math.max(high, close) : close,
    low: positive(low) ? Math.min(low, close) : close,
    volume: cleanVolume(volume),
  };
}

/**
 * Whether a period's volume can be shown: its source's volumes hold up and every bar has its own.
 * One bar without (missing, zero, malformed) and the period shows no volume at all, never a
 * total or bars with a hole that would read as a quiet day.
 */
function withVolumes(history, trusted) {
  return { ...history, volumes: trusted && history.bars.length > 0 && history.bars.every((b) => b.volume !== null) };
}

/** `response` is `{ status, ok, text }` with the body already read. */
export function decodeYahooHistory(symbol, range, response, window) {
  const s = spec(range);
  if (response.status === 429) throw new QuoteError("Yahoo rate limited requests.", { retryAfterMs: 60_000 });
  if (response.status === 404) throw new QuoteError("Ticker not found on Yahoo Finance.");
  if (response.status === 400 || response.status === 422) {
    throw new QuoteError(`Yahoo Finance cannot supply ${s.name} of ${s.yahoo.label} for ${symbol}.`);
  }
  if (!response.ok) throw new QuoteError(`Yahoo returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Yahoo returned an unreadable response."); }
  const result = body?.chart?.result?.[0];
  if (body?.chart?.error || !result?.meta) throw new QuoteError(`Yahoo Finance has no ${s.name} history for ${symbol}.`);
  const meta = result.meta;
  let returned = null;
  try { returned = typeof meta.symbol === "string" ? normalizeSymbol(meta.symbol) : null; } catch { /* checked below */ }
  if (returned !== symbol) throw new QuoteError("Yahoo returned a different ticker.");
  // Yahoo may answer with a coarser interval than asked: say so, never show it as the requested one.
  if (typeof meta.dataGranularity === "string" && meta.dataGranularity !== s.yahoo.interval) {
    throw new QuoteError(`Yahoo Finance returned ${meta.dataGranularity} bars instead of ${s.yahoo.label} for ${s.name}.`);
  }
  const times = Array.isArray(result.timestamp) ? result.timestamp : [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars = [];
  times.forEach((seconds, i) => {
    const close = q.close?.[i];
    if (!positive(seconds) || !positive(close)) return;
    bars.push(bar(seconds * 1000, close, q.high?.[i], q.low?.[i], q.volume?.[i]));
  });
  // Only Yahoo's daily volumes add up (each day's equals its day total); its intraday ones don't
  // (30-minute bars summed to 0.45-0.99 of a past day, several times today's), so 1W has none.
  return withVolumes({
    symbol,
    range,
    source: "Yahoo Finance",
    interval: s.yahoo.label,
    window,
    bars: tidy(bars),
    // Seconds east of UTC for the exchange: sessions are counted on its calendar.
    utcOffsetSeconds: typeof meta.gmtoffset === "number" && Number.isFinite(meta.gmtoffset) ? meta.gmtoffset : 0,
    firstTradeAt: positive(meta.firstTradeDate) ? meta.firstTradeDate * 1000 : null,
    sessions: true,
    // The hover readout: the exchange clock (per trading day when Yahoo gives it), and
    // whether a bar is a whole trading day (shown as a date) or part of one (date and time).
    timeZone: yahooTimeZone(meta),
    daily: s.yahoo.interval === "1d",
  }, s.yahoo.interval === "1d");
}

export function decodeBinanceHistory(pair, range, response, window) {
  const s = spec(range);
  if (response.status === 400) throw new QuoteError("Binance has no Spot pair with this name.");
  if (response.status === 429 || response.status === 418) throw new QuoteError("Binance rate limited requests.", { retryAfterMs: 60_000 });
  if (!response.ok) throw new QuoteError(`Binance returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Binance returned an unreadable response."); }
  if (!Array.isArray(body)) throw new QuoteError("Binance returned an unreadable response.");
  const bars = [];
  for (const k of body) {
    if (!Array.isArray(k)) continue;
    const t = Number(k[0]);
    const close = Number(k[4]);
    if (!positive(t) || !positive(close)) continue;
    // [7]: the kline's volume in the quote currency, as the 1D stat's 24h volume.
    bars.push(bar(t, close, Number(k[2]), Number(k[3]), k[7]));
  }
  return withVolumes({
    symbol: pair,
    range,
    source: "Binance Spot",
    interval: s.binance.label,
    window,
    bars: tidy(bars),
    intervalMs: s.binance.intervalMs,
    sessions: false,
    // Binance klines open on UTC boundaries; a daily kline is a UTC day.
    timeZone: UTC_ZONE,
    daily: s.binance.interval === "1d",
    volumeUnit: pair.split("/")[1],
  }, true);
}

/**
 * What the dialog states about a fetched period, from the bars shown only:
 * change from the first to the last valid close, high and low over those bars,
 * the exchange sessions they span (stocks), and whether the period is partial.
 */
export function summarize(history, now) {
  const bars = history.bars;
  if (!bars.length) return { empty: true };
  const first = bars[0];
  const last = bars[bars.length - 1];
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) { high = Math.max(high, b.high); low = Math.min(low, b.low); }
  const notes = [];
  let startsLate = false;
  if (history.sessions) {
    const s = spec(history.range).yahoo;
    if (history.firstTradeAt && history.firstTradeAt > history.window.start) startsLate = true;
    else if (first.t - history.window.start > s.startSlackMs) startsLate = true;
    if (now - last.t > s.endSlackMs) notes.push("ends");
  } else {
    if (first.t - history.window.start > 2 * history.intervalMs) startsLate = true;
    if (now - last.t > 3 * history.intervalMs) notes.push("ends");
  }
  if (startsLate) notes.unshift("starts");
  const sessions = history.sessions
    ? new Set(bars.map((b) => Math.floor((b.t + history.utcOffsetSeconds * 1000) / DAY))).size
    : null;
  return {
    empty: false,
    points: bars.length,
    first: first.close,
    last: last.close,
    firstAt: first.t,
    lastAt: last.t,
    change: (last.close - first.close) / first.close * 100,
    high,
    low,
    sessions,
    // The period's traded volume (shares, or a pair's quote currency), only when every bar (or, for
    // a stock's 1W, every trading day) has its own.
    volume: !history.volumes ? null : history.volumesByDay
      ? [...new Map(bars.map((b) => [b.day, b.dayVolume])).values()].reduce((sum, v) => sum + v, 0)
      : bars.reduce((sum, b) => sum + b.volume, 0),
    startsLate,
    endsEarly: notes.includes("ends"),
    partial: notes.length > 0,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 17", or "Nov 17, 2025" when not this year (no Intl in Herdr's QuickJS). */
export function formatDay(timestamp, now) {
  const d = new Date(timestamp);
  const year = new Date(now).getFullYear() === d.getFullYear() ? "" : `, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

/**
 * Fetched periods, reused for a while, plus the Yahoo cooldown and spacing.
 * One store is shared by every dialog (see main.js), so switching back to a range,
 * or reopening a ticker, asks again only once its series is older than the range's ttl.
 *
 * host: { fetch(url): Promise<{ status, ok, text }>, now(): number, sleep(ms): Promise<void>,
 *         yahooRetryAt?: number }   // the panel's own Yahoo cooldown, when it has one
 */
export class HistoryStore {
  constructor({ maxEntries = 24, yahooSpacingMs = 1_000 } = {}) {
    this.maxEntries = maxEntries;
    this.yahooSpacingMs = yahooSpacingMs;
    this.entries = new Map();
    this.yahooRetryAt = 0;
    this.yahooFailures = 0;
    this.lastYahooAt = -Infinity;
    this.binanceRetryAt = 0;
  }

  static key(symbol, range) { return `${symbol}|${range}`; }

  /** `{ history, summary, fetchedAt, fresh }` or null. */
  peek(symbol, range, now) {
    const entry = this.entries.get(HistoryStore.key(symbol, range));
    if (!entry) return null;
    return { ...entry, fresh: now - entry.fetchedAt < spec(range).ttlMs };
  }

  /** The cached period while fresh, else one request; throws QuoteError for people. */
  async load(symbol, range, host) {
    const cached = this.peek(symbol, range, host.now());
    if (cached?.fresh) return cached;
    const crypto = isCryptoPair(symbol);
    const now = host.now();
    if (crypto && now < this.binanceRetryAt) {
      throw new QuoteError(`Binance rate limited requests. Retry after ${Math.ceil((this.binanceRetryAt - now) / 1000)}s.`);
    }
    if (!crypto) await this.yahooTurn(host);
    const window = rangeWindow(range, host.now());
    let history;
    try {
      const response = await host.fetch(crypto ? binanceHistoryUrl(symbol, range, window) : yahooHistoryUrl(symbol, range, window));
      history = crypto
        ? decodeBinanceHistory(symbol, range, response, window)
        : decodeYahooHistory(symbol, range, response, window);
    } catch (error) {
      if (error instanceof QuoteError && error.retryAfterMs !== undefined) {
        if (crypto) this.binanceRetryAt = host.now() + error.retryAfterMs;
        else this.yahooLimited(error, host);
      }
      if (error instanceof QuoteError) throw error;
      throw new QuoteError(`Could not reach ${sourceName(symbol)}.`);
    }
    if (!crypto) this.yahooFailures = 0;
    const fetchedAt = host.now();
    const entry = { history, summary: summarize(history, fetchedAt), fetchedAt };
    this.remember(HistoryStore.key(symbol, range), entry);
    return { ...entry, fresh: true };
  }

  remember(key, entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  /** Waits for this store's turn at Yahoo: refuses during a cooldown (its own or the panel's), spaces requests. */
  async yahooTurn(host) {
    const now = host.now();
    const hold = Math.max(this.yahooRetryAt, host.yahooRetryAt ?? 0);
    if (now < hold) throw new QuoteError(`Yahoo rate limited requests. Retry after ${Math.ceil((hold - now) / 1000)}s.`);
    const wait = this.yahooSpacingMs - (now - this.lastYahooAt);
    if (wait > 0) await host.sleep(wait);
    this.lastYahooAt = host.now();
  }

  /** A Yahoo 429: hold Yahoo requests at least 60s, doubling on repeats up to 15 minutes. */
  yahooLimited(error, host) {
    this.yahooFailures++;
    const backoff = Math.min(900_000, 60_000 * 2 ** Math.min(this.yahooFailures - 1, 4));
    this.yahooRetryAt = host.now() + Math.max(backoff, error.retryAfterMs);
  }

  /**
   * A stock's 1W day volumes, after its line is shown: one daily-bar request (`yahooDailyUrl`) against
   * `host.deadline(promise, ms)` (null once ms pass). Tried once per fetched period; any failure
   * leaves the period without volume (and a 429 still holds further Yahoo requests).
   */
  async loadDayVolumes(symbol, range, host) {
    const key = HistoryStore.key(symbol, range);
    const entry = this.entries.get(key);
    if (range !== "1W" || isCryptoPair(symbol) || !entry || entry.dayVolumesTried || entry.history.volumes) return entry ?? null;
    entry.dayVolumesTried = true;
    await this.yahooTurn(host);
    let days;
    try {
      const response = await host.deadline(host.fetch(yahooDailyUrl(symbol, entry.history.window)), DAY_VOLUME_TIMEOUT_MS);
      if (!response) throw new QuoteError("Yahoo gave no daily volume in time.");
      days = decodeYahooDayVolumes(symbol, response);
    } catch (error) {
      if (error instanceof QuoteError && error.retryAfterMs !== undefined) this.yahooLimited(error, host);
      throw error instanceof QuoteError ? error : new QuoteError("Could not reach Yahoo Finance.");
    }
    // The period may have been fetched again meanwhile: attach only to the one asked about.
    if (this.entries.get(key) !== entry) return this.entries.get(key) ?? null;
    const history = attachDayVolumes(entry.history, days);
    const updated = { ...entry, history, summary: summarize(history, entry.fetchedAt) };
    this.remember(key, updated);
    return updated;
  }

  // The 1D extended-hours series and latest pre-market / after-hours price.
  // One Yahoo request per stock, only for markets Yahoo has extended data for, reused for a minute
  // (the panel's own cadence), through the same cooldown and spacing as the ranges.
  peekExtended(symbol, now) {
    const entry = this.entries.get(HistoryStore.key(symbol, "EXT"));
    return entry ? { ...entry, fresh: now - entry.fetchedAt < EXTENDED_TTL_MS } : null;
  }

  async loadExtended(symbol, host) {
    const cached = this.peekExtended(symbol, host.now());
    if (cached?.fresh) return cached;
    await this.yahooTurn(host);
    let data;
    try {
      data = decodeExtended(symbol, await host.fetch(extendedUrl(symbol)), host.now());
    } catch (error) {
      if (error instanceof QuoteError && error.retryAfterMs !== undefined) this.yahooLimited(error, host);
      if (error instanceof QuoteError) throw error;
      throw new QuoteError("Could not reach Yahoo Finance.");
    }
    this.yahooFailures = 0;
    const entry = { data, fetchedAt: host.now() };
    this.remember(HistoryStore.key(symbol, "EXT"), entry);
    return { ...entry, fresh: true };
  }
}

export const EXTENDED_TTL_MS = 60_000;
