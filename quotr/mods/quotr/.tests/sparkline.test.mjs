// The watchlist row's chart (sparkline.js): what is drawn, against what, and where.
import test from "node:test";
import assert from "node:assert/strict";
import {
  watchlistSparkline, observedPrices, sparkReference, sparkWindow,
  SPARK_TOP, SPARK_BOTTOM, SPARK_LEFT, SPARK_RIGHT, STOCK_BAR_MS, CRYPTO_BAR_MS,
} from "../sparkline.js";
import { decodeYahoo, decodeBinance, decodeKlineWindow } from "../quotes.js";
import { fixture, START, END, NOW } from "./helpers/spark-fixtures.mjs";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const ys = (g) => g.line.map((p) => p[1]);
const DAY = 86_400_000;

// A stock that opened 8.12% below the previous close and traded flat: bars every 5 minutes.
function gapDown({ bars = 40, prev = 100, level = 91.88 } = {}) {
  const points = Array.from({ length: bars }, (_, i) => ({ t: START + i * STOCK_BAR_MS, close: level + (i % 2 ? 0.02 : -0.02) }));
  const last = points.at(-1);
  return { symbol: "SAMPLE", price: last.close, previousClose: prev, changePercent: (last.close - prev) / prev * 100,
    timestamp: last.t + 60_000, fetchedAt: NOW, currency: "USD", series: points.map((p) => p.close), points,
    session: [START, END], periods: { regular: [START, END] }, firstOpen: { t: START, price: level } };
}

// A pair over its rolling 24h window, 15-minute klines (open times), the quote at the window's end.
function pair({ open = 60_000, last = 58_800, bars = 96, now = Date.UTC(2026, 10, 25, 18, 9) } = {}) {
  const first = Math.floor(now / CRYPTO_BAR_MS) * CRYPTO_BAR_MS - (bars - 1) * CRYPTO_BAR_MS;
  const points = Array.from({ length: bars }, (_, i) => ({ t: first + i * CRYPTO_BAR_MS, close: open + (last - open) * (i + 1) / bars }));
  return { symbol: "COIN/USDT", price: last, previousClose: open, changePercent: (last - open) / open * 100,
    timestamp: now, windowStart: now - DAY, fetchedAt: now, currency: "USDT", series: points.map((p) => p.close), points,
    firstOpen: { t: first, price: open }, periods: null };
}

test("an opening gap reads against the previous close even when the session is flat", () => {
  const q = gapDown();
  const g = watchlistSparkline(q, NOW);
  assert.ok(g.reference !== null, "the previous close is drawn");
  near(g.reference, SPARK_TOP, 1e-9); // the reference is the highest price: top of the box
  for (const y of ys(g)) assert.ok(y - g.reference > 14, "every point sits well below the reference");
  // The flat session itself stays flat next to an 8% gap.
  assert.ok(Math.max(...ys(g)) - Math.min(...ys(g)) < 0.2);
  // A gap up mirrors it.
  const up = watchlistSparkline(gapDown({ level: 130 }), NOW);
  near(up.reference, SPARK_BOTTOM);
  for (const y of ys(up)) assert.ok(up.reference - y > 14);
});

test("the line ends on the displayed side of the reference: one rule with the percentage", () => {
  for (const level of [91.88, 99.9, 100.1, 130]) {
    const q = gapDown({ level });
    const g = watchlistSparkline(q, NOW);
    const end = g.line.at(-1)[1];
    // Pixels grow downward: below the reference means a loss, as the percentage says.
    assert.equal(Math.sign(end - g.reference), -Math.sign(q.changePercent), `level ${level}`);
  }
  const c = pair({ open: 60_000, last: 58_800 });
  const g = watchlistSparkline(c, c.timestamp);
  assert.ok(g.line.at(-1)[1] > g.reference && c.changePercent < 0);
});

test("the reference is the one the percentage uses, or none", () => {
  const q = gapDown();
  assert.equal(sparkReference(q), 100);
  for (const bad of [{ previousClose: null }, { previousClose: 0 }, { previousClose: -1 }, { previousClose: NaN },
    { changePercent: null }, { changePercent: 1 }, { price: 0 }]) {
    const g = watchlistSparkline({ ...q, ...bad }, NOW);
    assert.equal(sparkReference({ ...q, ...bad }), null, JSON.stringify(bad));
    assert.equal(g.reference, null);
    assert.ok(g.line.length > 1, "the observed line still draws");
    assert.match(g.label, /no reference/);
  }
});

test("small moves stay small: the vertical span is at least 1% of the reference", () => {
  const q = fixture([100.02, 100.05, 99.98, 100.04], { previousClose: 100, changePercent: 0.04, price: 100.04 });
  const g = watchlistSparkline(q, NOW);
  const extent = Math.max(...ys(g), g.reference) - Math.min(...ys(g), g.reference);
  assert.ok(extent < (SPARK_BOTTOM - SPARK_TOP) * 0.1, `0.07% spans ${extent}px`);
  // A flat line with no reference is finite and centered.
  const flat = watchlistSparkline(fixture([50, 50, 50], { previousClose: null, changePercent: null }), NOW);
  for (const y of ys(flat)) near(y, (SPARK_TOP + SPARK_BOTTOM) / 2);
});

test("stocks: x follows time across the session from Yahoo's trading period, partial days stay partial", () => {
  const q = gapDown({ bars: 12 }); // the first hour
  const g = watchlistSparkline(q, NOW);
  near(g.line[0][0], SPARK_LEFT, 1e-9); // the first bar's open at 09:30
  const lastT = q.timestamp;
  near(g.line.at(-1)[0], SPARK_LEFT + (SPARK_RIGHT - SPARK_LEFT) * (lastT - START) / (END - START));
  assert.ok(g.line.at(-1)[0] < 15, "one hour of 6.5 is the left sixth");
  // currentTradingPeriod already on the next day: the bars' own session still places them.
  const rolled = { ...q, periods: { regular: [START + DAY, END + DAY] } };
  assert.deepEqual(watchlistSparkline(rolled, NOW).line, g.line);
  // An old cache with neither session: the bars span the box, nothing dropped.
  const old = { ...q, session: undefined, periods: { regular: [START + DAY, END + DAY] } };
  const og = watchlistSparkline(old, NOW);
  assert.equal(og.line.length, g.line.length);
  near(og.line[0][0], SPARK_LEFT); near(og.line.at(-1)[0], SPARK_RIGHT);
});

test("crypto: the rolling 24h window, its open as reference, kline closes at each kline's end", () => {
  const c = pair();
  const [from, to] = sparkWindow(c, observedPrices(c));
  assert.equal(from, c.timestamp - DAY); assert.equal(to, c.timestamp);
  const g = watchlistSparkline(c, c.timestamp);
  // The first kline's open (at most one kline after the window starts), 96 closes, the quote merges with the last.
  assert.equal(g.line.length, 97);
  assert.ok(g.line[0][0] < SPARK_LEFT + 54 / 96 + 1e-9);
  near(g.line.at(-1)[0], SPARK_RIGHT);
  assert.match(g.label, /^Last 24h · vs 60,000\.00 USDT 24h ago$/);
  // Bars older than the window are left out, never stretched in.
  const old = { ...c, firstOpen: null, points: [{ t: c.timestamp - DAY - 2 * CRYPTO_BAR_MS, close: 1 }, ...c.points] };
  assert.equal(watchlistSparkline(old, c.timestamp).line.length, 96);
  assert.ok(!observedPrices(old).every((p) => p.t >= c.timestamp - DAY));
});

test("no invented points: only bar opens, bar closes and the quote, each at its own time", () => {
  const q = gapDown({ bars: 3 });
  const prices = observedPrices(q);
  assert.deepEqual(prices.map((p) => p.price), [q.firstOpen.price, ...q.points.map((p) => p.close)]);
  assert.deepEqual(prices.map((p) => p.t), [START, START + STOCK_BAR_MS, START + 2 * STOCK_BAR_MS, q.timestamp]);
  // A quote newer than the bars is a trade of its own: it ends the line.
  const later = { ...q, timestamp: q.timestamp + 20 * 60_000, price: 92.5, changePercent: -7.5 };
  const tp = ({ t, price }) => ({ t, price });
  assert.deepEqual(tp(observedPrices(later).at(-1)), { t: later.timestamp, price: 92.5 });
  // A quote older than the bars adds nothing.
  // A quote older than the bars still ends the line: bars after it are left out.
  const older = observedPrices({ ...q, timestamp: START + 60_000, price: 50 });
  assert.deepEqual(older.map(tp), [{ t: START, price: q.firstOpen.price }, { t: START + 60_000, price: 50 }]);
  // A gap in the data stays a gap: two bars two hours apart are joined, nothing is filled between them.
  const holes = { ...q, firstOpen: null, points: [q.points[0], { t: START + 2 * 3_600_000, close: 92 }], timestamp: START + 2 * 3_600_000 + 60_000 };
  assert.equal(watchlistSparkline(holes, NOW).line.length, 2);
  // Malformed entries are skipped, not repaired.
  const junk = { ...q, firstOpen: { t: -1, price: 5 }, points: [null, { t: "x", close: 1 }, { t: START, close: -3 }, ...q.points] };
  assert.equal(observedPrices(junk).length, q.points.length);
});

test("empty, single and missing data: a dot, the reference alone, or nothing", () => {
  const none = watchlistSparkline({ symbol: "SAMPLE" }, NOW);
  assert.deepEqual(none.line, []); assert.equal(none.reference, null); assert.match(none.label, /^No bars yet/);
  const bare = { ...gapDown(), points: [], series: [], firstOpen: null };
  assert.equal(watchlistSparkline(bare, NOW).line.length, 1, "a stock's quote alone is one dot in its session");
  const onlyQuote = watchlistSparkline({ ...bare, session: null, periods: null }, NOW);
  assert.equal(onlyQuote.line.length, 0, "a quote with no session to place it in is not drawn");
  const pairOnly = pair(); const dot = watchlistSparkline({ ...pairOnly, points: [], firstOpen: null }, pairOnly.timestamp);
  assert.equal(dot.line.length, 1, "a pair's quote alone is one dot at the window's end");
  near(dot.line[0][0], SPARK_RIGHT);
  for (const g of [none, onlyQuote, dot]) for (const [x, y] of g.line) assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

test("stale and failed quotes are flagged, never redrawn differently", () => {
  const q = gapDown();
  assert.equal(watchlistSparkline(q, NOW).stale, false);
  assert.equal(watchlistSparkline(q, NOW, { failed: true }).stale, true);
  assert.equal(watchlistSparkline(q, NOW + 10 * 60_000).stale, true);
  assert.equal(watchlistSparkline({ ...q, fetchedAt: undefined }, NOW).stale, true);
  assert.deepEqual(watchlistSparkline(q, NOW, { failed: true }).line, watchlistSparkline(q, NOW).line);
});

test("the hover is one short line: the session's times and the reference", () => {
  const q = { ...gapDown({ bars: 12 }), timeZone: { label: "EST", offsetSeconds: -18_000, periods: [] } };
  const g = watchlistSparkline(q, NOW);
  assert.equal(g.label, "Regular 09:30–10:26 EST · vs prev close 100.00 USD");
  assert.ok(g.label.length < 60);
  assert.equal(g.description, `Chart: ${g.label}`);
});

test("decoders: Yahoo's bar session and first open, Binance's 24h open and window", () => {
  const response = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
  const s = START / 1000;
  const q = decodeYahoo("SAMPLE", response({ chart: { result: [{ meta: {
    symbol: "SAMPLE", regularMarketPrice: 92, regularMarketTime: s + 700, previousClose: 100,
    currentTradingPeriod: { regular: { start: s + 86_400, end: END / 1000 + 86_400 } },
    tradingPeriods: [[{ start: s, end: END / 1000, gmtoffset: -18000, timezone: "EST" }]],
  }, timestamp: [s, s + 300, s + 600], indicators: { quote: [{ close: [91.9, 92.1, 92], open: [91.8, 91.9, 92.1] }] } }] } }), NOW);
  assert.deepEqual(q.session, [START, END]);
  assert.deepEqual(q.firstOpen, { t: START, price: 91.8 });
  assert.equal(sparkReference(q), 100);
  const g = watchlistSparkline(q, NOW);
  assert.equal(g.line.length, 4); near(g.line[0][0], SPARK_LEFT);
  // No open for the first bar: no open point, never a later bar's open in its place.
  const noOpen = decodeYahoo("SAMPLE", response({ chart: { result: [{ meta: { symbol: "SAMPLE", regularMarketPrice: 92,
    regularMarketTime: s + 700, previousClose: 100 }, timestamp: [s, s + 300], indicators: { quote: [{ close: [91.9, 92], open: [null, 91.9] }] } }] } }), NOW);
  assert.equal(noOpen.firstOpen, null); assert.equal(noOpen.session, null);

  const now = Date.UTC(2026, 10, 25, 18, 9);
  const c = decodeBinance(["COIN/USDT"], response({ symbol: "COINUSDT", lastPrice: "58800", openPrice: "60000",
    prevClosePrice: "60010", openTime: now - DAY, closeTime: now }), now)["COIN/USDT"];
  assert.equal(c.previousClose, 60000, "Binance's own 24h change is measured from the window's open");
  near(c.changePercent, -2);
  assert.equal(c.windowStart, now - DAY);
  const k = decodeKlineWindow(response([[now - 3 * CRYPTO_BAR_MS, "60000", "0", "0", "59900"], [now - 2 * CRYPTO_BAR_MS, "59900", "0", "0", "59000"]]));
  assert.deepEqual(k.firstOpen, { t: now - 3 * CRYPTO_BAR_MS, price: 60000 });
  assert.equal(k.points.length, 2);
  assert.deepEqual(decodeKlineWindow(response([])), { points: [], firstOpen: null });
  assert.throws(() => decodeKlineWindow({ status: 500, ok: false, text: "" }));
  assert.throws(() => decodeKlineWindow(response({ not: "a list" })));
});
