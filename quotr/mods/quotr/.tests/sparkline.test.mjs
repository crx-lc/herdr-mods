import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSparkline } from "../sparkline.js";
import { chartGeometry, decodeYahoo, decodeBinance } from "../quotes.js";
import { nearestIndex, readoutAt } from "../readout.js";
import { fixture, scenarios, NOW, START, END } from "./helpers/spark-fixtures.mjs";
import { views, element, walk, theme } from "./helpers/view-harness.mjs";

const extent = (points) => Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]));

test("large signed moves retain observed shape, separate daily magnitude and no invented points", () => {
  for (const [, q] of scenarios) {
    const saved = JSON.stringify(q);
    const g = watchlistSparkline(q, NOW);
    assert.equal(g.line.length, q.points.length);
    assert.ok(extent(g.line) > 0 && extent(g.line) < 11, "observed trend uses price-relative floor, no reference compression");
    assert.equal(g.move?.percent ?? null, q.changePercent);
    assert.equal(JSON.stringify(q), saved);
    assert.equal(g.line[0][0], 2, "starts at first observed bar, not previous close");
  }
  const q = fixture();
  assert.ok(extent(chartGeometry(q.series, q.previousClose).points) * 0.22 < 1, "baseline root cause");
  assert.equal(watchlistSparkline(q, NOW).move.to, 43.6);
  assert.equal(watchlistSparkline(scenarios[1][1], NOW).move.to, 12.4);
});

test("missing, nonpositive, nonfinite or inconsistent reference never fabricates daily rail", () => {
  for (const previousClose of [null, undefined, 0, -1, NaN, Infinity, "100"]) {
    const g = watchlistSparkline(fixture(undefined, { previousClose }), NOW);
    assert.equal(g.move, null);
    assert.equal(g.line.length, 5, "observed shape remains independent");
  }
  for (const changePercent of [null, NaN, Infinity, -30]) {
    assert.equal(watchlistSparkline(fixture(undefined, { changePercent }), NOW).move, null);
  }
});

test("flat/zero and capped moves have finite, symmetric geometry", () => {
  const flat = watchlistSparkline(fixture([100, 100, 100]), NOW);
  assert.equal(extent(flat.line), 0);
  assert.equal(flat.move.to, 28);
  for (const price of [200, 10]) {
    const g = watchlistSparkline(fixture([price, price]), NOW);
    assert.equal(g.move.capped, true);
    assert.equal(g.move.to, price > 100 ? 54 : 2);
  }
});

test("empty, single, partial, missing-open and quote/bar mismatch do not add coverage or quote points", () => {
  assert.deepEqual(watchlistSparkline(fixture([]), NOW).line, []);
  assert.equal(watchlistSparkline(fixture([130]), NOW).line.length, 1);
  const q = fixture([130, 131], { open: 999, price: 150, changePercent: 50 });
  q.points = [{ t: START + 3_600_000, close: 130 }, { t: START + 3_900_000, close: 131 }];
  const g = watchlistSparkline(q, NOW);
  assert.equal(g.line.length, 2);
  assert.ok(g.line[0][0] > 2 && g.line[1][0] < 54, "only observed time span");
  assert.equal(g.move.percent, 50, "headline quote and reference, not bar return or open");
  assert.match(g.description, /different timestamps/);
  assert.match(g.description, /no opening-price inference/);
});

test("old caches, unordered, mismatched, malformed and out-of-session bars fall back conservatively", () => {
  for (const overrides of [{ points: undefined }, { points: [] }, { periods: null },
    { points: [{ t: START, close: 200 }] }, { series: [NaN, Infinity] },
    { points: [{ t: START - 1, close: 130 }, { t: END, close: 130 }], series: [130, 130] }]) {
    const g = watchlistSparkline(fixture(undefined, overrides), NOW);
    assert.equal(g.line.length, 0);
    assert.equal(g.move.percent, 30, "independent truthful headline magnitude remains");
  }
  const q = fixture(); q.points.reverse();
  assert.equal(watchlistSparkline(q, NOW).line.length, 0);
});

test("stale and failed quotes keep geometry and explain freshness", () => {
  const q = fixture();
  for (const [now, options] of [[NOW + 180001, {}], [NOW, { failed: true }]]) {
    const g = watchlistSparkline(q, now, options);
    assert.equal(g.stale, true);
    assert.match(g.description, /Stale or refresh failed/);
    assert.deepEqual(g.line, watchlistSparkline(q, NOW).line);
  }
});

test("crypto uses rolling 24h reference and observed kline times, including retained older bars", () => {
  const q = fixture(undefined, { symbol: "COIN/USDT", periods: null });
  let g = watchlistSparkline(q, NOW);
  assert.equal(g.move.percent, 30);
  assert.match(g.description, /rolling 24h reference/);
  assert.doesNotMatch(g.description, /previous regular close|opening gap/);
  assert.ok(g.line[0][0] > 2, "does not imply a full rolling window");
  q.points = q.points.map(p => ({ ...p, t: p.t - 86_400_000 }));
  g = watchlistSparkline(q, NOW);
  assert.equal(g.line.length, 1, "only the bar exactly at the rolling-window start survives");
  assert.equal(g.line[0][0], 2, "survivor stays at its actual time");
  assert.equal(g.move.percent, 30);
});

test("actual source decoders agree with daily rail, including fallback reference and missing open", () => {
  const response = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
  const q = decodeYahoo("SAMPLE", response({ chart: { result: [{ meta: {
    symbol: "SAMPLE", regularMarketPrice: 130, regularMarketTime: END / 1000 - 300,
    chartPreviousClose: 100, currentTradingPeriod: { regular: { start: START / 1000, end: END / 1000 } },
  }, timestamp: [START / 1000 + 3600, START / 1000 + 3900],
  indicators: { quote: [{ close: [130, 130], open: [null, 130] }] } }] } }), NOW);
  assert.equal(q.open, 130, "first valid open is late and is never used as opening-gap evidence");
  assert.equal(watchlistSparkline(q, NOW).move.percent, q.changePercent);
  assert.ok(watchlistSparkline(q, NOW).line[0][0] > 2);
  const crypto = decodeBinance(["COIN/USDT"], response({ symbol: "COINUSDT", lastPrice: "130", prevClosePrice: "100", closeTime: END }), NOW)["COIN/USDT"];
  assert.equal(watchlistSparkline(crypto, NOW).move.percent, crypto.changePercent);
});

test("real watchlist panel mounts 56×22 sparkline; selection, removal, reorder and unknown fallbacks survive", async () => {
  const { Quotr } = await views();
  const v = new Quotr();
  v.watch = { preferences: { symbols: ["SAMPLE", "UNKNOWN"], paused: false }, quotes: { SAMPLE: fixture() },
    errors: {}, message: "", inflight: new Set(), remove: s => { v.removed = s; } };
  v.assetIcon = () => element(); v.logoCredits = () => []; v.openDetail = s => { v.opened = s; };
  v.act = (_cx, f) => f();
  v.size = { width: 340, height: 640 }; // responsive.js draws charts from the 340 stage
  const tree = v.panel(element(), theme);
  const nodes = walk(tree);
  const find = id => nodes.find(n => n.calls?.some(c => c[0] === "id" && c[1] === id));
  const spark = find("quotr-spark-SAMPLE");
  assert.ok(spark, "actual panel calls watchlistChart");
  assert.ok(spark.calls.some(c => c[0] === "w" && c[1] === 56));
  assert.ok(spark.calls.some(c => c[0] === "h" && c[1] === 22));
  assert.equal(spark.calls.find(c => c[0] === "tooltip"), undefined, "never the shell's one-line tooltip");
  assert.match(spark.calls.find(c => c[0] === "accessibility_label")[1], /previous regular close/);
  find("quotr-row-SAMPLE").calls.find(c => c[0] === "on_click")[1]();
  assert.equal(v.opened, "SAMPLE");
  find("quotr-remove-SAMPLE").calls.find(c => c[0] === "on_click")[1](null, {});
  assert.equal(v.removed, "SAMPLE");
  assert.ok(nodes.includes("Waiting…"));
  assert.equal(find("quotr-spark-UNKNOWN"), undefined);
  v.reordering = true;
  assert.ok(!walk(v.panel(element(), theme)).some(n => n.calls?.some(c => c[0] === "id" && c[1] === "quotr-spark-SAMPLE")));
});

test("shared chart still uses original point indices, reference and session bands with real hover readout", async () => {
  const { ChartParts } = await views();
  const v = new ChartParts();
  const q = fixture(); const before = JSON.stringify(q);
  v.hover = { id: "detail", index: 2, width: 400, height: 140 };
  const tree = v.chart(q, "green", theme, { width: 400, height: 140, fill: true,
    hover: { id: "detail", points: q.points }, bands: [{ session: "pre", from: 0, to: 20 }] });
  const nodes = walk(tree);
  const paints = nodes.filter(n => n.kind === "paint");
  assert.equal(paints.length, 4, "session band, dashed reference, fill, observed line");
  const referencePath = paints[1].calls.find(c => c[0] === "path")[1].calls;
  assert.ok(referencePath.some(c => c[0] === "dash_array"));
  assert.equal(referencePath.find(c => c[0] === "move_to")[2], `${chartGeometry(q.series, q.previousClose).reference}%`);
  const band = paints[0].calls.find(c => c[0] === "path")[1].calls;
  assert.ok(band.some(c => c[0] === "line_to" && c[1] === "20%"));
  const move = tree.calls.find(c => c[0] === "on_mouse_move")[1];
  let notifications = 0;
  move({ local_position: { x: 300 }, bounds: { width: 400, height: 140 } }, { notify: () => notifications++ });
  assert.equal(v.hover.index, 3);
  assert.equal(notifications, 1);
  assert.ok(nodes.includes(readoutAt(q.points, 2).when));
  assert.equal(nearestIndex(200, 400, 5), 2);
  assert.equal(JSON.stringify(q), before);
  assert.equal(chartGeometry(q.series, q.previousClose).points.length, q.points.length);
});
