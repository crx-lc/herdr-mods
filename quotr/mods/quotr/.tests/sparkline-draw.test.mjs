// The row chart as the real view methods draw it, against recording builders (not a GPUI renderer).
import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSparkline, CRYPTO_BAR_MS } from "../sparkline.js";
import { chartGeometry } from "../quotes.js";
import { nearestIndex, readoutAt } from "../readout.js";
import { Watchlist } from "../watchlist.js";
import { fixture, NOW } from "./helpers/spark-fixtures.mjs";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const box = (tree) => walk(tree).find((n) => n.calls?.some((c) => c[0] === "id" && /^quotr-spark-/.test(c[1])));
const call = (n, name) => n.calls.find((c) => c[0] === name);

/** Each painted layer: its kind (stroke width or "fill"), dashes, points in box pixels and paint. */
function layers(tree) {
  const b = box(tree);
  assert.equal(call(b, "w")[1], 56); assert.equal(call(b, "h")[1], 22);
  return walk(b).filter((n) => n.kind === "paint").map((n) => {
    const path = call(n, "path")[1].calls;
    const stroke = path.find((c) => c[0] === "stroke");
    const coords = path.filter((c) => c[0] === "move_to" || c[0] === "line_to").map((c) => {
      assert.match(c[1], /^\d+(\.\d+)?%$/); assert.match(c[2], /^\d+(\.\d+)?%$/);
      const x = parseFloat(c[1]) * 56 / 100, y = parseFloat(c[2]) * 22 / 100;
      assert.ok(x >= -1e-9 && x <= 56 + 1e-9 && y >= -1e-9 && y <= 22 + 1e-9, "inside the box");
      return [x, y];
    });
    return { kind: stroke ? stroke[1] : "fill", dashed: path.some((c) => c[0] === "dash_array"), coords, paint: call(n, "paint")[1] };
  });
}

test("a row draws fill, dashed reference and line, all in the percentage's color", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  for (const series of [[70, 69.8, 70.1, 69.9, 70], [130, 130.2, 129.9, 130.1, 130]]) {
    const q = fixture(series);
    const color = v.changeColor(theme, q.changePercent);
    assert.equal(color, q.changePercent < 0 ? theme.ansi1 : theme.ansi2);
    const g = watchlistSparkline(q, NOW);
    const [fill, reference, line] = layers(v.watchlistChart(q, color, theme, NOW));
    assert.equal(fill.kind, "fill");
    assert.deepEqual(call(fill.paint, "solid").slice(1), [color]); assert.equal(call(fill.paint, "opacity")[1], 0.16);
    near(fill.coords[0][1], 22); near(fill.coords.at(-1)[1], 22);
    assert.equal(reference.kind, 1); assert.ok(reference.dashed); assert.equal(reference.paint, theme.muted);
    reference.coords.forEach(([, y]) => near(y, g.reference));
    near(reference.coords[0][0], 0); near(reference.coords[1][0], 56);
    assert.equal(line.kind, 1.25); assert.equal(line.paint, color);
    assert.equal(line.coords.length, g.line.length);
    line.coords.forEach((p, i) => { near(p[0], g.line[i][0]); near(p[1], g.line[i][1]); });
  }
});

test("no rail, no card: one short tooltip and a label for screen readers", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  const q = fixture();
  const tree = v.watchlistChart(q, theme.ansi2, theme, NOW);
  const b = box(tree);
  const g = watchlistSparkline(q, NOW);
  assert.equal(call(b, "tooltip")[1], g.label);
  assert.equal(call(b, "accessibility_label")[1], g.description);
  assert.ok(!walk(tree).some((n) => n.kind === "popup"), "no hover card");
  for (const handler of ["on_hover", "on_mouse_move", "on_mouse_down", "on_click"]) {
    assert.equal(call(b, handler), undefined, `${handler}: the row's own click opens the dialog`);
  }
  assert.equal(layers(tree).length, 3);
});

test("a dot, a missing reference, nothing at all, and the stale dimming", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  const noRef = fixture(undefined, { previousClose: null, changePercent: null });
  const paths = layers(v.watchlistChart(noRef, theme.dim, theme, NOW));
  assert.deepEqual(paths.map((p) => p.kind), ["fill", 1.25], "no dashed line without a reference");
  assert.equal(paths[1].paint, theme.dim);
  const single = fixture([130], { points: [], firstOpen: null });
  const dot = layers(v.watchlistChart(single, theme.ansi2, theme, NOW));
  assert.deepEqual(dot.map((p) => [p.kind, p.dashed]), [[1, true], [2, false]]);
  const empty = layers(v.watchlistChart({ symbol: "SAMPLE" }, theme.dim, theme, NOW));
  assert.deepEqual(empty, []);
  const tree = v.watchlistChart(fixture(), theme.ansi2, theme, NOW, { failed: true });
  assert.equal(call(box(tree), "opacity")[1], 0.5);
  assert.equal(call(box(v.watchlistChart(fixture(), theme.ansi2, theme, NOW)), "opacity")[1], 1);
});

test("the real panel mounts the chart in each row; the row opens the dialog; reorder hides it", async () => {
  const { Quotr } = await views();
  const v = new Quotr();
  v.watch = { preferences: { symbols: ["SAMPLE", "UNKNOWN"], paused: false },
    quotes: { SAMPLE: fixture([70, 69.8, 70], { price: 70, changePercent: -30 }) },
    errors: { SAMPLE: "sample failure" }, message: "", inflight: new Set(), remove: (s) => { v.removed = s; } };
  v.assetIcon = () => element(); v.logoCredits = () => []; v.openDetail = (s) => { v.opened = s; };
  v.act = (_cx, f) => f();
  const nodes = walk(v.panel(element(), theme));
  const find = (id) => nodes.find((n) => n.calls?.some((c) => c[0] === "id" && c[1] === id));
  const spark = find("quotr-spark-SAMPLE");
  assert.ok(spark);
  assert.equal(call(spark, "opacity")[1], 0.5, "the failed refresh is passed through");
  assert.equal(layers(spark).at(-1).paint, theme.ansi1, "the line takes the row's percentage color");
  call(find("quotr-row-SAMPLE"), "on_click")[1]();
  assert.equal(v.opened, "SAMPLE");
  call(find("quotr-remove-SAMPLE"), "on_click")[1](null, {});
  assert.equal(v.removed, "SAMPLE");
  assert.equal(find("quotr-spark-UNKNOWN"), undefined);
  v.reordering = true;
  assert.equal(walk(v.panel(element(), theme)).filter((n) => n.kind === "paint").length, 0);
});

test("the dialog's chart is untouched: index spacing, dashed reference, session bands, hover readout", async () => {
  const { ChartParts } = await views();
  const v = new ChartParts();
  const q = fixture(); const before = JSON.stringify(q);
  v.hover = { id: "detail", index: 2, width: 400, height: 140 };
  const tree = v.chart(q, "green", theme, { width: 400, height: 140, fill: true,
    hover: { id: "detail", points: q.points }, bands: [{ session: "pre", from: 0, to: 20 }] });
  const nodes = walk(tree);
  const paints = nodes.filter((n) => n.kind === "paint");
  assert.equal(paints.length, 4, "session band, dashed reference, fill, line");
  const referencePath = call(paints[1], "path")[1].calls;
  assert.ok(referencePath.some((c) => c[0] === "dash_array"));
  assert.equal(referencePath.find((c) => c[0] === "move_to")[2], `${chartGeometry(q.series, q.previousClose).reference}%`);
  const move = call(tree, "on_mouse_move")[1];
  let notifications = 0;
  move({ local_position: { x: 300 }, bounds: { width: 400, height: 140 } }, { notify: () => notifications++ });
  assert.equal(v.hover.index, 3); assert.equal(notifications, 1);
  assert.ok(nodes.includes(readoutAt(q.points, 2).when));
  assert.equal(nearestIndex(200, 400, 5), 2);
  assert.equal(JSON.stringify(q), before);
});

test("crypto refresh: the 24h open is the reference; klines that hang, fail or come back malformed keep the last line", async () => {
  const t0 = Date.UTC(2026, 0, 12, 12, 14, 30);
  const klines = (now) => Array.from({ length: 96 }, (_, i) => {
    const t = Math.floor(now / CRYPTO_BAR_MS) * CRYPTO_BAR_MS - (95 - i) * CRYPTO_BAR_MS;
    return [t, String(100 + i / 10), "0", "0", String(100 + (i + 1) / 10)];
  });
  let now = t0, mode = "fresh", release, requested;
  const response = (body, status = 200) => ({ ok: status === 200, status, text: async () => typeof body === "string" ? body : JSON.stringify(body) });
  const w = new Watchlist({ load: () => ({ version: 1, symbols: ["COIN/USDT"], paused: false }), now: () => now, changed: () => {},
    fetch: async (url) => {
      if (!url.includes("klines")) {
        return response({ symbol: "COINUSDT", lastPrice: "110", openPrice: "100", prevClosePrice: "99", openTime: now - 86_400_000, closeTime: now });
      }
      if (mode === "pending") { requested(); return new Promise((_resolve, reject) => { release = reject; }); }
      if (mode === "status") return response({}, 500);
      if (mode === "malformed") return response("invalid sample");
      if (mode === "empty") return response([]);
      return response(klines(now));
    } });
  await w.crypto(["COIN/USDT"], () => true);
  const q = w.quotes["COIN/USDT"];
  assert.equal(q.previousClose, 100); near(q.changePercent, 10);
  assert.equal(q.firstOpen.price, 100);
  const fresh = watchlistSparkline(q, now);
  assert.equal(fresh.line.length, 97);
  assert.ok(fresh.line.at(-1)[1] < fresh.reference, "a gain ends above the reference");
  const kept = { points: q.points, firstOpen: q.firstOpen };
  for (mode of ["status", "malformed"]) {
    now += 60_000;
    await w.crypto(["COIN/USDT"], () => true);
    assert.equal(w.quotes["COIN/USDT"].points, kept.points);
    assert.equal(w.quotes["COIN/USDT"].firstOpen, kept.firstOpen);
    assert.equal(w.quotes["COIN/USDT"].timestamp, now, "the quote itself moved on");
  }
  mode = "pending";
  const started = new Promise((resolve) => { requested = resolve; });
  const pending = w.crypto(["COIN/USDT"], () => true);
  await started;
  assert.equal(w.quotes["COIN/USDT"].points, kept.points, "a hung kline request keeps the line");
  release(new Error("sample no answer")); await pending;
  mode = "empty"; await w.crypto(["COIN/USDT"], () => true);
  const empty = watchlistSparkline(w.quotes["COIN/USDT"], now);
  assert.equal(empty.line.length, 1, "an empty answer leaves only the quote itself");
});
