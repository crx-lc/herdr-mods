// Local customization tests for history.js (1W / 1M / 1Y in the detail dialog).
// Run: node --test "%USERPROFILE%\.config\herdr-app\mods\quotr\.tests"
// The folder is hidden, so Herdr neither loads it nor reloads the mod when it changes.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HistoryStore, RANGES, RANGE_SPECS, binanceHistoryUrl, decodeBinanceHistory, decodeYahooHistory, formatDay,
  monthsBefore, rangeWindow, summarize, yahooHistoryUrl,
} from "../history.js";

const DAY = 86_400_000;
const ok = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const sec = (ms) => Math.floor(ms / 1000);

function yahoo(symbol, { granularity, times = [], close = [], high = [], low = [], gmtoffset = -18000, firstTradeDate } = {}) {
  return ok({
    chart: {
      result: [{
        meta: { symbol, dataGranularity: granularity, gmtoffset, firstTradeDate },
        timestamp: times.map(sec),
        indicators: { quote: [{ close, high, low }] },
      }],
      error: null,
    },
  });
}

test("offers 1D, 1W, 1M and 1Y, with 1D first", () => {
  assert.deepEqual(RANGES, ["1D", "1W", "1M", "1Y"]);
  assert.equal(RANGE_SPECS["1D"], undefined, "1D keeps the quote's own day: no history request");
});

test("windows are 7 calendar days, one calendar month and one calendar year", () => {
  const now = at(2026, 11, 17, 15, 30);
  assert.deepEqual(rangeWindow("1W", now), { start: now - 7 * DAY, end: now });
  assert.equal(rangeWindow("1M", now).start, at(2026, 10, 17, 15, 30));
  assert.equal(rangeWindow("1Y", now).start, at(2025, 11, 17, 15, 30));
  assert.throws(() => rangeWindow("1D", now));
});

test("a month back clamps to the shorter month and crosses the year", () => {
  assert.equal(monthsBefore(at(2026, 3, 31), 1), at(2026, 2, 28));
  assert.equal(monthsBefore(at(2028, 3, 31), 1), at(2028, 2, 29));
  assert.equal(monthsBefore(at(2026, 1, 15), 1), at(2025, 12, 15));
  assert.equal(monthsBefore(at(2028, 2, 29), 12), at(2027, 2, 28));
});

test("asks each source for an interval that keeps the line legible", () => {
  const w = { start: 1_700_000_000_000, end: 1_700_604_800_000 };
  assert.equal(yahooHistoryUrl("^GSPC", "1W", w),
    "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=1700000000&period2=1700604800&interval=30m&includePrePost=false");
  assert.match(yahooHistoryUrl("AAPL", "1M", w), /interval=1d&/);
  assert.match(yahooHistoryUrl("AAPL", "1Y", w), /interval=1d&/);
  assert.equal(binanceHistoryUrl("BTC/USDT", "1W", w),
    "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=1700000000000&endTime=1700604800000&limit=1000");
  assert.match(binanceHistoryUrl("BTC/USDT", "1M", w), /interval=4h&/);
  assert.match(binanceHistoryUrl("BTC/USDT", "1Y", w), /interval=1d&/);
});

test("decodes Yahoo history with each bar's own time, skipping missing bars", () => {
  const now = at(2026, 11, 17, 16);
  const window = rangeWindow("1W", now);
  const t = [now - 6 * DAY, now - 6 * DAY + 1_800_000, now - 3 * DAY, now - 1_800_000];
  const h = decodeYahooHistory("AAPL", "1W", yahoo("AAPL", {
    granularity: "30m", times: t, close: [100, null, 104, 110], high: [101, 999, 103, 112], low: [99, 1, 103.5, 108],
  }), window);
  assert.deepEqual(h.bars.map((b) => b.t), [t[0], t[2], t[3]], "the null close at t[1] is dropped with its time");
  assert.deepEqual(h.bars[1], { t: t[2], close: 104, high: 104, low: 103.5 }, "a high below the close is raised to it");
  assert.equal(h.interval, "30-minute bars");
  assert.equal(h.source, "Yahoo Finance");
});

test("refuses Yahoo answers that are not the requested period", () => {
  const window = rangeWindow("1W", at(2026, 11, 17));
  assert.throws(() => decodeYahooHistory("AAPL", "1W", yahoo("MSFT", { granularity: "30m" }), window), /different ticker/);
  assert.throws(() => decodeYahooHistory("AAPL", "1W", yahoo("AAPL", { granularity: "1d" }), window),
    /returned 1d bars instead of 30-minute bars for 1 week/);
  assert.throws(() => decodeYahooHistory("AAPL", "1W", { status: 422, ok: false, text: "" }, window),
    /cannot supply 1 week of 30-minute bars for AAPL/);
  assert.throws(() => decodeYahooHistory("AAPL", "1W", ok({ chart: { result: null, error: { code: "Not Found" } } }), window),
    /no 1 week history for AAPL/);
  assert.throws(() => decodeYahooHistory("AAPL", "1W", { status: 429, ok: false, text: "" }, window), (e) => e.retryAfterMs === 60_000);
});

test("period change uses the first and last valid points; high and low use the bars' own range", () => {
  const now = at(2026, 11, 17, 16);
  const window = rangeWindow("1M", now);
  const times = [window.start + DAY, window.start + 10 * DAY, now - DAY];
  const s = summarize(decodeYahooHistory("NVDA", "1M", yahoo("NVDA", {
    granularity: "1d", times, close: [200, 150, 180], high: [205, 160, 182], low: [195, 140, 175],
  }), window), now);
  assert.equal(s.first, 200);
  assert.equal(s.last, 180);
  assert.ok(Math.abs(s.change - -10) < 1e-9);
  assert.equal(s.high, 205);
  assert.equal(s.low, 140);
  assert.equal(s.points, 3);
  assert.equal(s.partial, false);
});

test("counts trading sessions on the exchange's calendar, not every calendar day", () => {
  // New York (UTC-5): 14:30Z and 23:30Z on Nov 13 are one session; Nov 14 is another; the weekend has none.
  const now = Date.UTC(2026, 10, 17, 21);
  const window = rangeWindow("1W", now);
  const times = [Date.UTC(2026, 10, 13, 14, 30), Date.UTC(2026, 10, 13, 23, 30), Date.UTC(2026, 10, 14, 14, 30), Date.UTC(2026, 10, 17, 20, 30)];
  const s = summarize(decodeYahooHistory("AAPL", "1W", yahoo("AAPL", {
    granularity: "30m", times, close: [1, 2, 3, 4], gmtoffset: -18000,
  }), window), now);
  assert.equal(s.sessions, 3);
});

test("a period the source only partly covers is marked partial, never complete", () => {
  const now = at(2026, 11, 17, 16);
  const window = rangeWindow("1Y", now);
  // Listed three months ago: Yahoo's firstTradeDate is inside the window.
  const listed = summarize(decodeYahooHistory("NEWCO", "1Y", yahoo("NEWCO", {
    granularity: "1d", times: [now - 90 * DAY, now - DAY], close: [10, 12], firstTradeDate: sec(now - 90 * DAY),
  }), window), now);
  assert.equal(listed.startsLate, true);
  assert.equal(listed.partial, true);
  // No firstTradeDate, but the first bar is far past the window's start.
  const gap = summarize(decodeYahooHistory("OLD", "1Y", yahoo("OLD", {
    granularity: "1d", times: [window.start + 40 * DAY, now - DAY], close: [10, 12],
  }), window), now);
  assert.equal(gap.startsLate, true);
  // Data stops weeks before now: the end is partial too.
  const ended = summarize(decodeYahooHistory("GONE", "1Y", yahoo("GONE", {
    granularity: "1d", times: [window.start + DAY, now - 30 * DAY], close: [10, 12],
  }), window), now);
  assert.equal(ended.endsEarly, true);
  assert.equal(ended.startsLate, false);
  // A weekend before the first 1W session is normal, not partial.
  const weekend = summarize(decodeYahooHistory("AAPL", "1W", yahoo("AAPL", {
    granularity: "30m", times: [window.start + 2 * DAY, now - 3_600_000], close: [10, 12],
  }), window), now);
  assert.equal(weekend.partial, false);
});

test("no bars is an empty period, not a zero change", () => {
  const now = at(2026, 11, 17);
  const s = summarize(decodeYahooHistory("AAPL", "1W", yahoo("AAPL", { granularity: "30m" }), rangeWindow("1W", now)), now);
  assert.deepEqual(s, { empty: true });
});

test("decodes Binance klines and marks a recently listed pair partial", () => {
  const now = at(2026, 11, 17, 16);
  const window = rangeWindow("1W", now);
  const kline = (t, o, h, l, c) => [t, String(o), String(h), String(l), String(c), "0", t + 3_599_999];
  const full = decodeBinanceHistory("BTC/USDT", "1W", ok([
    kline(window.start, 60000, 61000, 59000, 60500), kline(now - 3_600_000, 64000, 65500, 63000, 65000),
  ]), window);
  assert.equal(full.interval, "1-hour bars");
  assert.equal(full.source, "Binance Spot");
  const s = summarize(full, now);
  assert.ok(Math.abs(s.change - (65000 - 60500) / 60500 * 100) < 1e-9);
  assert.equal(s.high, 65500);
  assert.equal(s.low, 59000);
  assert.equal(s.sessions, null);
  assert.equal(s.partial, false);
  const listed = summarize(decodeBinanceHistory("NEW/USDT", "1W", ok([
    kline(now - 2 * DAY, 1, 1.2, 0.9, 1.1), kline(now - 3_600_000, 1.1, 1.3, 1, 1.25),
  ]), window), now);
  assert.equal(listed.startsLate, true);
  assert.throws(() => decodeBinanceHistory("BAD/USDT", "1W", { status: 400, ok: false, text: "" }, window), /no Spot pair/);
});

test("formats days without Intl", () => {
  const now = at(2026, 11, 17);
  assert.equal(formatDay(at(2026, 11, 3), now), "Nov 3");
  assert.equal(formatDay(at(2025, 11, 18), now), "Nov 18, 2025");
});

// A fake host: a clock, a network that records URLs, and a sleep that advances the clock.
function host({ respond, start = at(2026, 11, 17, 16), yahooRetryAt } = {}) {
  const h = {
    clock: start,
    urls: [],
    slept: [],
    now: () => h.clock,
    sleep: async (ms) => { h.slept.push(ms); h.clock += ms; },
    fetch: async (url) => { h.urls.push(url); return respond(url, h.clock); },
    yahooRetryAt,
  };
  return h;
}
const anyYahoo = (url, now) => {
  const symbol = decodeURIComponent(url.match(/chart\/([^?]+)/)[1]);
  const granularity = url.match(/interval=(\w+)/)[1];
  return yahoo(symbol, { granularity, times: [now - 2 * DAY, now - DAY], close: [10, 11] });
};

test("only the open ticker's selected range is fetched, and a fresh period is reused", async () => {
  const store = new HistoryStore();
  const h = host({ respond: anyYahoo });
  await store.load("AAPL", "1W", h);
  await store.load("AAPL", "1M", h);
  await store.load("AAPL", "1W", h); // back to 1W: cached
  await store.load("AAPL", "1M", h); // and 1M: cached
  assert.equal(h.urls.length, 2);
  assert.match(h.urls[0], /AAPL\?.*interval=30m/);
  assert.match(h.urls[1], /AAPL\?.*interval=1d/);
  assert.equal(store.peek("AAPL", "1W", h.clock).fresh, true);
  assert.equal(store.peek("NVDA", "1W", h.clock), null);
});

test("a period older than its range's ttl is fetched again", async () => {
  const store = new HistoryStore();
  const h = host({ respond: anyYahoo });
  await store.load("AAPL", "1W", h);
  h.clock += RANGE_SPECS["1W"].ttlMs + 1;
  assert.equal(store.peek("AAPL", "1W", h.clock).fresh, false, "kept, but stale");
  await store.load("AAPL", "1W", h);
  assert.equal(h.urls.length, 2);
});

test("Yahoo requests are spaced and a 429 holds further Yahoo requests, not Binance", async () => {
  const store = new HistoryStore();
  let limited = true;
  const h = host({
    respond: (url, now) => (url.includes("binance")
      ? ok([[now - 7 * DAY, "1", "1", "1", "1"], [now - 3_600_000, "1", "1", "1", "1"]])
      : limited ? { status: 429, ok: false, text: "" } : anyYahoo(url, now)),
  });
  await store.load("AAPL", "1W", h).catch(() => {});
  await assert.rejects(store.load("AAPL", "1W", h), /rate limited/);
  await assert.rejects(store.load("MSFT", "1M", h), /Retry after \d+s/);
  assert.equal(h.urls.length, 1, "no request while Yahoo cools down");
  await store.load("BTC/USDT", "1W", h);
  assert.equal(h.urls.length, 2, "crypto never waits on Yahoo");
  limited = false;
  h.clock += 60_001;
  await store.load("AAPL", "1W", h);
  assert.equal(h.urls.length, 3);
  await store.load("MSFT", "1W", h);
  assert.ok(h.slept.some((ms) => ms > 0 && ms <= 1_000), "the next Yahoo request waited for the 1s spacing");
});

test("the panel's own Yahoo cooldown is respected", async () => {
  const store = new HistoryStore();
  const h = host({ respond: anyYahoo });
  h.yahooRetryAt = h.clock + 30_000;
  await assert.rejects(store.load("AAPL", "1W", h), /Retry after 30s/);
  assert.equal(h.urls.length, 0);
});

test("a failed request leaves the last good period in place", async () => {
  const store = new HistoryStore();
  let down = false;
  const h = host({ respond: (url, now) => { if (down) throw new Error("offline"); return anyYahoo(url, now); } });
  await store.load("AAPL", "1W", h);
  h.clock += RANGE_SPECS["1W"].ttlMs + 1;
  down = true;
  await assert.rejects(store.load("AAPL", "1W", h), /Could not reach Yahoo Finance/);
  const kept = store.peek("AAPL", "1W", h.clock);
  assert.equal(kept.fresh, false);
  assert.equal(kept.summary.last, 11);
});

test("the cache stays modest", async () => {
  const store = new HistoryStore({ maxEntries: 2, yahooSpacingMs: 0 });
  const h = host({ respond: anyYahoo });
  await store.load("AAPL", "1W", h);
  await store.load("MSFT", "1W", h);
  await store.load("NVDA", "1W", h);
  assert.equal(store.entries.size, 2);
  assert.equal(store.peek("AAPL", "1W", h.clock), null, "the oldest period is dropped");
});
