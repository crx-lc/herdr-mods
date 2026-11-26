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
