// Tests for the refresh round: existing data kept, bounded concurrency,
// slow and failing quotes, stale data, overlapping refreshes, and independence from logos.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { Watchlist, YAHOO_CONCURRENCY, YAHOO_SPACING_MS } from "../watchlist.js";
import { LogoCache } from "../logocache.js";

const chart = (symbol, price) => JSON.stringify({ chart: { result: [{ meta: {
  symbol, regularMarketPrice: price, regularMarketTime: 1_794_862_800, previousClose: price - 1, currency: "USD",
} }], error: null } });
const ticker = (price) => JSON.stringify([{ symbol: "BTCUSDT", lastPrice: String(price), prevClosePrice: "64000", closeTime: 1_794_862_800_000 }]);

// A host with a virtual clock. `respond(url, n)` returns { status, body, delay } (delay in virtual ms);
// requests and the number in flight are recorded.
function host(symbols, respond) {
  const h = { clock: 0, timers: [], requests: [], inflight: 0, maxInflight: 0, maxYahoo: 0, yahooNow: 0, starts: [] };
  let stored = { version: 1, symbols: [...symbols], paused: false };
  h.at = (ms) => new Promise((resolve) => h.timers.push({ at: h.clock + ms, resolve }));
  h.api = {
    load: () => stored,
    save: (p) => { stored = p; },
    now: () => h.clock,
    sleep: (ms) => h.at(ms),
    changed: () => {},
    fetch: async (url) => {
      const yahoo = url.includes("yahoo");
      h.requests.push(url);
      if (yahoo) { h.starts.push(h.clock); h.yahooNow++; h.maxYahoo = Math.max(h.maxYahoo, h.yahooNow); }
      h.inflight++; h.maxInflight = Math.max(h.maxInflight, h.inflight);
      const r = respond(url, h.requests.length);
      await h.at(r.delay ?? 100);
      h.inflight--; if (yahoo) h.yahooNow--;
      if (r.throws) throw new Error("network down");
      return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, text: async () => r.body ?? "" };
    },
  };
  // Runs virtual time until `promise` settles.
  h.run = async (promise) => {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 10_000 && !done; i++) {
      await new Promise((r) => setImmediate(r));
      if (done) break;
      h.timers.sort((a, b) => a.at - b.at);
      const next = h.timers.shift();
      if (!next) continue;
      h.clock = Math.max(h.clock, next.at);
      next.resolve();
    }
    return promise;
  };
  return h;
}
const sym = (url) => decodeURIComponent(url.split("/chart/")[1]?.split("?")[0] ?? "");
const ok = (url, price = 10) => (url.includes("binance") ? { body: url.includes("klines") ? "[]" : ticker(65000) } : { body: chart(sym(url), price) });

test("a refresh keeps every existing value visible until its new one arrives", async () => {
  const h = host(["AAA", "BBB", "CCC"], (url) => ({ ...ok(url, 20), delay: 400 }));
  const w = new Watchlist(h.api);
  for (const s of ["AAA", "BBB", "CCC"]) w.quotes[s] = { symbol: s, price: 10, fetchedAt: 1 };
  let sawGap = false;
  h.api.changed = () => { for (const s of ["AAA", "BBB", "CCC"]) if (!w.quotes[s]) sawGap = true; };
  await h.run(w.round(true));
  assert.equal(sawGap, false, "no row ever lost its value mid-refresh");
  for (const s of ["AAA", "BBB", "CCC"]) assert.equal(w.quotes[s].price, 20);
  assert.equal(w.inflight.size, 0, "nothing left marked as updating");
});

test("Yahoo: at most YAHOO_CONCURRENCY in flight, starts at least YAHOO_SPACING_MS apart; Binance alongside", async () => {
  const symbols = ["BTC/USDT", "A", "B", "C", "D", "E", "F"];
  const h = host(symbols, (url) => ({ ...ok(url), delay: url.includes("binance") ? 50 : 900 }));
  const w = new Watchlist(h.api);
  await h.run(w.round(true));
  assert.equal(h.maxYahoo, YAHOO_CONCURRENCY);
  for (let i = 1; i < h.starts.length; i++) assert.ok(h.starts[i] - h.starts[i - 1] >= YAHOO_SPACING_MS, `start ${i}`);
  assert.equal(h.requests.filter((u) => u.includes("yahoo")).length, 6);
  assert.ok(h.requests.findIndex((u) => u.includes("yahoo")) < h.requests.findIndex((u) => u.includes("klines")),
    "Yahoo did not wait for Binance's line");
  for (const s of symbols) assert.ok(w.quotes[s], s);
});

test("a slow quote doesn't hold the others, and is marked updating meanwhile", async () => {
  const h = host(["FAST1", "SLOW", "FAST2"], (url) => ({ ...ok(url, 30), delay: sym(url) === "SLOW" ? 20_000 : 100 }));
  const w = new Watchlist(h.api);
  w.quotes.SLOW = { symbol: "SLOW", price: 5, fetchedAt: 1 };
  const round = w.round(true);
  let check;
  h.api.changed = () => { if (!check && w.quotes.FAST2) check = { slowUpdating: w.inflight.has("SLOW"), slowPrice: w.quotes.SLOW.price, fast1: Boolean(w.quotes.FAST1) }; };
  await h.run(round);
  assert.deepEqual(check, { slowUpdating: true, slowPrice: 5, fast1: true }, "FAST2 landed while SLOW still showed its old value, updating");
  assert.equal(w.quotes.SLOW.price, 30);
});

test("a failing quote keeps its last value, with its last update time, and is not 'Waiting'", async () => {
  const h = host(["OK", "BAD"], (url) => (sym(url) === "BAD" ? { throws: true } : ok(url, 11)));
  const w = new Watchlist(h.api);
  w.quotes.BAD = { symbol: "BAD", price: 7, fetchedAt: 123 };
  await h.run(w.round(true));
  assert.equal(w.quotes.BAD.price, 7, "the last value stays");
  assert.equal(w.quotes.BAD.fetchedAt, 123, "with its own (old) time, for the stale label");
  assert.equal(w.errors.BAD, "Could not reach Yahoo Finance.");
  assert.equal(w.quotes.OK.price, 11);
  assert.equal(w.errors.OK, undefined);
});

test("a 429 stops further Yahoo requests, defers the rest, keeps their values and backs off; crypto continues", async () => {
  const h = host(["BTC/USDT", "A", "B", "C", "D"], (url) => (url.includes("binance") ? ok(url) : { status: 429, delay: 100 }));
  const w = new Watchlist(h.api);
  for (const s of ["C", "D"]) w.quotes[s] = { symbol: s, price: 3, fetchedAt: 1 };
  await h.run(w.round(true));
  const yahoo = h.requests.filter((u) => u.includes("yahoo")).length;
  assert.ok(yahoo <= YAHOO_CONCURRENCY, `only what was already in flight went out (${yahoo})`);
  assert.match(w.errors.C, /deferred/);
  assert.match(w.errors.D, /deferred/);
  assert.equal(w.quotes.C.price, 3, "deferred rows keep their value");
  assert.ok(w.retryAt >= 60_000);
  assert.ok(w.quotes["BTC/USDT"], "Binance refreshed regardless");
  // The next round inside the cooldown sends nothing to Yahoo.
  const before = h.requests.filter((u) => u.includes("yahoo")).length;
  await h.run(w.round(true));
  assert.equal(h.requests.filter((u) => u.includes("yahoo")).length, before);
  assert.match(w.message, /Retry after/);
});

test("an older response never overwrites a newer state: a round outdated by an edit discards its late results", async () => {
  const h = host(["AAA", "BBB"], (url) => ({ ...ok(url, 99), delay: 5_000 }));
  const w = new Watchlist(h.api);
  w.quotes.AAA = { symbol: "AAA", price: 1, fetchedAt: 1 };
  const stale = w.round(true);
  await new Promise((r) => setImmediate(r));
  w.add("CCC"); // revision bump: the round in flight is outdated
  await h.run(stale);
  assert.equal(w.quotes.AAA.price, 1, "the late response of the outdated round was dropped");
  await h.run(w.round(true));
  assert.equal(w.quotes.AAA.price, 99, "a current round applies its own");
});

test("refreshes never overlap: Refresh during a round queues one more round, not a parallel one", async () => {
  const h = host(["AAA", "BBB"], (url) => ({ ...ok(url), delay: 300 }));
  const w = new Watchlist(h.api, 60_000);
  let rounds = 0;
  let maxRounds = 0;
  const real = w.round.bind(w);
  w.round = async (m) => { rounds++; maxRounds = Math.max(maxRounds, rounds); try { return await real(m); } finally { rounds--; } };
  const loop = w.run();
  await new Promise((r) => setImmediate(r));
  w.refreshNow(); w.refreshNow(); w.refreshNow();
  for (let i = 0; i < 40; i++) { await new Promise((r) => setImmediate(r)); h.timers.sort((a, b) => a.at - b.at); const t = h.timers.shift(); if (!t) break; if (t.at > 30_000) { h.timers.unshift(t); break; } h.clock = Math.max(h.clock, t.at); t.resolve(); }
  w.stop();
  for (const t of h.timers.splice(0)) t.resolve();
  await loop;
  assert.equal(maxRounds, 1, "never two rounds at once");
  assert.ok(h.requests.length <= 6, `three clicks during a round led to at most one more round (${h.requests.length} requests)`);
});

test("after a reload, saved quotes are shown at once; only never-fetched rows wait", () => {
  const h = host(["AAA", "BBB", "NEW"], ok);
  const w = new Watchlist(h.api);
  const n = w.restore({
    AAA: { symbol: "AAA", price: 10, fetchedAt: 5 },
    BBB: { symbol: "BBB", price: 0, fetchedAt: 5 },      // invalid price: not restored
    GONE: { symbol: "GONE", price: 3, fetchedAt: 5 },    // no longer on the list
    NEW: { symbol: "OTHER", price: 3, fetchedAt: 5 },    // mismatched record
  });
  assert.equal(n, 1);
  assert.deepEqual(Object.keys(w.quotes), ["AAA"]);
  assert.equal(w.quotes.AAA.fetchedAt, 5, "keeps its own time, so it reads as old until refreshed");
  assert.equal(w.restore(null), 0);
  assert.equal(w.restore("junk"), 0);
});

test("a hanging or failing logo download never touches quote refreshing", async () => {
  const h = host(["INTR"], (url) => ok(url, 4));
  const w = new Watchlist(h.api);
  const logos = new LogoCache({
    dir: "/c", rel: "c", now: () => 0, readText: async () => null, readFile: async () => new Uint8Array(0),
    writeFile: async () => {}, copyFile: async () => {}, exists: async () => false, mkdir: async () => {}, unlink: async () => {},
    download: () => new Promise(() => {}), // never answers
  });
  await logos.load();
  const pending = logos.refresh("INTR");
  await h.run(w.round(true));
  assert.equal(w.quotes.INTR.price, 4, "the quote arrived while the logo download hangs");
  assert.equal(logos.pathFor("INTR"), null, "the row keeps its monogram meanwhile");
  void pending;
});

test("each round first hands its symbols to beforeRound (logos), without waiting for it", async () => {
  const h = host(["AAA", "BTC/USDT"], (url) => ok(url, 8));
  const order = [];
  h.api.beforeRound = (symbols) => { order.push(`before:${symbols.join(",")}`); return new Promise(() => {}); }; // never settles
  const realFetch = h.api.fetch;
  h.api.fetch = (url) => { order.push("request"); return realFetch(url); };
  const w = new Watchlist(h.api);
  await h.run(w.round(true));
  assert.equal(order[0], "before:AAA,BTC/USDT", "logos start before the first quote request");
  assert.ok(order.includes("request"));
  assert.equal(w.quotes.AAA.price, 8, "quotes didn't wait for the logo work");
});

test("a throwing beforeRound never stops the quotes", async () => {
  const h = host(["AAA"], (url) => ok(url, 9));
  h.api.beforeRound = () => { throw new Error("logo trouble"); };
  const w = new Watchlist(h.api);
  await h.run(w.round(true));
  assert.equal(w.quotes.AAA.price, 9);
});

test("adding a ticker starts a round that hands the new symbol to beforeRound", async () => {
  const h = host(["AAA"], (url) => ok(url, 1));
  const seen = [];
  h.api.beforeRound = (symbols) => seen.push([...symbols]);
  const w = new Watchlist(h.api, 60_000);
  const loop = w.run();
  for (let i = 0; i < 20; i++) { await new Promise((r) => setImmediate(r)); h.timers.sort((a, b) => a.at - b.at); const t = h.timers.shift(); if (!t || t.at > 10_000) { if (t) h.timers.unshift(t); break; } h.clock = Math.max(h.clock, t.at); t.resolve(); }
  w.add("NEW");
  for (let i = 0; i < 20; i++) { await new Promise((r) => setImmediate(r)); h.timers.sort((a, b) => a.at - b.at); const t = h.timers.shift(); if (!t || t.at > 20_000) { if (t) h.timers.unshift(t); break; } h.clock = Math.max(h.clock, t.at); t.resolve(); }
  w.stop();
  for (const t of h.timers.splice(0)) t.resolve();
  await loop;
  assert.deepEqual(seen.at(-1), ["AAA", "NEW"], "the round right after the add includes the new ticker, without waiting 60 s");
  assert.ok(h.clock < 60_000);
});

test("beforeQuote fires right before each symbol's own request, marked manual only for Refresh", async () => {
  for (const manual of [true, false]) {
    const h = host(["AAA", "BBB", "BTC/USDT"], (url) => ok(url, 2));
    const events = [];
    h.api.beforeQuote = (symbol, isManual) => events.push(`logo:${symbol}:${isManual}`);
    const realFetch = h.api.fetch;
    h.api.fetch = (url) => {
      events.push(url.includes("binance") ? (url.includes("klines") ? "line:BTC/USDT" : "quote:BTC/USDT") : `quote:${sym(url)}`);
      return realFetch(url);
    };
    const w = new Watchlist(h.api);
    await h.run(w.round(manual));
    for (const s of ["AAA", "BBB", "BTC/USDT"]) {
      const logo = events.indexOf(`logo:${s}:${manual}`);
      const quote = events.indexOf(`quote:${s}`);
      assert.ok(logo >= 0 && quote > logo, `${s}: logo queued just before its quote (manual=${manual})`);
    }
    assert.ok(events.indexOf("logo:BBB:" + manual) > events.indexOf("quote:AAA"), "one at a time, in quote order: BBB's turn comes after AAA's request");
    assert.equal(w.quotes.AAA.price, 2, "quotes unaffected");
  }
});

test("a throwing beforeQuote never stops a quote", async () => {
  const h = host(["AAA"], (url) => ok(url, 5));
  h.api.beforeQuote = () => { throw new Error("logo trouble"); };
  const w = new Watchlist(h.api);
  await h.run(w.round(true));
  assert.equal(w.quotes.AAA.price, 5);
});
