// The row's chart and numbers agree with each other and with the data, in the cases that broke
// them: a bar read after the quote, a missing reference, holes in the data, and bars without a close.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeYahoo, shownQuote } from "../quotes.js";
import { watchlistSparkline } from "../sparkline.js";
import { Watchlist } from "../watchlist.js";
import { H, M, TUE, WED, sessions, answer } from "./helpers/yahoo-answer.mjs";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

const KLINE = 15 * M;
const DAY = 24 * H;
const lineEnd = (g) => g.line.at(-1);
const strokes = (tree) => walk(tree).filter((n) => n.kind === "paint")
  .map((n) => n.calls.find((c) => c[0] === "path")[1].calls)
  .filter((calls) => calls.some((c) => c[0] === "stroke" && c[1] === 1.25));

test("crypto: a kline read after the ticker never ends the line; the displayed quote does", async () => {
  const now = Date.UTC(2026, 10, 25, 18, 9);
  const first = Math.floor(now / KLINE) * KLINE - 95 * KLINE;
  const response = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  const w = new Watchlist({ load: () => ({ version: 1, symbols: ["COIN/USDT"], paused: false }), now: () => now, changed: () => {},
    fetch: async (url) => url.includes("klines")
      // Flat at 100, then the forming kline, read a moment later, already at 110.
      ? response(Array.from({ length: 96 }, (_, i) => [first + i * KLINE, "100", "0", "0", i === 95 ? "110" : "100"]))
      : response({ symbol: "COINUSDT", lastPrice: "90", openPrice: "100", openTime: now - DAY, closeTime: now }) });
  await w.crypto(["COIN/USDT"], () => true);
  const q = w.quotes["COIN/USDT"];
  assert.equal(q.price, 90); assert.equal(q.changePercent, -10);
  const g = watchlistSparkline(q, now);
  assert.ok(lineEnd(g)[1] > g.reference, "a −10% row ends below its reference");
  const prices = g.line.map(([, y]) => y);
  assert.equal(Math.max(...prices), lineEnd(g)[1], "and at the lowest point: 90, not 110");
});

test("stocks without a trail: the forming bar never ends the line; the displayed quote does", () => {
  const start = sessions(WED).regular[0];
  const points = Array.from({ length: 12 }, (_, i) => ({ t: start + i * 5 * M, close: i === 11 ? 110 : 100 }));
  const q = { symbol: "SAMPLE", price: 90, previousClose: 100, changePercent: -10, currency: "USD",
    timestamp: points.at(-1).t + 2 * M, fetchedAt: WED + 16 * H, session: sessions(WED).regular, points, series: points.map((p) => p.close) };
  const g = watchlistSparkline(q, WED + 16 * H);
  assert.ok(lineEnd(g)[1] > g.reference);
  assert.equal(Math.max(...g.line.map(([, y]) => y)), lineEnd(g)[1]);
});

test("a missing previous close still shows the latest after-hours trade, with no change", () => {
  const now = WED + 22 * H; // 17:00 EST
  const price = (d, s) => (s === "post" && d === WED ? 91 : 90);
  const q = answer({ days: [TUE, WED], now, price, previousClose: null, regularClose: 90 });
  const shown = shownQuote(q);
  assert.equal(shown.price, 91); assert.equal(shown.shownSession, "post");
  assert.equal(shown.changePercent, null); assert.equal(shown.previousClose, null);
  const g = watchlistSparkline(q, now);
  assert.equal(g.reference, null);
  assert.match(g.label, /no reference/);
  assert.ok(g.line.length > 1);
});

test("one listed trading day still shows the latest after-hours trade", () => {
  const now = WED + 22 * H;
  const price = (d, s) => (s === "post" ? 91 : 90);
  const q = answer({ days: [WED], periodDays: [WED], now, price, regularClose: 90 });
  const shown = shownQuote(q);
  assert.equal(shown.price, 91); assert.equal(shown.shownSession, "post");
  assert.equal(shown.previousClose, 100);
  assert.ok(Math.abs(shown.changePercent - -9) < 1e-9);
  // Without the close's time the line covers that day, and the hover says so without a time it can't know.
  assert.match(watchlistSparkline(q, now).label, /^Since .* · vs prev close 100.00 USD$/);
});

test("stocks: a five-hour hole in the bars stays blank and keeps its width", async () => {
  const now = WED + 20 * H; // 15:00 EST
  const hole = [WED + 9.5 * H, WED + 14.5 * H]; // no bars 04:30–09:30
  const q = answer({ days: [TUE, WED], now, price: (d, s) => (d === TUE ? 100 : s === "pre" ? 97 : 95), drop: (t) => t >= hole[0] && t < hole[1] });
  const { ChartParts } = await views();
  const tree = new ChartParts().watchlistChart(q, theme.ansi1, theme, now);
  assert.equal(strokes(tree).length, 2, "two separate strokes, nothing drawn across the hole");
  const g = watchlistSparkline(q, now);
  assert.equal(g.runs.length, 2, "two runs, one on each side of the hole");
  const [a, b] = g.runs;
  const width = b[0][0] - a.at(-1)[0];
  assert.ok(width > 10, `the hole keeps its trading-time width (${width.toFixed(1)}px)`);
});

test("crypto: a multi-hour hole in the klines stays blank", async () => {
  const now = Date.UTC(2026, 10, 25, 18, 9);
  const first = Math.floor(now / KLINE) * KLINE - 95 * KLINE;
  const points = [];
  for (let i = 0; i < 96; i++) if (i < 40 || i > 50) points.push({ t: first + i * KLINE, close: 100 + i / 100 });
  const q = { symbol: "COIN/USDT", price: 101, previousClose: 100, changePercent: 1, currency: "USDT", timestamp: now,
    windowStart: now - DAY, fetchedAt: now, points, series: points.map((p) => p.close), firstOpen: { t: first, price: 100 } };
  const { ChartParts } = await views();
  assert.equal(strokes(new ChartParts().watchlistChart(q, theme.ansi2, theme, now)).length, 2, "nothing drawn across the hole");
  const g = watchlistSparkline(q, now);
  assert.equal(g.runs.length, 2);
  assert.ok(g.runs[1][0][0] - g.runs[0].at(-1)[0] > 5);
});

test("a regular bar without a close keeps its open, high and low for the dialog", () => {
  const s = sessions(WED).regular[0] / 1000;
  const body = { chart: { result: [{ meta: { symbol: "SAMPLE", regularMarketPrice: 101, regularMarketTime: s + 400, previousClose: 99,
    tradingPeriods: [[{ start: s, end: s + 23_400, gmtoffset: -18_000, timezone: "EST" }]] },
  timestamp: [s, s + 300], indicators: { quote: [{ open: [100, 101], high: [105, 102], low: [95, 100], close: [null, 101] }] } }] } };
  const q = decodeYahoo("SAMPLE", { status: 200, ok: true, text: JSON.stringify(body) }, s * 1000 + 600_000);
  assert.equal(q.open, 100); assert.equal(q.high, 105); assert.equal(q.low, 95);
  assert.deepEqual(q.series, [101]);
  assert.deepEqual(q.firstOpen, { t: s * 1000, price: 100 });
});

// Any missing bar is a hole, however short; continuous data stays one line.
const strokeCount = async (q, now, color = theme.ansi1) => {
  const { ChartParts } = await views();
  return strokes(new ChartParts().watchlistChart(q, color, theme, now)).length;
};

test("stocks: one missing 5-minute bar, or five, break the line; continuous data doesn't", async () => {
  const now = WED + 20 * H;
  const price = (d, s) => (d === TUE ? 100 : s === "pre" ? 97 : 95);
  const at = WED + 17 * H; // 12:00 EST
  assert.equal(await strokeCount(answer({ days: [TUE, WED], now, price }), now), 1, "no hole: one stroke");
  for (const missing of [1, 5]) {
    const q = answer({ days: [TUE, WED], now, price, drop: (t) => t >= at && t < at + missing * 5 * M });
    assert.equal(await strokeCount(q, now), 2, `${missing} missing bar(s): two strokes`);
    assert.equal(watchlistSparkline(q, now).runs.length, 2);
  }
});

test("crypto: one missing kline breaks the line; continuous klines don't", async () => {
  const now = Date.UTC(2026, 10, 25, 18, 9);
  const first = Math.floor(now / KLINE) * KLINE - 95 * KLINE;
  const pair = (skip) => {
    const points = [];
    for (let i = 0; i < 96; i++) if (i !== skip) points.push({ t: first + i * KLINE, close: 100 + i / 100 });
    return { symbol: "COIN/USDT", price: 101, previousClose: 100, changePercent: 1, currency: "USDT", timestamp: now,
      windowStart: now - DAY, fetchedAt: now, points, series: points.map((p) => p.close), firstOpen: { t: first, price: 100 } };
  };
  assert.equal(await strokeCount(pair(-1), now, theme.ansi2), 1);
  assert.equal(await strokeCount(pair(40), now, theme.ansi2), 2);
});

test("stocks without a trail: one missing bar breaks the line", async () => {
  const start = sessions(WED).regular[0];
  // Bars at 09:30, 09:35, then none at 09:40, then 09:45 and 09:50; the quote at 09:55.
  const points = [0, 1, 3, 4].map((i) => ({ t: start + i * 5 * M, close: 100 }));
  const now = start + 25 * M;
  const q = { symbol: "SAMPLE", price: 100, previousClose: 99, changePercent: 1 / 99 * 100, currency: "USD",
    timestamp: now, fetchedAt: now, session: sessions(WED).regular, points, series: points.map((p) => p.close) };
  assert.equal(await strokeCount(q, now, theme.ansi2), 2);
  assert.deepEqual(watchlistSparkline(q, now).runs.map((r) => r.length), [2, 2]);
  const full = { ...q, points: [0, 1, 2, 3, 4].map((i) => ({ t: start + i * 5 * M, close: 100 })) };
  assert.equal(await strokeCount(full, now, theme.ansi2), 1);
});

test("a trail restored from a cache without trading times is not drawn across its holes", async () => {
  const now = WED + 20 * H;
  const hole = [WED + 9.5 * H, WED + 14.5 * H];
  const fresh = answer({ days: [TUE, WED], now, price: (d, s) => (d === TUE ? 100 : s === "pre" ? 97 : 95), drop: (t) => t >= hole[0] && t < hole[1] });
  // The shape the previous version saved: the same points without slot or gap.
  const restored = { ...fresh, trail: { ...fresh.trail, points: fresh.trail.points.map(({ t, close, session }) => ({ t, close, session })) } };
  assert.equal(shownQuote(restored), restored, "the old trail waits for the next refresh");
  const g = watchlistSparkline(restored, now);
  assert.match(g.label, /^Regular /, "the regular session's line, which has no hole");
  assert.equal(await strokeCount(restored, now), g.runs.length);
  for (const run of g.runs) assert.ok(run.length > 1);
});
