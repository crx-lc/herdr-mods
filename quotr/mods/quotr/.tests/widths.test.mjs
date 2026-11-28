// Issue #24: the panel's three widths and how the content gives way below them. Neutral sample data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ASSUMED_WIDTH, ROW, WIDTHS, contentWidth, designWidth, layoutClock, layoutHeader, layoutRows, priceAtoms, textWidth, valuesWidth,
} from "../widths.js";
import { formatChange, formatPrice } from "../quotes.js";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

// An ordinary row: a short ticker and a three-digit price. Long ones: a pair priced in the tens of
// thousands, a tiny price, a long exchange suffix. Exceptional ones, which need a little more than
// the minimum for their chart: a pair with an eight-decimal price, a nine-digit price.
const ordinary = { symbol: "AAPL", price: "182.36 USD", change: "+1.23%", chart: true };
const longPrice = { symbol: "ZQX/USDT", price: "59,565.52 USDT", change: "-2.31%", chart: true };
const tinyPrice = { symbol: "PIX/USDT", price: "0.00004418 USDT", change: "+2.96%", chart: true };
const suffix = { symbol: "MRLW.L", price: "1,245.51 GBP", change: "+0.08%", chart: true };
const sample = [ordinary, longPrice, { symbol: "BLRV", price: "7.43 USD", change: "+12.92%", chart: true }, suffix, tinyPrice];
const exceptional = [
  { symbol: "SHIB/USDT", price: "0.00001234 USDT", change: "-12.34%", chart: true },
  { symbol: "BTC/KRW", price: "134,567,890.00 KRW", change: "-12.34%", chart: true },
];
const stage = (r) => (r.stacked ? 3 : !r.logo ? 2 : !r.chart ? 1 : 0);
const NAMES = ["full", "no chart", "no logo", "stacked"];

test("the owner's three widths, and mod.json asks for the default", async () => {
  assert.deepEqual(WIDTHS, { minimum: 350, default: 410, maximum: 460 });
  const manifest = JSON.parse(await readFile(new URL("../mod.json", import.meta.url), "utf8"));
  assert.equal(manifest.size, WIDTHS.default);
  assert.equal(manifest.place, "right");
  // Before the first measurement the panel is drawn as if at the default.
  assert.equal(ASSUMED_WIDTH, WIDTHS.default);
});

test("Quotr never sizes the host: no resize or layout command anywhere in the view", async () => {
  for (const name of ["main.js", "clockview.js", "charts.js", "logoview.js", "dialog.js", "context.js"]) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /pane\.resize|layout\.(resize|set|switch)|(^|[^.\w])run\(/m, name);
  }
});

test("on_size_change's window px become the px the mod writes; anything else is unknown", () => {
  assert.equal(designWidth({ width: 492, height: 600 }, 1.2), 410);
  assert.equal(designWidth({ width: 300 }, 1), 300);
  assert.equal(designWidth({ width: 300 }, undefined), 300, "no zoom: zoom 1");
  assert.equal(designWidth({ width: 300 }, 0), 300);
  for (const bad of [null, undefined, {}, { width: 0 }, { width: -5 }, { width: NaN }, { width: "wide" }]) assert.equal(designWidth(bad, 1), null);
});

test("the content stops growing at the maximum useful width", () => {
  assert.equal(contentWidth(520), 460);
  assert.equal(contentWidth(460), 460);
  assert.equal(contentWidth(461), 460);
  assert.equal(contentWidth(410), 410);
  assert.equal(contentWidth(null), 410);
  assert.deepEqual(layoutRows(900, [...sample, ...exceptional]), layoutRows(460, [...sample, ...exceptional]));
  assert.deepEqual(layoutHeader(900, ["Reorder", "Refresh", "Pause"]), layoutHeader(460, ["Reorder", "Refresh", "Pause"]));
});

test("estimates are never narrower than what Herdr's UI font draws (measured at zoom 1 on Windows)", () => {
  // [text, size, regular, measured ink width in px]
  const measured = [
    ["AAPL", 12.5, false, 34], ["NVDA", 12.5, false, 36], ["MSFT", 12.5, false, 35], ["WWWW", 12.5, false, 50],
    ["IIII", 12.5, false, 14], ["^GSPC", 12.5, false, 41], ["0700.HK", 12.5, false, 54], ["BRK-B", 12.5, false, 40],
    ["ES=F", 12.5, false, 31], ["QQQQ", 12.5, false, 39], ["ZZZZ", 12.5, false, 30],
    ["111.11 USD", 12.5, true, 55], ["222.22 USD", 12.5, true, 69], ["555.55 USD", 12.5, true, 70],
    ["6,666.66 USD", 12.5, true, 78], ["77,777.77 HKD", 12.5, true, 80], ["1,000.00 USD", 12.5, true, 80],
    ["0.0001234 USD", 12.5, true, 92], ["182.36 USD", 12.5, true, 66], ["59,565.52 USDT", 12.5, true, 95],
    ["0.00004418 USDT", 12.5, true, 108], ["18,432.65 USD", 12.5, true, 84],
    ["+1.25%", 11, true, 35], ["+12.45%", 11, true, 42], ["+15.65%", 11, true, 42],
  ];
  for (const [text, size, regular, ink] of measured) {
    const estimate = textWidth(text, size, { regular });
    assert.ok(estimate >= ink + 0.5, `${text}: ${estimate} under ${ink}`);
    assert.ok(estimate <= ink * 1.15 + 2, `${text}: ${estimate} far over ${ink}`);
  }
  assert.equal(textWidth("", 12.5), 0);
  assert.equal(textWidth(null, 12.5), 0);
  assert.ok(textWidth("日本", 12.5) >= 25, "an unknown character counts as a full em");
});

test("at the minimum and wider, every row keeps today's look: logo, symbol, chart, price and change", () => {
  const rows = [...sample, { ...ordinary, symbol: "GOOG" }, { symbol: "^GSPC", price: "6,812.34 USD", change: "+0.45%", chart: true },
    { symbol: "BTC/USDT", price: "109,565.51 USDT", change: "-2.31%", chart: true },
    { symbol: "BTC/JPY", price: "14,023,456.00 JPY", change: "-2.31%", chart: true },
    { symbol: "005930.KS", price: "54,300.00 KRW", change: "+0.31%", chart: true },
    { symbol: "BRK-A", price: "712,345.67 USD", change: "+0.31%", session: true, chart: true }];
  for (const width of [350, 380, 410, 460, 520]) {
    // Each row alone, and all of them together.
    for (const r of rows) assert.deepEqual(stage(layoutRows(width, [r]).rows[0]), 0, `${r.symbol} at ${width}`);
    assert.ok(layoutRows(width, rows).rows.every((r) => stage(r) === 0), `all at ${width}`);
  }
  // With the day's tick or the update dot (one shared slot) and the price's tint counted.
  assert.equal(valuesWidth(ordinary), ROW.marker + ROW.tint + textWidth("182.36 USD", 12.5, { regular: true }));
  // A pre-market or after-hours icon needs its own room too.
  assert.ok(valuesWidth({ ...ordinary, session: true }) === valuesWidth(ordinary) + ROW.session);
});

test("only exceptional prices need more than the minimum for their chart, and by how much", () => {
  const needs = (r) => { for (let w = 520; w >= 100; w--) if (!layoutRows(w, [r]).rows[0].chart) return w + 1; return 100; };
  assert.deepEqual(exceptional.map(needs), [356, 363]);
  for (const r of exceptional) {
    // Short of the chart at the minimum, they still keep their logo, symbol, price and change.
    assert.equal(NAMES[stage(layoutRows(WIDTHS.minimum, [r]).rows[0])], "no chart");
    assert.equal(NAMES[stage(layoutRows(WIDTHS.default, [r]).rows[0])], "full");
  }
});

test("at the minimum and wider, ordinary rows keep today's 108 px values column, so their charts line up", () => {
  for (const width of [350, 410, 460, 520]) {
    const laid = layoutRows(width, sample);
    assert.equal(laid.column, 108, `at ${width}`);
    for (const [i, row] of laid.rows.entries()) if (row.chart && valuesWidth(sample[i]) <= 108) assert.equal(row.values, 108);
    // The two long prices take wider columns of their own.
    assert.ok(laid.rows[1].values > 108 && laid.rows[4].values > 108);
  }
});

test("below the minimum the shared column narrows before an ordinary row gives anything up", () => {
  const at280 = layoutRows(280, sample);
  assert.ok(at280.column < 108);
  assert.equal(at280.rows[0].values, at280.column);
  assert.ok(at280.rows[0].chart);
});

test("a row gives way in one order: the chart, then the logo, then the values move under the symbol", () => {
  const cases = [...sample, { symbol: "WWWW.TO", price: "77,777.77 CAD", change: "-10.55%", chart: true },
    { symbol: "SAMPLE", price: "Unavailable", change: "—", chart: false },
    { symbol: "AAPL", price: "182.36 USD", change: "+1.23%", session: true, chart: true }];
  for (const r of cases) {
    let last = 0;
    const seen = [];
    for (let width = 520; width >= 100; width -= 2) {
      const row = layoutRows(width, [r]).rows[0];
      const s = stage(row);
      assert.ok(s >= last, `${r.symbol}: back to ${NAMES[s]} at ${width}`);
      assert.ok(!(row.chart && !row.logo), `${r.symbol}: the logo went before the chart at ${width}`);
      if (s !== last || !seen.length) seen.push(s);
      last = s;
    }
    assert.equal(last, 3, `${r.symbol} ends with its values under the symbol`);
    assert.deepEqual(seen, [...new Set(seen)].sort(), r.symbol);
  }
  // Each stage fits exactly what it shows: no row is laid out wider than its content width.
  for (let width = 100; width <= 520; width += 5) {
    for (const [i, row] of layoutRows(width, sample).rows.entries()) {
      if (row.stacked) continue;
      const it = sample[i];
      const used = ROW.chrome + (row.logo ? ROW.logo + ROW.logoGap : 0) + textWidth(it.symbol, 12.5)
        + (row.chart ? ROW.clear + ROW.chart : 0) + ROW.gap + row.values;
      assert.ok(used <= contentWidth(width) + 1e-9, `${it.symbol} at ${width}: ${used}`);
    }
  }
});

test("the thresholds for the sample rows, row by row", () => {
  const at = (width) => layoutRows(width, sample).rows.map((r) => NAMES[stage(r)]);
  assert.deepEqual(at(460), ["full", "full", "full", "full", "full"]);
  assert.deepEqual(at(350), ["full", "full", "full", "full", "full"]);
  assert.deepEqual(at(320), ["full", "no chart", "full", "full", "no chart"]);
  assert.deepEqual(at(300), ["full", "no chart", "full", "no chart", "no chart"]);
  assert.deepEqual(at(280), ["full", "no chart", "full", "no chart", "no logo"]);
  assert.deepEqual(at(240), ["no chart", "no logo", "no chart", "no logo", "stacked"]);
  assert.deepEqual(at(160), ["stacked", "stacked", "stacked", "stacked", "stacked"]);
  // Stacked rows split their price only when even the values alone are wider than the row.
  const split = (width) => layoutRows(width, sample).rows.map((r) => Boolean(r.split));
  assert.deepEqual(split(200), [false, false, false, false, false]);
  assert.deepEqual(split(150), [false, true, false, false, true]);
  assert.deepEqual(split(350), [false, false, false, false, false]);
});

test("while reordering the move buttons never give way: the logo goes first, then the values", () => {
  for (let width = 520; width >= 120; width -= 4) {
    for (const row of layoutRows(width, sample, { reordering: true }).rows) assert.equal(row.chart, true, `at ${width}`);
  }
  const tight = layoutRows(240, [longPrice], { reordering: true }).rows[0];
  assert.equal(tight.logo, false);
  // Stacked, the buttons stay beside the symbol; only when even that pair doesn't fit do they go under it.
  const stacked = layoutRows(200, [longPrice], { reordering: true }).rows[0];
  assert.deepEqual([stacked.stacked, stacked.slotBelow], [true, undefined]);
  const tighter = layoutRows(150, [longPrice], { reordering: true }).rows[0];
  assert.deepEqual([tighter.stacked, tighter.slotBelow], [true, true]);
  assert.equal(layoutRows(150, [longPrice]).rows[0].slotBelow, undefined, "only while reordering");
});

test("a stacked row in reorder mode keeps its buttons on the symbol's line", async () => {
  const { Quotr } = await views();
  const lineOf = (width) => {
    const v = sampleView(Quotr, ["ZQX/USDT", "AAPL"], width);
    v.reordering = true;
    const row = walk(v.panel(element(), theme)).find((n) => n.calls?.some((c) => c[0] === "id" && c[1] === "quotr-row-ZQX/USDT"));
    const block = row.nodes[0];
    return { block, buttons: ids(block.nodes[0]).includes("quotr-move-top-ZQX/USDT"), all: ids(block).includes("quotr-move-top-ZQX/USDT") };
  };
  const at200 = lineOf(200);
  assert.equal(at200.block.kind, "column");
  assert.ok(at200.buttons, "the buttons sit on the first line, beside the symbol");
  const at150 = lineOf(150);
  assert.ok(!at150.buttons && at150.all, "under the symbol when the pair doesn't fit");
});

test("a price splits only between its number and its currency; numbers and percents stay whole", () => {
  const prices = [
    formatPrice({ price: 59565.52, currency: "USDT" }), formatPrice({ price: 0.00004418, currency: "USDT" }),
    formatPrice({ price: 1234567.891, currency: "KRW" }), formatPrice({ price: 182.36, currency: null }), "Unavailable", "Waiting…",
  ];
  assert.deepEqual(priceAtoms(prices[0]), ["59,565.52", "USDT"]);
  assert.deepEqual(priceAtoms(prices[1]), ["0.00004418", "USDT"]);
  assert.deepEqual(priceAtoms(prices[2]), ["1,234,567.89", "KRW"]);
  assert.deepEqual(priceAtoms(prices[3]), ["182.36"]);
  for (const text of prices) assert.equal(priceAtoms(text).join(" "), text);
  assert.deepEqual(priceAtoms(""), []);
  for (const change of [formatChange(-12.345), formatChange(0), formatChange(null)]) assert.deepEqual(priceAtoms(change), [change]);
});

test("the header: today's line at the minimum and down to 290, then tighter buttons, no title, wrapping", () => {
  const labels = ["Reorder", "Refresh", "Pause"];
  for (const width of [WIDTHS.minimum, WIDTHS.default, WIDTHS.maximum]) {
    assert.deepEqual(layoutHeader(width, labels), { compact: false, title: true, wrap: false });
    assert.deepEqual(layoutHeader(width, ["Done", "Refresh", "Resume"]), { compact: false, title: true, wrap: false });
  }
  assert.deepEqual(layoutHeader(290, labels), { compact: false, title: true, wrap: false });
  assert.deepEqual(layoutHeader(280, labels), { compact: true, title: true, wrap: false });
  assert.deepEqual(layoutHeader(240, labels), { compact: true, title: false, wrap: false });
  assert.deepEqual(layoutHeader(200, labels), { compact: true, title: false, wrap: true });
  // The longer labels (Resume, and Done while reordering) need a little more.
  assert.equal(layoutHeader(290, ["Done", "Refresh", "Resume"]).compact, false);
  // One ticker: no Reorder button, so more room.
  assert.equal(layoutHeader(240, ["Refresh", "Pause"]).title, true);
  let last = 0;
  for (let width = 520; width >= 120; width--) {
    const f = layoutHeader(width, labels);
    const s = f.wrap ? 3 : !f.title ? 2 : f.compact ? 1 : 0;
    assert.ok(s >= last, `header back at ${width}`);
    last = s;
  }
});

test("the clock: today's line at the minimum, then without the date, then on two lines", () => {
  const text = { time: "11:53", day: "Sat Nov 28", phase: "Weekend", countdown: "1d 21h" };
  // The clock is the panel's width less 24 px of padding.
  assert.deepEqual(layoutClock(WIDTHS.minimum - 24, text), { day: true, wrap: false });
  assert.deepEqual(layoutClock(WIDTHS.maximum - 24, text), { day: true, wrap: false });
  assert.deepEqual(layoutClock(200, text), { day: false, wrap: false });
  assert.deepEqual(layoutClock(150, text), { day: false, wrap: true });
  // Unavailable schedule: a long phase, no countdown; the whole line still fits at the minimum.
  const off = { time: "11:53", day: "Sat Nov 28", phase: "Market schedule unavailable", countdown: "" };
  assert.deepEqual(layoutClock(WIDTHS.minimum - 24, off), { day: true, wrap: false });
  assert.deepEqual(layoutClock(256, off), { day: false, wrap: false });
  assert.equal(layoutClock(180, off).wrap, true);
  // Not measured yet: today's line.
  assert.deepEqual(layoutClock(null, text), { day: true, wrap: false });
});

// The real panel, drawn by the harness at a given width.
function sampleView(Quotr, symbols, width) {
  const v = new Quotr();
  const quote = (symbol, price, currency, changePercent) => ({ symbol, name: `${symbol} Sample Holdings`, price, currency, changePercent,
    timestamp: Date.now(), fetchedAt: Date.now(), series: [1, 2, 3], points: [], previousClose: price });
  v.watch = { preferences: { symbols, paused: false },
    quotes: { AAPL: quote("AAPL", 182.36, "USD", 1.23), "ZQX/USDT": quote("ZQX/USDT", 59565.52, "USDT", -2.31), BLRV: quote("BLRV", 7.43, "USD", 12.92) },
    errors: {}, message: "", inflight: new Set(), remove: () => {} };
  v.assetIcon = (symbol) => element("logo").id(`logo-${symbol}`);
  v.watchlistChart = (q) => element("chart").id(`quotr-spark-${q.symbol}`);
  v.logoCredits = () => [];
  v.width = width;
  return v;
}
const ids = (tree) => walk(tree).flatMap((n) => (n.calls ?? []).filter((c) => c[0] === "id").map((c) => c[1]));
const texts = (node) => walk(node).filter((n) => typeof n === "string");

test("the panel draws what the layout decides: charts, logos and stacked values", async () => {
  const { Quotr } = await views();
  const symbols = ["AAPL", "ZQX/USDT", "BLRV"];
  const at = (width) => ids(sampleView(Quotr, symbols, width).panel(element(), theme));
  const wide = at(350);
  for (const s of symbols) assert.ok(wide.includes(`quotr-spark-${s}`) && wide.includes(`logo-${s}`), s);
  const narrow = at(280);
  assert.ok(narrow.includes("quotr-spark-AAPL") && narrow.includes("logo-AAPL"));
  assert.ok(!narrow.includes("quotr-spark-ZQX/USDT") && narrow.includes("logo-ZQX/USDT"), "the long row's chart went first");
  const tiny = at(160);
  assert.ok(symbols.every((s) => !tiny.includes(`quotr-spark-${s}`) && !tiny.includes(`logo-${s}`)));
  // Every row keeps its remove button and its click at every width.
  for (const list of [wide, narrow, tiny]) for (const s of symbols) assert.ok(list.includes(`quotr-remove-${s}`) && list.includes(`quotr-row-${s}`));
});

test("the price is one text, or whole atoms when it sits under the symbol; the change is one text", async () => {
  const { Quotr } = await views();
  const find = (tree, id) => walk(tree).find((n) => n.calls?.some((c) => c[0] === "id" && c[1] === id));
  const one = find(sampleView(Quotr, ["ZQX/USDT"], 350).panel(element(), theme), "quotr-price-ZQX/USDT");
  assert.deepEqual(texts(one), ["59,565.52 USDT"]);
  // Under the symbol, still one line while it fits there.
  const under = find(sampleView(Quotr, ["ZQX/USDT"], 200).panel(element(), theme), "quotr-price-ZQX/USDT");
  assert.deepEqual(texts(under), ["59,565.52 USDT"]);
  // Narrower: the number and the currency take a line each.
  const split = find(sampleView(Quotr, ["ZQX/USDT"], 120).panel(element(), theme), "quotr-price-ZQX/USDT");
  assert.equal(split.kind, "column");
  assert.deepEqual(texts(split), ["59,565.52", "USDT"]);
  const all = texts(sampleView(Quotr, ["ZQX/USDT"], 120).panel(element(), theme));
  assert.ok(all.includes("-2.31%"));
});

test("the content is capped at the maximum useful width; the symbol never truncates by layout", async () => {
  const { Quotr } = await views();
  const tree = sampleView(Quotr, ["AAPL"], 900).panel(element(), theme);
  const content = walk(tree).find((n) => n.calls?.some((c) => c[0] === "id" && c[1] === "quotr-content"));
  assert.ok(content.calls.some((c) => c[0] === "max_w" && c[1] === 460));
  // Before the first measurement: the default width's layout.
  const first = ids(sampleView(Quotr, ["AAPL", "ZQX/USDT"], null).panel(element(), theme));
  assert.ok(first.includes("quotr-spark-AAPL") && first.includes("quotr-spark-ZQX/USDT"));
});

test("the update dot and the tick arrow share one slot left of the price", async () => {
  const { Quotr } = await views();
  const v = sampleView(Quotr, ["AAPL"], 320);
  v.flashes = { AAPL: { dir: "up", id: 1, on: false } };
  assert.ok(texts(v.panel(element(), theme)).includes("▲"));
  v.watch.inflight = new Set(["AAPL"]);
  assert.ok(!texts(v.panel(element(), theme)).includes("▲"), "during the refresh only the dot shows");
});
