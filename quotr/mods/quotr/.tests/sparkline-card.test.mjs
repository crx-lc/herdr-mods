// The sparkline's explanation card (it replaced the shell's one-line tooltip, which never wraps and ran
// past the window's edge in a native check). Recording builders, not a GPUI renderer: the native look
// is checked in Herdr itself.
import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSparkline } from "../sparkline.js";
import { fixture, NOW } from "./helpers/spark-fixtures.mjs";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

const byId = (tree, id) => walk(tree).find(n => n.calls?.some(c => c[0] === "id" && c[1] === id));
const call = (node, name) => node.calls.find(c => c[0] === name);
const content = popup => call(popup, "content")?.[1];
function host() {
  const cx = { notified: 0, timers: [], stopped: false,
    notify() { this.notified++; }, stop_propagation() { this.stopped = true; },
    timer: { after: (ms, fn) => { cx.timers.push({ ms, fn }); } } };
  return cx;
}
const hover = (popup, symbol, inside, cx) => call(byId(popup, `quotr-spark-${symbol}`), "on_hover")[1](inside, cx);
const press = (popup, symbol, cx) => {
  const down = call(byId(popup, `quotr-spark-${symbol}`), "on_mouse_down");
  assert.equal(down[1], "left");
  down[2]({}, cx);
};
const texts = card => card.nodes.map(n => n.nodes.join(""));

test("notes are the description's paragraphs, in order, for stock, crypto and a missing reference", () => {
  for (const q of [fixture(), fixture(undefined, { symbol: "COIN/USDT" }), fixture(undefined, { previousClose: null }),
    fixture([]), fixture(undefined, { fetchedAt: null })]) {
    const g = watchlistSparkline(q, NOW);
    assert.equal(g.notes.join(" "), g.description);
    assert.match(g.notes[0], /^Top: observed/);
    assert.equal(g.notes.filter(n => /^Bottom/.test(n)).length, 1, "the lower rail has its own paragraph");
    assert.ok(g.notes.every(n => n.length > 0 && !/NaN|undefined/.test(n)));
  }
});

test("the chart is a Popup trigger with no card and no shell tooltip until the pointer rests on it", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  const popup = v.watchlistChart(fixture(), theme.ansi2, theme, NOW);
  assert.equal(popup.kind, "popup");
  assert.equal(call(popup, "popup")[1], "quotr-spark-tip-SAMPLE");
  assert.ok(call(popup, "flex_none"), "the wrapper keeps the 56px box from shrinking in the row");
  assert.equal(content(popup), undefined);
  assert.ok(!walk(popup).some(n => n.calls?.some(c => c[0] === "tooltip")));
});

test("resting opens a wrapped card that fits a 300px panel and shows every note, the rail's included", async () => {
  const { ChartParts } = await views(); const v = new ChartParts(); const cx = host();
  const q = fixture(undefined, { previousClose: 100, price: 130, changePercent: 30 });
  hover(v.watchlistChart(q, theme.ansi2, theme, NOW), "SAMPLE", true, cx);
  assert.equal(cx.timers.length, 1); assert.equal(cx.timers[0].ms, 500);
  assert.equal(content(v.watchlistChart(q, theme.ansi2, theme, NOW)), undefined, "nothing before the delay");
  cx.timers[0].fn(cx);
  assert.equal(cx.notified, 1);
  const card = content(v.watchlistChart(q, theme.ansi2, theme, NOW));
  assert.ok(card, "card is open");
  const width = call(card, "w")[1];
  assert.ok(width > 0 && width <= 300 - 2 * 12, `card width ${width} fits inside a 300px panel`);
  assert.ok(call(card, "whitespace_normal"), "the card's text wraps");
  assert.ok(!walk(card).some(n => n.calls?.some(c => c[0] === "whitespace_nowrap" || c[0] === "truncate")));
  assert.ok(call(card, "bg") && call(card, "border_1"), "an opaque surface, readable over the rows below");
  const g = watchlistSparkline(q, NOW);
  assert.deepEqual(texts(card), g.notes);
  assert.ok(texts(card).some(n => /^Bottom: \+30\.00% vs previous regular close 100\.00 USD/.test(n)));
  card.nodes.forEach(p => assert.ok(call(p, "w_full"), "each paragraph wraps at the card's width"));
});

test("leaving closes the card, and a timer from an earlier rest never reopens it", async () => {
  const { ChartParts } = await views(); const v = new ChartParts(); const cx = host();
  const chart = () => v.watchlistChart(fixture(), theme.ansi2, theme, NOW);
  hover(chart(), "SAMPLE", true, cx);
  hover(chart(), "SAMPLE", false, cx);
  assert.equal(v.sparkTip, null); assert.equal(cx.notified, 1);
  cx.timers[0].fn(cx);
  assert.equal(content(chart()), undefined, "stale timer ignored");
  assert.equal(cx.notified, 1);
  hover(chart(), "SAMPLE", true, cx); hover(chart(), "SAMPLE", true, cx);
  assert.equal(cx.timers.length, 2, "a repeated entry report does not restart the delay");
  cx.timers[1].fn(cx); assert.ok(content(chart()));
  hover(chart(), "SAMPLE", false, cx);
  assert.equal(content(chart()), undefined);
});

test("a press closes the card without stopping the row's click, so the detail never opens under it", async () => {
  const { Quotr } = await views(); const v = new Quotr(); const cx = host();
  v.watch = { preferences: { symbols: ["SAMPLE"], paused: false }, quotes: { SAMPLE: fixture() },
    errors: {}, message: "", inflight: new Set() };
  v.assetIcon = () => element(); v.logoCredits = () => []; v.openDetail = s => { v.opened = s; };
  const panel = () => v.panel(element(), theme);
  hover(panel(), "SAMPLE", true, cx); cx.timers[0].fn(cx);
  assert.ok(content(byId(panel(), "quotr-row-SAMPLE").nodes.flatMap(walk).find(n => n.kind === "popup")));
  press(panel(), "SAMPLE", cx);
  assert.equal(cx.stopped, false, "the press reaches the row");
  assert.equal(v.sparkTip, null);
  call(byId(panel(), "quotr-row-SAMPLE"), "on_click")[1]();
  assert.equal(v.opened, "SAMPLE");
  assert.ok(!walk(panel()).some(n => n.kind === "popup" && content(n)), "no card drawn once the detail opens");
});

test("only the row under the pointer shows a card; moving to another row hands it over", async () => {
  const { Quotr } = await views(); const v = new Quotr(); const cx = host();
  v.watch = { preferences: { symbols: ["SAMPLE", "COIN/USDT"], paused: false },
    quotes: { SAMPLE: fixture(), "COIN/USDT": fixture(undefined, { symbol: "COIN/USDT" }) },
    errors: {}, message: "", inflight: new Set() };
  v.assetIcon = () => element(); v.logoCredits = () => [];
  const open = () => walk(v.panel(element(), theme)).filter(n => n.kind === "popup" && content(n))
    .map(n => call(n, "popup")[1]);
  hover(v.panel(element(), theme), "SAMPLE", true, cx); cx.timers[0].fn(cx);
  assert.deepEqual(open(), ["quotr-spark-tip-SAMPLE"]);
  hover(v.panel(element(), theme), "SAMPLE", false, cx);
  hover(v.panel(element(), theme), "COIN/USDT", true, cx);
  cx.timers[0].fn(cx);
  assert.deepEqual(open(), [], "the first row's late timer opens nothing");
  cx.timers[1].fn(cx);
  assert.deepEqual(open(), ["quotr-spark-tip-COIN/USDT"]);
  assert.match(texts(content(walk(v.panel(element(), theme)).find(n => n.kind === "popup" && content(n)))).join(" "),
    /rolling 24h reference/);
});
