// Tests for pre-market / after-hours (extended.js and its wiring).
// Fixtures follow the shape of live Yahoo chart responses (range=2d, interval=5m,
// includePrePost=true) checked for INTR, AAPL, NU, 0700.HK, VOD.L, 7203.T and ^GSPC in Nov 2026.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STALE_AFTER_MS, decodeExtended, extendedUrl, sessionAt, sessionBands, sessionHours, sessionPeriods,
} from "../extended.js";
import { formatPointTime, yahooTimeZone } from "../readout.js";
import { decodeYahoo } from "../quotes.js";
import { HistoryStore } from "../history.js";

const ok = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
const s = (ms) => Math.floor(ms / 1000);
const MIN = 60_000;
// New York (EST, UTC-5): pre 04:00–09:30, regular 09:30–16:00, after hours 16:00–20:00.
const day = (y, m, d, off = -18000, tz = "EST", h = { pre: [4, 0], open: [9, 30], close: [16, 0], post: [20, 0] }) => {
  const at = ([hh, mm]) => s(Date.UTC(y, m - 1, d, hh, mm) - off * 1000);
  const p = (a, b) => ({ timezone: tz, start: at(a), end: at(b), gmtoffset: off });
  return { pre: p(h.pre, h.open), regular: p(h.open, h.close), post: p(h.close, h.post) };
};
const MON = day(2026, 11, 16);
const TUE = day(2026, 11, 17);

function response({ symbol = "INTR", days = [MON, TUE], bars = [], regular = 3.96, regularTime = MON.regular.end,
  hasPrePost = true, fulldayPrice, delay, prev = 4.15 } = {}) {
  return ok({ chart: { result: [{
    meta: {
      symbol, regularMarketPrice: regular, regularMarketTime: regularTime, previousClose: prev, chartPreviousClose: prev,
      hasPrePostMarketData: hasPrePost, timezone: "EST", gmtoffset: -18000, exchangeDataDelayedBy: delay, fulldayPrice,
      tradingPeriods: hasPrePost
        ? { pre: days.map((d) => [d.pre]), regular: days.map((d) => [d.regular]), post: days.map((d) => [d.post]) }
        : days.map((d) => [d.regular]),
    },
    timestamp: bars.map(([t]) => t),
    indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
  }], error: null } });
}
// INTR on Tue Nov 17 before the open: Monday's pre, regular and after hours, then Tuesday's pre-market.
const intrBars = [
  [MON.pre.start + 300, 4.0], [MON.pre.end - 300, 4.02],
  [MON.regular.start, 4.03], [MON.regular.start + 3600, 4.0], [MON.regular.end, 3.96],
  [MON.post.start + 300, 3.95], [MON.post.end - 600, 3.96],
  [TUE.pre.start + 3 * 3600 + 1200, 3.98], [TUE.pre.start + 4 * 3600 + 34 * 60, 3.97],
];

test("asks for two days of 5-minute bars with extended hours, so the latest regular session stays", () => {
  assert.equal(extendedUrl("intr"),
    "https://query1.finance.yahoo.com/v8/finance/chart/INTR?interval=5m&range=2d&includePrePost=true");
});

test("sessions come from Yahoo's periods, in both of its shapes", () => {
  const p = sessionPeriods({ tradingPeriods: { pre: [[TUE.pre]], regular: [[TUE.regular]], post: [[TUE.post]] } });
  assert.equal(p.pre.length, 1);
  assert.equal(p.regular[0].start, TUE.regular.start * 1000);
  assert.equal(p.post[0].label, "EST");
  const plain = sessionPeriods({ tradingPeriods: [[TUE.regular]] });
  assert.deepEqual([plain.pre.length, plain.regular.length, plain.post.length], [0, 1, 0]);
  assert.deepEqual(sessionPeriods({}), { pre: [], regular: [], post: [] });
});

test("session boundaries: the open is regular, the closing print is regular, after it is after hours", () => {
  const p = sessionPeriods({ tradingPeriods: { pre: [[TUE.pre]], regular: [[TUE.regular]], post: [[TUE.post]] } });
  const at = (sec) => sessionAt(sec * 1000, p);
  assert.equal(at(TUE.pre.start), "pre");
  assert.equal(at(TUE.regular.start - 300), "pre");
  assert.equal(at(TUE.regular.start), "regular");
  assert.equal(at(TUE.regular.end), "regular", "Yahoo's 16:00 closing print");
  assert.equal(at(TUE.regular.end + 300), "post");
  assert.equal(at(TUE.post.end), "post");
  assert.equal(at(TUE.post.end + 300), null, "outside every period: dropped");
  assert.equal(at(TUE.pre.start - 300), null);
});

test("pre-market: the latest bar's own time and price, changed against the regular close", () => {
  const now = (TUE.pre.start + 4 * 3600 + 40 * 60) * 1000; // 08:40 EST
  const d = decodeExtended("INTR", response({ bars: intrBars, fulldayPrice: 3.97 }), now);
  assert.equal(d.status, "ok");
  assert.equal(d.latest.session, "pre");
  assert.equal(d.latest.price, 3.97);
  assert.equal(d.latest.t, (TUE.pre.start + 4 * 3600 + 34 * 60) * 1000);
  assert.equal(formatPointTime(d.latest.t, d.timeZone, { now }), "Tue, Nov 17, 08:34 EST");
  assert.equal(d.latest.referencePrice, 3.96, "the regular close, not yesterday's quote as the current price");
  assert.equal(d.latest.referenceTime, MON.regular.end * 1000);
  assert.ok(Math.abs(d.latest.change - 0.01) < 1e-9);
  assert.ok(Math.abs(d.latest.changePercent - 0.2525) < 0.001);
  assert.equal(d.latest.open, true);
  assert.equal(d.latest.stale, false, "6 minutes old");
  assert.equal(d.inconsistency, null, "fulldayPrice agrees with the bar");
  assert.equal(d.regular.price, 3.96);
});

test("the 1D line covers the latest regular day from its pre-market, plus the next pre-market", () => {
  const now = (TUE.pre.start + 4 * 3600 + 40 * 60) * 1000;
  const d = decodeExtended("INTR", response({ bars: intrBars }), now);
  assert.deepEqual(d.points.map((p) => p.session), ["pre", "pre", "regular", "regular", "regular", "post", "post", "pre", "pre"]);
  assert.equal(d.points[0].t, (MON.pre.start + 300) * 1000);
  assert.equal(d.windowStart, MON.pre.start * 1000);
  const bands = sessionBands(d.points);
  assert.deepEqual(bands.map((b) => b.session), ["pre", "post", "pre"]);
  assert.equal(bands[0].from, 0);
  assert.equal(bands[2].to, 100);
  assert.ok(bands[0].to < bands[1].from, "the regular stretch between them is unshaded");
});

test("a quiet extended session is marked stale, with the last trade's age", () => {
  const now = (TUE.pre.start + 4 * 3600 + 34 * 60) * 1000 + STALE_AFTER_MS + 6 * MIN;
  const d = decodeExtended("INTR", response({ bars: intrBars }), now);
  assert.equal(d.latest.stale, true);
  assert.equal(Math.round(d.latest.ageMs / MIN), 21);
});

test("after hours the same evening: compared with that day's close", () => {
  const bars = [[TUE.pre.start + 600, 3.9], [TUE.regular.start, 3.95], [TUE.regular.end, 4.1], [TUE.post.start + 1500, 4.2]];
  const now = (TUE.post.start + 1800) * 1000;
  const d = decodeExtended("INTR", response({ bars, regular: 4.1, regularTime: TUE.regular.end }), now);
  assert.equal(d.latest.session, "post");
  assert.equal(d.latest.referencePrice, 4.1);
  assert.ok(Math.abs(d.latest.changePercent - (4.2 - 4.1) / 4.1 * 100) < 1e-9);
  assert.equal(d.latest.open, true);
  assert.equal(d.points[0].t, (TUE.pre.start + 600) * 1000, "the 1D line starts at that day's pre-market");
});

test("after hours that has ended still names its last trade, marked as ended", () => {
  const now = (TUE.pre.start - 3600) * 1000; // 03:00 EST Tue: Monday's after hours is over, Tuesday's pre not open
  const d = decodeExtended("INTR", response({ bars: intrBars.slice(0, 7) }), now);
  assert.equal(d.latest.session, "post");
  assert.equal(d.latest.price, 3.96);
  assert.equal(d.latest.open, false);
  assert.equal(d.latest.stale, false, "an ended session is not 'stale', just over");
});

test("during the regular session there is no extended price to show", () => {
  const bars = [[TUE.pre.start + 600, 3.9], [TUE.regular.start, 3.95], [TUE.regular.start + 600, 3.97]];
  const now = (TUE.regular.start + 900) * 1000;
  const d = decodeExtended("INTR", response({ bars, regular: 3.97, regularTime: TUE.regular.start + 600 }), now);
  assert.equal(d.status, "regular-open");
  assert.equal(d.latest, null);
  assert.deepEqual(d.points.map((p) => p.session), ["pre", "regular", "regular"], "today's pre-market stays on the line");
});

test("no extended trades since the close: says so, never reuses the regular price", () => {
  const now = (TUE.pre.start + 3600) * 1000;
  const d = decodeExtended("INTR", response({ bars: intrBars.slice(0, 5) }), now);
  assert.equal(d.status, "none");
  assert.equal(d.latest, null);
  // Pre-market bars from before the close don't count as after it.
  const early = decodeExtended("INTR", response({ bars: intrBars.slice(0, 2).concat(intrBars.slice(2, 5)) }), now);
  assert.equal(early.status, "none");
});

test("markets without extended hours: not applicable, no line, no price", () => {
  const d = decodeExtended("0700.HK", response({ symbol: "0700.HK", hasPrePost: false, bars: [[MON.regular.start, 376]] }), Date.now());
  assert.equal(d.status, "not-applicable");
  assert.deepEqual(d.points, []);
  assert.equal(d.latest, null);
  // hasPrePostMarketData true but no pre/post periods is not trusted either.
  const odd = decodeExtended("X", ok({ chart: { result: [{ meta: { symbol: "X", hasPrePostMarketData: true, regularMarketPrice: 1,
    regularMarketTime: 1, tradingPeriods: [[MON.regular]] } }] } }), Date.now());
  assert.equal(odd.status, "not-applicable");
});

test("bars with no time or price are skipped, never filled in", () => {
  const now = (TUE.pre.start + 4 * 3600 + 40 * 60) * 1000;
  const bars = [...intrBars, [TUE.pre.start + 4 * 3600 + 35 * 60, null], [null, 3.99], [0, 3.99]];
  const d = decodeExtended("INTR", response({ bars }), now);
  assert.equal(d.latest.price, 3.97, "the null-close bar at 08:35 is not the latest");
  assert.equal(d.points.length, intrBars.length);
});

test("an extended-hours price that disagrees with the latest bar is flagged", () => {
  const now = (TUE.pre.start + 4 * 3600 + 40 * 60) * 1000;
  const d = decodeExtended("INTR", response({ bars: intrBars, fulldayPrice: 4.1 }), now);
  assert.deepEqual(d.inconsistency, { fulldayPrice: 4.1, barPrice: 3.97 });
  assert.equal(d.latest.price, 3.97, "the timestamped bar is what is shown");
});

test("refuses what it can't stand behind", () => {
  const now = Date.now();
  assert.throws(() => decodeExtended("INTR", response({ symbol: "NU", bars: intrBars }), now), /different ticker/);
  assert.throws(() => decodeExtended("INTR", response({ bars: intrBars, regular: null }), now), /no regular-session close/);
  assert.throws(() => decodeExtended("INTR", { status: 429, ok: false, text: "" }, now), (e) => e.retryAfterMs === 60_000);
  assert.throws(() => decodeExtended("INTR", { status: 200, ok: true, text: "<html>" }, now), /unreadable/);
});

test("other exchanges keep their own clock and hours from the source", () => {
  // A Frankfurt-like schedule (CET, UTC+1): pre 08:00–09:00, regular 09:00–17:30, post 17:30–22:00.
  const cet = day(2026, 11, 17, 3600, "CET", { pre: [8, 0], open: [9, 0], close: [17, 30], post: [22, 0] });
  const p = sessionPeriods({ tradingPeriods: { pre: [[cet.pre]], regular: [[cet.regular]], post: [[cet.post]] } });
  assert.equal(sessionHours(p.pre[0]), "08:00–09:00 CET");
  assert.equal(sessionHours(p.post[0]), "17:30–22:00 CET");
  const zone = yahooTimeZone({ timezone: "CET", gmtoffset: 3600, tradingPeriods: { pre: [[cet.pre]], regular: [[cet.regular]], post: [[cet.post]] } });
  assert.equal(zone.periods.length, 3, "the { pre, regular, post } shape is read for the hover clock too");
  assert.equal(formatPointTime((cet.post.start + 600) * 1000, zone, { now: cet.post.start * 1000 }), "Tue, Nov 17, 17:40 CET");
  assert.equal(sessionHours(sessionPeriods({ tradingPeriods: { pre: [[MON.pre]] } }).pre[0]), "04:00–09:30 EST");
});

test("the panel quote says whether to ask for extended hours", () => {
  const q = (has) => decodeYahoo("AAPL", ok({ chart: { result: [{ meta: { symbol: "AAPL", regularMarketPrice: 1, regularMarketTime: 1,
    previousClose: 1, hasPrePostMarketData: has } }] } }), 1);
  assert.equal(q(true).hasPrePost, true);
  assert.equal(q(false).hasPrePost, false);
  assert.equal(q(undefined).hasPrePost, false);
});

test("extended hours: one cached request a minute, through the same Yahoo cooldown as the ranges", async () => {
  const store = new HistoryStore();
  let clock = (TUE.pre.start + 4 * 3600 + 40 * 60) * 1000;
  let limited = false;
  const urls = [];
  const host = {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetch: async (url) => { urls.push(url); return limited ? { status: 429, ok: false, text: "" } : response({ bars: intrBars }); },
  };
  await store.loadExtended("INTR", host);
  await store.loadExtended("INTR", host);
  assert.equal(urls.length, 1, "reused within a minute");
  clock += 60_001;
  limited = true;
  await assert.rejects(store.loadExtended("INTR", host), /rate limited/);
  assert.equal(store.peekExtended("INTR", clock).data.latest.price, 3.97, "the last good data stays");
  await assert.rejects(store.load("AAPL", "1W", host), /Retry after/, "the ranges respect the cooldown it set");
  assert.equal(urls.length, 2);
  const held = new HistoryStore();
  await assert.rejects(held.loadExtended("INTR", { ...host, yahooRetryAt: clock + 30_000 }), /Retry after 30s/, "and the panel's cooldown");
  assert.equal(urls.length, 2);
});
