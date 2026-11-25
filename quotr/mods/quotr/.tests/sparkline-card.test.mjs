// The sparkline's explanation card (it replaced the shell's one-line tooltip, which never wraps and ran
// past the window's edge in a native check). Recording builders, not a GPUI renderer: the native look
// is checked in Herdr itself.
import test from "node:test";
import assert from "node:assert/strict";
import {
  watchlistSparkline, sparkCardPlacement, SPARK_WIDTH, SPARK_CARD_WIDTH, SPARK_CARD_MIN_WIDTH, SPARK_CARD_GAP,
  SPARK_CARD_MARGIN,
} from "../sparkline.js";
import { fixture, NOW } from "./helpers/spark-fixtures.mjs";
import { views, walk, element, theme, viewport } from "./helpers/view-harness.mjs";

const byId = (tree, id) => walk(tree).find(n => n.calls?.some(c => c[0] === "id" && c[1] === id));
const call = (node, name) => node.calls.find(c => c[0] === name);
const content = popup => call(popup, "content")?.[1];
const popupOf = tree => walk(tree).find(n => n.kind === "popup");
const cardOf = tree => { const p = popupOf(tree); return p && content(p); };
function host() {
  const cx = { notified: 0, timers: [], stopped: false,
    notify() { this.notified++; }, stop_propagation() { this.stopped = true; },
    timer: { after: (ms, fn) => { cx.timers.push({ ms, fn }); } } };
  return cx;
}
const handler = (tree, symbol, name) => call(byId(tree, `quotr-spark-${symbol}`), name);
const hover = (tree, symbol, inside, cx) => handler(tree, symbol, "on_hover")[1](inside, cx);
// The pointer at window x `x`, `local` px into the 56px sparkline.
const move = (tree, symbol, x, local = 20) => handler(tree, symbol, "on_mouse_move")[1](
  { position: { x, y: 700 }, local_position: { x: local, y: 10 }, bounds: { x: x - local, y: 690, width: 56, height: 22 } });
const press = (tree, symbol, cx) => {
  const down = handler(tree, symbol, "on_mouse_down");
  assert.equal(down[1], "left");
  down[2]({}, cx);
};
const texts = card => card.nodes.map(n => n.nodes.join(""));
// Rest on SAMPLE's sparkline (its left edge at window x `left`) until the card is open.
function rest(v, cx, q = fixture(), left = 1130) {
  const chart = () => v.watchlistChart(q, theme.ansi2, theme, NOW);
  move(chart(), "SAMPLE", left + 20); hover(chart(), "SAMPLE", true, cx); cx.timers.at(-1).fn(cx);
  return chart;
}
// Where the card lands, in window x, from how the Popup's stand-in trigger is pinned to the sparkline.
function cardSpan(popup, left) {
  const at = left + call(popup, "left")[1];
  const pin = popup.nodes[0];
  const pinWidth = call(pin, "w")[1];
  const width = call(content(popup), "w")[1];
  return call(popup, "anchor")[1] === "top_right" ? [at + pinWidth - width, at + pinWidth] : [at, at + width];
}

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

test("placement: beside the sparkline, never over it, inside the window", () => {
  // Quotr docked right at 300px in the default 1280px window: plenty of room on the left.
  assert.deepEqual(sparkCardPlacement({ left: 1130, width: 56 }, 1280), { side: "left", width: SPARK_CARD_WIDTH });
  // Docked left: the right side.
  assert.deepEqual(sparkCardPlacement({ left: 150, width: 56 }, 1280), { side: "right", width: SPARK_CARD_WIDTH });
  // Tight on both sides: the roomier one, narrower.
  assert.deepEqual(sparkCardPlacement({ left: 250, width: 56 }, 540), { side: "left", width: 250 - SPARK_CARD_GAP - SPARK_CARD_MARGIN });
  // No usable room, or nothing known: the Popup's own placement under the row.
  assert.equal(sparkCardPlacement({ left: 100, width: 56 }, 300).side, "below");
  for (const [trigger, vw] of [[null, 1280], [{ left: 1130, width: 56 }, undefined], [{ left: NaN, width: 56 }, 1280],
    [{ left: 1130 }, 1280], [{ left: 1130, width: -1 }, 1280], [{ left: 1130, width: 56 }, 0]]) {
    assert.equal(sparkCardPlacement(trigger, vw).side, "below", JSON.stringify([trigger, vw]));
  }
  for (let vw = 320; vw <= 2560; vw += 37) {
    for (let left = 0; left + 56 <= vw; left += 13) {
      const p = sparkCardPlacement({ left, width: 56 }, vw);
      assert.ok(p.width >= SPARK_CARD_MIN_WIDTH && p.width <= SPARK_CARD_WIDTH, `width ${p.width}`);
      if (p.side === "below") continue;
      const [from, to] = p.side === "left" ? [left - SPARK_CARD_GAP - p.width, left - SPARK_CARD_GAP]
        : [left + 56 + SPARK_CARD_GAP, left + 56 + SPARK_CARD_GAP + p.width];
      assert.ok(to <= left || from >= left + 56, `card ${from}..${to} clear of the sparkline at ${left}`);
      assert.ok(from >= SPARK_CARD_MARGIN && to <= vw - SPARK_CARD_MARGIN, `card ${from}..${to} inside ${vw}`);
    }
  }
});

test("the chart has no card and no shell tooltip until the pointer rests on it", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  const box = v.watchlistChart(fixture(), theme.ansi2, theme, NOW);
  assert.ok(call(box, "flex_none"), "the 56px box doesn't shrink in the row");
  assert.equal(call(box, "id")[1], "quotr-spark-SAMPLE");
  assert.equal(popupOf(box), undefined);
  assert.ok(!walk(box).some(n => n.calls?.some(c => c[0] === "tooltip")));
});

test("resting opens a wrapped card beside the sparkline, clear of it, showing every note", async () => {
  const { ChartParts } = await views(); const v = new ChartParts(); const cx = host();
  const q = fixture(undefined, { previousClose: 100, price: 130, changePercent: 30 });
  const chart = () => v.watchlistChart(q, theme.ansi2, theme, NOW);
  move(chart(), "SAMPLE", 1150); hover(chart(), "SAMPLE", true, cx);
  assert.equal(cx.timers.length, 1); assert.equal(cx.timers[0].ms, 500);
  assert.equal(popupOf(chart()), undefined, "nothing before the delay");
  cx.timers[0].fn(cx);
  assert.equal(cx.notified, 1);
  const popup = popupOf(chart());
  assert.equal(call(popup, "popup")[1], "quotr-spark-tip-SAMPLE");
  assert.ok(call(popup, "absolute"), "the stand-in trigger is placed against the sparkline, not in the row's flow");
  const [from, to] = cardSpan(popup, 1130);
  assert.ok(to <= 1130 - SPARK_CARD_GAP, `card ${from}..${to} ends left of the sparkline at 1130`);
  assert.ok(from >= SPARK_CARD_MARGIN);
  const card = content(popup);
  assert.equal(call(card, "w")[1], SPARK_CARD_WIDTH);
  assert.ok(call(card, "whitespace_normal"), "the card's text wraps");
  assert.ok(!walk(card).some(n => n.calls?.some(c => c[0] === "whitespace_nowrap" || c[0] === "truncate")));
  assert.ok(call(card, "bg") && call(card, "border_1"), "an opaque surface, readable over what's behind it");
  const g = watchlistSparkline(q, NOW);
  assert.deepEqual(texts(card), g.notes);
  assert.ok(texts(card).some(n => /^Bottom: \+30\.00% vs previous regular close 100\.00 USD/.test(n)));
  card.nodes.forEach(p => assert.ok(call(p, "w_full"), "each paragraph wraps at the card's width"));
});

test("the card goes right of a sparkline near the window's left edge, and under it with nothing known", async () => {
  const { ChartParts } = await views();
  let v = new ChartParts(); let chart = rest(v, host(), fixture(), 150);
  let popup = popupOf(chart());
  assert.equal(call(popup, "anchor")[1], "top_left");
  const [from] = cardSpan(popup, 150);
  assert.ok(from >= 150 + SPARK_WIDTH + SPARK_CARD_GAP, `card starts at ${from}, right of the sparkline`);
  const saved = viewport.size; viewport.size = null;
  try {
    v = new ChartParts(); chart = rest(v, host());
    popup = popupOf(chart());
    assert.equal(call(popup, "anchor")[1], "top_right");
    assert.equal(call(popup.nodes[0], "w")[1], SPARK_WIDTH, "fallback: pinned to the sparkline itself");
    assert.ok(content(popup));
  } finally { viewport.size = saved; }
  // The position tracked for one row is never used for another.
  v = new ChartParts(); v.sparkAt = { symbol: "OTHER", left: 1130, width: 56 };
  const cx = host(); const other = () => v.watchlistChart(fixture(), theme.ansi2, theme, NOW);
  hover(other(), "SAMPLE", true, cx); cx.timers[0].fn(cx);
  assert.equal(call(popupOf(other()), "anchor")[1], "top_right");
  assert.equal(call(popupOf(other()).nodes[0], "w")[1], SPARK_WIDTH);
});

test("tracking the pointer never redraws, and ignores a move with no position", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  const chart = v.watchlistChart(fixture(), theme.ansi2, theme, NOW);
  handler(chart, "SAMPLE", "on_mouse_move")[1]({});
  assert.equal(v.sparkAt, undefined);
  move(chart, "SAMPLE", 1150, 20);
  assert.deepEqual({ ...v.sparkAt }, { symbol: "SAMPLE", left: 1130, width: 56 });
  assert.equal(handler(chart, "SAMPLE", "on_mouse_move")[1].length <= 1, true, "the handler takes no cx");
});

test("leaving closes the card, and a timer from an earlier rest never reopens it", async () => {
  const { ChartParts } = await views(); const v = new ChartParts(); const cx = host();
  const chart = () => v.watchlistChart(fixture(), theme.ansi2, theme, NOW);
  hover(chart(), "SAMPLE", true, cx);
  hover(chart(), "SAMPLE", false, cx);
  assert.equal(v.sparkTip, null); assert.equal(cx.notified, 1);
  cx.timers[0].fn(cx);
  assert.equal(cardOf(chart()), undefined, "stale timer ignored");
  assert.equal(cx.notified, 1);
  hover(chart(), "SAMPLE", true, cx); hover(chart(), "SAMPLE", true, cx);
  assert.equal(cx.timers.length, 2, "a repeated entry report does not restart the delay");
  cx.timers[1].fn(cx); assert.ok(cardOf(chart()));
  hover(chart(), "SAMPLE", false, cx);
  assert.equal(cardOf(chart()), undefined);
});

test("the card closes itself when the pointer leaves it or presses it", async () => {
  const { ChartParts } = await views();
  for (const act of ["leave", "press"]) {
    const v = new ChartParts(); const cx = host(); const chart = rest(v, cx);
    const card = cardOf(chart());
    assert.equal(call(card, "id")[1], "quotr-spark-card-SAMPLE");
    call(card, "on_hover")[1](true, cx);
    assert.ok(cardOf(chart()), "entering the card keeps it");
    if (act === "leave") call(card, "on_hover")[1](false, cx);
    else { const down = call(card, "on_mouse_down"); assert.equal(down[1], "left"); down[2]({}, cx); }
    assert.equal(v.sparkTip, null, act);
    assert.equal(cardOf(chart()), undefined, act);
  }
});

test("a press closes the card without stopping the row's click, so the detail never opens under it", async () => {
  const { Quotr } = await views(); const v = new Quotr(); const cx = host();
  v.watch = { preferences: { symbols: ["SAMPLE"], paused: false }, quotes: { SAMPLE: fixture() },
    errors: {}, message: "", inflight: new Set() };
  v.assetIcon = () => element(); v.logoCredits = () => []; v.openDetail = s => { v.opened = s; };
  const panel = () => v.panel(element(), theme);
  move(panel(), "SAMPLE", 1150); hover(panel(), "SAMPLE", true, cx); cx.timers[0].fn(cx);
  assert.ok(content(byId(panel(), "quotr-row-SAMPLE").nodes.flatMap(walk).find(n => n.kind === "popup")));
  press(panel(), "SAMPLE", cx);
  assert.equal(cx.stopped, false, "the press reaches the row");
  assert.equal(v.sparkTip, null);
  call(byId(panel(), "quotr-row-SAMPLE"), "on_click")[1]();
  assert.equal(v.opened, "SAMPLE");
  assert.ok(!walk(panel()).some(n => n.kind === "popup"), "no card drawn once the detail opens");
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
