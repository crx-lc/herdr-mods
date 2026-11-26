// The row's chart and numbers agree with each other and with the data, in the cases that broke
// them: a bar read after the quote, a missing reference, stretches without trades, and bars
// without a close.
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
  assert.match(watchlistSparkline(q, now).label, /^Regular 09:30–\d\d:\d\d EST · vs prev close 100\.00 USD$/);
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

// The owner's decision (issue #37): consecutive prices are joined. A stretch with no trade is a
// straight segment from the last trade to the next, never a blank or a lone dot.
const paintsOf = async (q, now, color) => {
  const { ChartParts } = await views();
  const paths = walk(new ChartParts().watchlistChart(q, color, theme, now)).filter((n) => n.kind === "paint")
    .map((n) => n.calls.find((c) => c[0] === "path")[1].calls);
  return { strokes: paths.filter((c) => c.some((x) => x[0] === "stroke" && x[1] === 1.25)).length,
    dots: paths.filter((c) => c.some((x) => x[0] === "stroke" && x[1] === 2)).length,
    fills: paths.filter((c) => c.some((x) => x[0] === "fill")).length };
};

test("stocks: bars without trades are joined, one stroke and one fill, no dots", async () => {
  const start = sessions(WED).regular[0];
  // A thin stock: trades in only some 5-minute bars, a two-hour quiet stretch in the middle.
  const points = [0, 5, 20, 25, 30, 150, 155, 175].map((m) => ({ t: start + m * M, close: 100 + m / 100 }));
  const now = start + 181 * M;
  const q = { symbol: "SAMPLE", price: 101.8, previousClose: 100, changePercent: 1.8, currency: "USD",
    timestamp: now, fetchedAt: now, session: sessions(WED).regular, points, series: points.map((p) => p.close) };
  const g = watchlistSparkline(q, now);
  assert.equal(g.runs.length, 1); assert.equal(g.runs[0], g.line);
  assert.deepEqual(await paintsOf(q, now, theme.ansi2), { strokes: 1, dots: 0, fills: 1 });
  // The quiet stretch keeps its width: time, not bars, sets x.
  assert.ok(g.line.some((p, i) => i > 0 && p[0] - g.line[i - 1][0] > 10), "the two quiet hours are one long straight segment");
});

test("every other bar without a trade, across both days: still one line", async () => {
  const now = WED + 20 * H;
  const quiet = (t) => Math.floor((t - WED) / (5 * M)) % 2 === 1; // every other bar has no trade
  const q = answer({ days: [TUE, WED], now, price: (d, s) => (d === TUE ? 100 : 95), drop: quiet });
  assert.deepEqual(await paintsOf(q, now, theme.ansi1), { strokes: 1, dots: 0, fills: 1 });
});

test("crypto: a missing kline is joined too", async () => {
  const now = Date.UTC(2026, 10, 25, 18, 9);
  const first = Math.floor(now / KLINE) * KLINE - 95 * KLINE;
  const points = [];
  for (let i = 0; i < 96; i++) if (i < 40 || i > 50) points.push({ t: first + i * KLINE, close: 100 + i / 100 });
  const q = { symbol: "COIN/USDT", price: 101, previousClose: 100, changePercent: 1, currency: "USDT", timestamp: now,
    windowStart: now - DAY, fetchedAt: now, points, series: points.map((p) => p.close), firstOpen: { t: first, price: 100 } };
  assert.equal(watchlistSparkline(q, now).runs.length, 1);
  assert.deepEqual(await paintsOf(q, now, theme.ansi2), { strokes: 1, dots: 0, fills: 1 });
});
