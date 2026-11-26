// Trading volume in the Details dialog (issue #40): only volume that holds up is shown.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanVolume, formatVolume, decodeYahoo, decodeBinance } from "../quotes.js";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

const ok = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
const NOW = Date.UTC(2026, 10, 25, 18, 0);
const yahoo = (meta) => decodeYahoo("SAMPLE", ok({ chart: { result: [{
  meta: { symbol: "SAMPLE", currency: "USD", regularMarketPrice: 80, regularMarketTime: NOW / 1000 - 60, previousClose: 78, ...meta },
  timestamp: [], indicators: { quote: [{}] } }] } }), NOW);
const binance = (fields) => decodeBinance(["COIN/USDT"], ok({ symbol: "COINUSDT", lastPrice: "100", openPrice: "99",
  openTime: NOW - 86_400_000, closeTime: NOW, ...fields }), NOW)["COIN/USDT"];

test("only a finite volume above zero is a volume", () => {
  for (const bad of [undefined, null, 0, -1, NaN, Infinity, "", " ", "abc", "-5", "1e20", 1e15, {}, [], true]) {
    assert.equal(cleanVolume(bad), null, JSON.stringify(bad));
  }
  assert.equal(cleanVolume(267_835_598), 267_835_598);
  assert.equal(cleanVolume("1476515177.05"), 1476515177.05);
});

test("volumes are written short, by hand", () => {
  const cases = [[950, "950"], [999.4, "999.4"], [1_000, "1.00K"], [12_345, "12.3K"], [999_960, "1.00M"],
    [267_835_598, "267.8M"], [1_476_515_177.05, "1.48B"], [5.2e12, "5.20T"], [3.5, "3.50"], [0.0042, "0.0042"],
    [null, "—"], [0, "—"], ["abc", "—"]];
  for (const [value, text] of cases) assert.equal(formatVolume(value), text, String(value));
});

test("decoders: Yahoo's regular-session volume, Binance's 24h quote volume, or none", () => {
  assert.equal(yahoo({ regularMarketVolume: 267_835_598 }).volume, 267_835_598);
  for (const bad of [undefined, 0, -3, "many", null]) assert.equal(yahoo({ regularMarketVolume: bad }).volume, null, String(bad));
  assert.equal(binance({ volume: "25035.0", quoteVolume: "1476515177.05" }).volume, 1476515177.05, "the quote currency, not the base coin");
  for (const bad of [undefined, "0", "-1", "n/a", ""]) assert.equal(binance({ quoteVolume: bad }).volume, null, String(bad));
});

async function dialog(quote) {
  const { DialogParts, ChartParts } = await views();
  const v = Object.create(DialogParts.prototype);
  for (const name of Object.getOwnPropertyNames(ChartParts.prototype)) if (name !== "constructor") v[name] = ChartParts.prototype[name];
  Object.assign(v, { detail: quote, range: "1D", hover: null, pending: new Set(), historyErrors: {}, extPending: false,
    assetIcon: () => element(), logoChoice: () => [], extendedParts: () => [], rangeTabs: () => element() });
  return walk(v.detailView(theme));
}
const statRow = (nodes, first) => nodes.find((n) => n.kind === "row" && walk(n).includes(first) && n.nodes.length >= 3);
const labels = (row) => row.nodes.map((col) => walk(col).find((x) => typeof x === "string"));

test("the 1D stats get a fifth column, Volume, when the volume is known", async () => {
  const stock = { ...yahoo({ regularMarketVolume: 267_835_598 }), points: [], series: [] };
  let nodes = await dialog(stock);
  assert.deepEqual(labels(statRow(nodes, "Open")), ["Open", "High", "Low", "Prev close", "Volume"]);
  assert.ok(nodes.includes("267.8M"));
  nodes = await dialog({ ...stock, volume: null });
  assert.deepEqual(labels(statRow(nodes, "Open")), ["Open", "High", "Low", "Prev close"], "no volume, no column");
  nodes = await dialog({ ...stock, volume: "garbage" });
  assert.equal(statRow(nodes, "Open").nodes.length, 4, "a malformed cached volume shows nothing");
});

test("a pair's 1D stats show its 24h volume in the quote currency", async () => {
  const pair = binance({ quoteVolume: "1476515177.05" });
  const nodes = await dialog(pair);
  assert.deepEqual(labels(statRow(nodes, "24h open")), ["24h open", "24h high", "24h low", "24h volume"]);
  assert.ok(nodes.includes("1.48B USDT"));
  assert.equal(statRow(await dialog({ ...pair, volume: 0 }), "24h open").nodes.length, 3);
});

// 1W / 1M / 1Y: volume bars and the period total, only from volumes that hold up.
import { decodeYahooHistory, decodeBinanceHistory, rangeWindow, summarize } from "../history.js";
import { historyStub } from "./helpers/view-harness.mjs";

const DAY_MS = 86_400_000;
const yahooHistory = (range, granularity, times, close, volume) => decodeYahooHistory("SAMPLE", range, ok({ chart: { result: [{
  meta: { symbol: "SAMPLE", dataGranularity: granularity, gmtoffset: -18_000 },
  timestamp: times.map((t) => t / 1000), indicators: { quote: [{ close, high: close, low: close, volume }] } }] } }), rangeWindow(range, NOW));
const klines = (rows) => decodeBinanceHistory("COIN/USDT", "1M", ok(rows), rangeWindow("1M", NOW));
const days = (n) => Array.from({ length: n }, (_, i) => NOW - (n - i) * DAY_MS);

test("Yahoo daily bars carry their volume; one bar without leaves the whole period without", () => {
  const h = yahooHistory("1M", "1d", days(3), [10, 11, 12], [1_000_000, 2_000_000, 3_500_000]);
  assert.equal(h.volumes, true);
  assert.equal(summarize(h, NOW).volume, 6_500_000);
  for (const bad of [[1_000_000, null, 3], [1_000_000, 0, 3], [1_000_000, -1, 3], [1_000_000, "x", 3], undefined]) {
    const g = yahooHistory("1M", "1d", days(3), [10, 11, 12], bad);
    assert.equal(g.volumes, false, JSON.stringify(bad)); assert.equal(summarize(g, NOW).volume, null);
  }
});

test("Yahoo's intraday (1W, 30-minute) volumes are never used", () => {
  const times = [NOW - 3 * 1_800_000, NOW - 2 * 1_800_000, NOW - 1_800_000];
  const h = yahooHistory("1W", "30m", times, [10, 11, 12], [100, 200, 300]);
  assert.equal(h.volumes, false); assert.equal(summarize(h, NOW).volume, null);
});

test("Binance klines carry their quote-currency volume ([7]); a malformed one drops the period's volume", () => {
  const t = days(3);
  const row = (i, quoteVolume) => [t[i], "10", "11", "9", "10.5", "999", t[i] + 1, quoteVolume];
  const h = klines([row(0, "1000.5"), row(1, "2000"), row(2, "3000")]);
  assert.equal(h.volumes, true); assert.equal(h.volumeUnit, "USDT");
  assert.equal(summarize(h, NOW).volume, 6000.5);
  assert.equal(klines([row(0, "1000.5"), row(1, "n/a"), row(2, "3000")]).volumes, false);
  assert.equal(klines([row(0, "1000.5"), [t[1], "10", "11", "9", "10.5"], row(2, "3000")]).volumes, false, "a short kline");
});

async function rangeDialog(quote, history, hover = null) {
  historyStub.entry = { history, summary: summarize(history, NOW), fetchedAt: NOW, fresh: true };
  try {
    const { DialogParts, ChartParts } = await views();
    const v = Object.create(DialogParts.prototype);
    for (const name of Object.getOwnPropertyNames(ChartParts.prototype)) if (name !== "constructor") v[name] = ChartParts.prototype[name];
    Object.assign(v, { detail: quote, range: "1M", hover, pending: new Set(), historyErrors: {}, extPending: false,
      assetIcon: () => element(), logoChoice: () => [], extendedParts: () => [], rangeTabs: () => element() });
    return walk(v.detailView(theme));
  } finally { historyStub.entry = null; }
}
const polygons = (node) => walk(node).filter((n) => n.kind === "paint")
  .map((n) => n.calls.find((c) => c[0] === "path")[1].calls.filter((c) => c[0] === "add_polygon"));

test("1M: a volume strip from zero under the chart, and the period's total", async () => {
  const h = yahooHistory("1M", "1d", days(4), [10, 11, 12, 11], [1_000_000, 4_000_000, 2_000_000, 3_000_000]);
  const nodes = await rangeDialog(yahoo({ regularMarketVolume: 3_000_000 }), h);
  // A few days of a month: a partial period, labelled like its high and low.
  assert.ok(nodes.includes("Volume shown")); assert.ok(nodes.includes("10.0M"));
  const strip = nodes.find((n) => n.calls?.some((c) => c[0] === "h" && c[1] === 22) && polygons(n).flat().length);
  assert.ok(strip, "the strip");
  const [bars] = polygons(strip);
  assert.equal(bars.length, 4, "one bar per point of the line");
  const tops = bars.map((c) => parseFloat(c[1][0][1]));
  assert.deepEqual(tops, [75, 0, 50, 25], "heights from zero, the largest full height");
  for (const c of bars) assert.equal(c[1][2][1], "100%");
});

test("the hover readout gains the bar's volume, and its bar stands out", async () => {
  const h = klines([0, 1, 2].map((i) => [days(3)[i], "10", "11", "9", "10.5", "1", 0, String(1000 * (i + 1))]));
  const pair = binance({ quoteVolume: "6000" });
  const nodes = await rangeDialog(pair, h, { id: "quotr-chart-1M", index: 1, width: 400, height: 140 });
  assert.ok(nodes.includes("Vol 2.00K USDT"));
  assert.ok(nodes.includes("Volume shown")); assert.ok(nodes.includes("6.00K USDT"));
  const strip = nodes.find((n) => n.calls?.some((c) => c[0] === "h" && c[1] === 22) && polygons(n).flat().length);
  assert.equal(polygons(strip).length, 2, "all bars, then the hovered one on top");
});

test("no volume, no strip, no total and no readout line", async () => {
  const h = yahooHistory("1M", "1d", days(3), [10, 11, 12], [1_000_000, null, 3_000_000]);
  const nodes = await rangeDialog(yahoo({}), h, { id: "quotr-chart-1M", index: 0, width: 400, height: 140 });
  assert.ok(!nodes.includes("Volume shown") && !nodes.includes("1M volume"));
  assert.ok(!nodes.some((n) => typeof n === "string" && n.startsWith("Vol ")));
  assert.ok(!nodes.some((n) => n.calls?.some((c) => c[0] === "h" && c[1] === 22) && polygons(n).flat().length));
});

// A stock's 1W: day volumes from one daily-bar request after the line is shown.
import { decodeYahooDayVolumes, attachDayVolumes, HistoryStore, DAY_VOLUME_TIMEOUT_MS } from "../history.js";

const OFFSET = -18_000; // EST
const tradingDays = [3, 2, 1].map((i) => Date.UTC(2026, 10, 25 - i, 14, 30)); // 09:30 EST, three days
const thirty = tradingDays.flatMap((d) => [d, d + 1_800_000, d + 3_600_000]);
const week = () => yahooHistory("1W", "30m", thirty, thirty.map((_, i) => 10 + i / 10), thirty.map(() => 999));
const dailyAnswer = (volumes, meta = {}) => ok({ chart: { result: [{
  meta: { symbol: "SAMPLE", dataGranularity: "1d", gmtoffset: OFFSET, ...meta },
  timestamp: tradingDays.map((t) => t / 1000), indicators: { quote: [{ volume: volumes }] } }] } });

test("Yahoo's daily answer gives one volume per trading day; anything else is refused", () => {
  const days = decodeYahooDayVolumes("SAMPLE", dailyAnswer([1e6, 2e6, 3e6]));
  assert.equal(days.size, 3);
  assert.deepEqual([...decodeYahooDayVolumes("SAMPLE", dailyAnswer([1e6, null, 0])).values()], [1e6], "only volumes above zero");
  assert.throws(() => decodeYahooDayVolumes("SAMPLE", { status: 500, ok: false, text: "" }), /HTTP 500/);
  assert.equal((() => { try { decodeYahooDayVolumes("SAMPLE", { status: 429, ok: false, text: "" }); } catch (e) { return e.retryAfterMs; } })(), 60_000);
  assert.throws(() => decodeYahooDayVolumes("SAMPLE", { status: 200, ok: true, text: "<html>" }), /unreadable/);
  assert.throws(() => decodeYahooDayVolumes("SAMPLE", dailyAnswer([1, 2, 3], { symbol: "OTHER" })), /different ticker/);
  assert.throws(() => decodeYahooDayVolumes("SAMPLE", dailyAnswer([1, 2, 3], { dataGranularity: "1wk" })), /daily/);
});

test("1W gets day volumes only when every day on the line has one", () => {
  const h = week();
  assert.equal(h.volumes, false, "30-minute volumes are not used");
  const all = attachDayVolumes(h, decodeYahooDayVolumes("SAMPLE", dailyAnswer([1e6, 2e6, 3e6])));
  assert.equal(all.volumes, true); assert.equal(all.volumesByDay, true);
  assert.deepEqual(all.bars.map((b) => b.dayVolume), [1e6, 1e6, 1e6, 2e6, 2e6, 2e6, 3e6, 3e6, 3e6]);
  assert.equal(summarize(all, NOW).volume, 6e6, "each day counted once");
  const gap = attachDayVolumes(h, decodeYahooDayVolumes("SAMPLE", dailyAnswer([1e6, null, 3e6])));
  assert.equal(gap, h, "a day without volume: the period keeps none");
});

function storeWith(history) {
  const store = new HistoryStore({ yahooSpacingMs: 0 });
  store.remember(HistoryStore.key("SAMPLE", "1W"), { history, summary: summarize(history, NOW), fetchedAt: NOW });
  return store;
}
const hostFor = (answer, calls = []) => ({
  fetch: (url) => { calls.push(url); return typeof answer === "function" ? answer() : Promise.resolve(answer); },
  now: () => NOW, sleep: async () => {},
  // The dialog's deadline, with the timer firing at once for a request that never answers.
  deadline: (promise, ms) => { assert.equal(ms, DAY_VOLUME_TIMEOUT_MS); return Promise.race([promise, new Promise((r) => setImmediate(() => r(null)))]); },
});

test("loadDayVolumes: one daily request after the line, attached on success, tried once", async () => {
  const store = storeWith(week());
  const calls = [];
  const entry = await store.loadDayVolumes("SAMPLE", "1W", hostFor(dailyAnswer([1e6, 2e6, 3e6]), calls));
  assert.equal(calls.length, 1); assert.match(calls[0], /interval=1d/);
  assert.equal(entry.history.volumesByDay, true); assert.equal(entry.summary.volume, 6e6);
  assert.equal(store.peek("SAMPLE", "1W", NOW).history.volumesByDay, true);
  await store.loadDayVolumes("SAMPLE", "1W", hostFor(dailyAnswer([1e6, 2e6, 3e6]), calls));
  assert.equal(calls.length, 1, "not asked again");
});

test("loadDayVolumes: no answer, a hung request, an error status or a malformed answer leave the line without volume", async () => {
  for (const [name, answer] of [["no answer", () => Promise.reject(new TypeError("network"))],
    ["hung", () => new Promise(() => {})], ["status", { status: 503, ok: false, text: "" }],
    ["malformed", { status: 200, ok: true, text: "{ not json" }], ["empty", dailyAnswer([])]]) {
    const store = storeWith(week());
    let failed = false;
    try { await store.loadDayVolumes("SAMPLE", "1W", hostFor(answer)); } catch { failed = true; }
    const h = store.peek("SAMPLE", "1W", NOW).history;
    assert.equal(h.volumes, false, name); assert.equal(store.peek("SAMPLE", "1W", NOW).summary.volume, null, name);
    assert.ok(failed || name === "empty", name);
    // And the line itself is untouched.
    assert.equal(h.bars.length, thirty.length, name);
  }
});

test("loadDayVolumes: a 429 holds further Yahoo requests; pairs and other ranges never ask", async () => {
  const store = storeWith(week());
  await assert.rejects(store.loadDayVolumes("SAMPLE", "1W", hostFor({ status: 429, ok: false, text: "" })));
  assert.ok(store.yahooRetryAt > NOW);
  const calls = [];
  assert.equal(await new HistoryStore().loadDayVolumes("COIN/USDT", "1W", hostFor(dailyAnswer([1]), calls)), null);
  await storeWith(week()).loadDayVolumes("SAMPLE", "1M", hostFor(dailyAnswer([1]), calls));
  assert.equal(calls.length, 0);
});

test("1W stock dialog: one bar per trading day, the day's volume in the readout", async () => {
  const h = attachDayVolumes(week(), decodeYahooDayVolumes("SAMPLE", dailyAnswer([1e6, 4e6, 2e6])));
  historyStub.entry = { history: h, summary: summarize(h, NOW), fetchedAt: NOW, fresh: true };
  try {
    const { DialogParts, ChartParts } = await views();
    const v = Object.create(DialogParts.prototype);
    for (const name of Object.getOwnPropertyNames(ChartParts.prototype)) if (name !== "constructor") v[name] = ChartParts.prototype[name];
    Object.assign(v, { detail: yahoo({}), range: "1W", hover: { id: "quotr-chart-1W", index: 4, width: 400, height: 140 },
      pending: new Set(), historyErrors: {}, extPending: false,
      assetIcon: () => element(), logoChoice: () => [], extendedParts: () => [], rangeTabs: () => element() });
    const nodes = walk(v.detailView(theme));
    assert.ok(nodes.includes("Vol (day) 4.00M"));
    const strip = nodes.find((n) => n.calls?.some((c) => c[0] === "h" && c[1] === 22) && polygons(n).flat().length);
    const [days, hovered] = polygons(strip);
    assert.equal(days.length, 3, "three trading days, three bars");
    assert.deepEqual(days.map((c) => parseFloat(c[1][0][1])), [75, 0, 50]);
    assert.equal(hovered.length, 1, "the hovered day stands out");
    assert.ok(nodes.includes("7.00M"), "the week's total, each day once");
  } finally { historyStub.entry = null; }
});
