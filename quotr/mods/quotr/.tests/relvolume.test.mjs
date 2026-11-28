// Relative volume (issue #47): the day against the month's average full day, from the loaded 1M
// history only; anything that doesn't hold up shows nothing. Neutral sample data.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeYahooHistory, decodeBinanceHistory, rangeWindow, summarize } from "../history.js";
import { MIN_DAYS, formatRatio, relativeVolume } from "../relvolume.js";
import { views, walk, element, theme, historyStub } from "./helpers/view-harness.mjs";

const H = 3_600_000, DAY = 24 * H;
const ok = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
// Wednesday Nov 25 2026, 17:00 EST: that day's regular session (14:30–21:00 UTC) has closed.
const SESSION = [Date.UTC(2026, 10, 25, 14, 30), Date.UTC(2026, 10, 25, 21, 0)];
const AFTER = Date.UTC(2026, 10, 25, 22, 0);

// Weekday sessions from Oct 26 to Nov 25, as Yahoo's daily bars (each stamped at its open).
function sessions(until = SESSION[0]) {
  const out = [];
  for (let t = Date.UTC(2026, 9, 26, 14, 30); t <= until; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(t);
  }
  return out;
}
/** A 1M stock history, decoded from Yahoo's answer. `volume(t, i)`; `extra` adds raw bars. */
function stockMonth({ volume = () => 100e6, times = sessions(), extra = [], now = AFTER } = {}) {
  const all = [...times.map((t, i) => [t, volume(t, i)]), ...extra];
  const body = { chart: { result: [{ meta: { symbol: "SAMPLE", dataGranularity: "1d", gmtoffset: -18000, timezone: "EST" },
    timestamp: all.map(([t]) => t / 1000), indicators: { quote: [{ close: all.map(() => 50), volume: all.map(([, v]) => v) }] } }] } };
  return entry(decodeYahooHistory("SAMPLE", "1M", ok(body), rangeWindow("1M", now)), now);
}
// As HistoryStore keeps it.
const entry = (history, now) => ({ history, summary: summarize(history, now), fetchedAt: now });
// `stockQuote()` is a 150M session, fetched an hour after its close; `stockQuote(x)` any volume,
// undefined included.
const stockQuote = (...given) => ({ symbol: "SAMPLE", currency: "USD", volume: given.length ? given[0] : 150e6, session: SESSION,
  fetchedAt: AFTER, delaySeconds: 0 });

// A pair: 4-hour klines over the month to `now`, `volume(t)` in the quote currency each.
const PNOW = Date.UTC(2026, 10, 25, 13, 0);
function pairMonth({ volume = () => 10e6, now = PNOW, skip = () => false, unit = "USDT" } = {}) {
  const window = rangeWindow("1M", now);
  const klines = [];
  for (let t = Math.ceil(window.start / (4 * H)) * 4 * H; t <= now; t += 4 * H) {
    if (skip(t)) continue;
    klines.push([t, "1", "1", "1", "1", "5", t + 4 * H - 1, String(volume(t))]);
  }
  return entry(decodeBinanceHistory(`COIN/${unit}`, "1M", ok(klines), window), now);
}
// Binance's rolling 24h: openTime to closeTime, a whole day.
const pairQuote = (...given) => ({ symbol: "COIN/USDT", currency: "USDT", volume: given.length ? given[0] : 90e6, session: null,
  timestamp: PNOW, windowStart: PNOW - DAY, fetchedAt: PNOW });

test("ratios are written short", () => {
  assert.equal(formatRatio(1.42), "1.4× avg");
  assert.equal(formatRatio(0.95), "0.9× avg");
  assert.equal(formatRatio(12.6), "13× avg");
  assert.equal(formatRatio(0.04), "<0.1× avg");
  for (const bad of [0, -1, NaN, Infinity, null, undefined]) assert.equal(formatRatio(bad), "");
});

test("a stock: its closed session against the average of the full sessions before it", () => {
  // Earlier sessions alternate 80M and 120M (average 100M); the session itself is 150M.
  const month = stockMonth({ volume: (t, i) => (t === SESSION[0] ? 150e6 : i % 2 ? 120e6 : 80e6) });
  const r = relativeVolume(stockQuote(150e6), month, AFTER);
  const before = sessions().filter((t) => t < SESSION[0]);
  assert.equal(r.days, before.length);
  const avg = before.reduce((s, _t, i) => s + (i % 2 ? 120e6 : 80e6), 0) / before.length;
  assert.ok(Math.abs(r.average - avg) < 1e-3);
  assert.ok(Math.abs(r.ratio - 150e6 / avg) < 1e-9);
  assert.equal(r.text, formatRatio(150e6 / avg));
  assert.match(r.tip, /^The Nov 25 session's volume, 150\.0M, is 1\.\d× the average of 22 full sessions \(Oct 26 – Nov 24\), 10\d\.\dM\. From the 1M history\.$/);
});

test("a stock: the session's own day never enters the average, whatever its bar holds", () => {
  // The month's bar for the session is still the partial morning volume: excluded, not averaged.
  const partial = stockMonth({ volume: (t) => (t === SESSION[0] ? 20e6 : 100e6) });
  assert.equal(relativeVolume(stockQuote(150e6), partial, AFTER).average, 100e6);
  // Without any bar for it, the same figure.
  const without = stockMonth({ times: sessions().filter((t) => t < SESSION[0]) });
  assert.equal(relativeVolume(stockQuote(150e6), without, AFTER).ratio, 1.5);
  // Bars after the quote's session (an old quote, a newer month) are left out too.
  const later = stockMonth({ times: [...sessions(), SESSION[0] + DAY], volume: (t) => (t > SESSION[0] ? 900e6 : 100e6), now: AFTER + DAY });
  assert.equal(relativeVolume(stockQuote(150e6), later, AFTER + DAY).average, 100e6);
});

test("a stock: a quote fetched while its session traded stays partial; no figure, however late it is drawn", () => {
  const month = stockMonth();
  // The review's case: fetched two hours into the session at 20M, drawn after the close. On the first
  // version this read 0.2× avg; a partial day is never compared.
  const early = { ...stockQuote(20e6), fetchedAt: SESSION[0] + 2 * H };
  for (const now of [SESSION[0] + 2 * H, SESSION[1] - 1, SESSION[1], AFTER, AFTER + 3 * DAY]) {
    assert.equal(relativeVolume(early, month, now), null, `drawn at ${new Date(now).toISOString()}`);
  }
  // Fetched after the close: complete.
  assert.ok(relativeVolume({ ...early, volume: 150e6, fetchedAt: SESSION[1] }, month, AFTER));
  // The exchange's delay counts: 15 minutes late, a quote fetched 5 minutes after the close is still partial.
  assert.equal(relativeVolume({ ...stockQuote(), fetchedAt: SESSION[1] + 5 * 60_000, delaySeconds: 900 }, month, AFTER), null);
  assert.ok(relativeVolume({ ...stockQuote(), fetchedAt: SESSION[1] + 16 * 60_000, delaySeconds: 900 }, month, AFTER));
  // Without its fetch time or the session's times there is no telling: nothing.
  for (const fetchedAt of [undefined, null, NaN, "late"]) assert.equal(relativeVolume({ ...stockQuote(), fetchedAt }, month, AFTER), null);
  for (const session of [undefined, null, [], [SESSION[1], SESSION[0]], ["a", "b"]]) {
    assert.equal(relativeVolume({ ...stockQuote(), session }, month, AFTER), null, JSON.stringify(session));
  }
});

test("a stock: a month fetched while a session traded never counts that session as full", () => {
  // The review's case: 21 full sessions of 100M, then Tuesday's bar caught two and a half hours in at
  // 10M; Wednesday's closed session is 150M. On the first version: 1.6× avg. Right: 1.5× avg.
  const tuesday = Date.UTC(2026, 10, 24, 14, 30);
  const fetchedAt = tuesday + 2.5 * H;
  const before = sessions().filter((t) => t < tuesday);
  assert.equal(before.length, 21);
  const month = stockMonth({ times: [...before, tuesday], volume: (t) => (t === tuesday ? 10e6 : 100e6), now: fetchedAt });
  const r = relativeVolume(stockQuote(150e6), month, AFTER);
  assert.equal(r.days, 21);
  assert.equal(r.average, 100e6);
  assert.equal(r.text, "1.5× avg");
  // The same month fetched after Tuesday's exchange date ended (midnight EST) counts it.
  const later = stockMonth({ times: [...before, tuesday], now: Date.UTC(2026, 10, 25, 5, 0) });
  assert.equal(relativeVolume(stockQuote(150e6), later, AFTER).days, 22);
  // Without its fetch time, nothing.
  for (const at of [undefined, null, NaN]) assert.equal(relativeVolume(stockQuote(), { ...month, fetchedAt: at }, AFTER), null);
});

test("a stock: a missing, zero or malformed day volume gives nothing", () => {
  const month = stockMonth();
  for (const bad of [undefined, null, 0, -5, NaN, "abc", "", 1e20, {}]) {
    assert.equal(relativeVolume(stockQuote(bad), month, AFTER), null, String(bad));
  }
  assert.equal(relativeVolume(stockQuote("150000000"), month, AFTER).ratio, 1.5, "a numeric string is a volume (cleanVolume)");
});

test("a stock: a month whose volumes don't hold up gives nothing", () => {
  // One day without a volume: the whole period has none (history.js), so no average.
  const holed = stockMonth({ volume: (_t, i) => (i === 3 ? null : 100e6) });
  assert.equal(holed.history.volumes, false);
  assert.equal(relativeVolume(stockQuote(), holed, AFTER), null);
  // A zero or a malformed entry.
  assert.equal(relativeVolume(stockQuote(), stockMonth({ volume: (_t, i) => (i === 5 ? 0 : 100e6) }), AFTER), null);
  assert.equal(relativeVolume(stockQuote(), stockMonth({ volume: (_t, i) => (i === 5 ? "lots" : 100e6) }), AFTER), null);
  // Two answers for one bar (#44): no volume for the period.
  const twice = stockMonth({ extra: [[sessions()[2], 55e6]] });
  assert.equal(relativeVolume(stockQuote(), twice, AFTER), null);
});

test("a stock: contradictions give nothing", () => {
  // One trading day listed twice (two stamps) with different volumes.
  const t = sessions()[4];
  const twoStamps = stockMonth({ extra: [[t + 60_000, 70e6]] });
  assert.equal(relativeVolume(stockQuote(), twoStamps, AFTER), null);
  // The same day twice with the same volume is no contradiction.
  assert.ok(relativeVolume(stockQuote(), stockMonth({ extra: [[t + 60_000, 100e6]] }), AFTER));
  // The month's bar for the session holds more than the session's own total.
  const over = stockMonth({ volume: (x) => (x === SESSION[0] ? 200e6 : 100e6) });
  assert.equal(relativeVolume(stockQuote(150e6), over, AFTER), null);
});

test("a stock: fewer than MIN_DAYS full sessions to average gives nothing", () => {
  const before = sessions().filter((t) => t < SESSION[0]);
  const short = stockMonth({ times: [...before.slice(-(MIN_DAYS - 1)), SESSION[0]] });
  assert.equal(relativeVolume(stockQuote(), short, AFTER), null);
  const enough = stockMonth({ times: [...before.slice(-MIN_DAYS), SESSION[0]] });
  assert.equal(relativeVolume(stockQuote(), enough, AFTER).days, MIN_DAYS);
});

test("only a loaded 1M period of the same ticker counts", () => {
  const month = stockMonth();
  assert.equal(relativeVolume(stockQuote(), null, AFTER), null);
  assert.equal(relativeVolume(stockQuote(), undefined, AFTER), null);
  assert.equal(relativeVolume(stockQuote(), { history: { ...month.history, range: "1Y" } }, AFTER), null);
  assert.equal(relativeVolume({ ...stockQuote(), symbol: "OTHER" }, month, AFTER), null);
  assert.equal(relativeVolume(stockQuote(), { history: { ...month.history, daily: false } }, AFTER), null);
  assert.equal(relativeVolume(stockQuote(), { history: { ...month.history, bars: [] } }, AFTER), null);
  assert.equal(relativeVolume(null, month, AFTER), null);
});

test("a pair: the last 24 hours against the average full UTC day, the current day left out", () => {
  // 10M per 4-hour kline: a full UTC day is 60M. The 24h volume is 90M.
  const month = pairMonth();
  const r = relativeVolume(pairQuote(90e6), month, PNOW);
  assert.equal(r.average, 60e6);
  assert.equal(r.ratio, 1.5);
  assert.equal(r.text, "1.5× avg");
  // Oct 25 13:00 to Nov 25 13:00: Oct 25 starts mid-day and Nov 25 is still going; Oct 26 – Nov 24 count.
  assert.equal(r.days, 30);
  assert.equal(r.tip, "The last 24 hours' volume, 90.0M USDT, is 1.5× the average of 30 full UTC days (Oct 26 – Nov 24), 60.0M USDT. From the 1M history.");
  // The current day's klines never move the average, however large.
  const busyToday = pairMonth({ volume: (t) => (t >= Date.UTC(2026, 10, 25) ? 900e6 : 10e6) });
  assert.equal(relativeVolume(pairQuote(90e6), busyToday, PNOW).average, 60e6);
});

test("a pair: a day missing a kline is not a full day; the others still count", () => {
  const gap = Date.UTC(2026, 10, 10, 8);
  const month = pairMonth({ skip: (t) => t === gap });
  const r = relativeVolume(pairQuote(90e6), month, PNOW);
  assert.equal(r.days, 29);
  assert.equal(r.average, 60e6);
});

test("a pair: a completed day is a UTC day whose last kline had closed when the month was fetched", () => {
  // Fetched at 23:00 UTC: that day's 20:00 kline is still open, so the day isn't full...
  const fetched = Date.UTC(2026, 10, 25, 23, 0);
  const month = pairMonth({ now: fetched, volume: (t) => (t >= Date.UTC(2026, 10, 25) && t < Date.UTC(2026, 10, 25, 20) ? 1e6 : 10e6) });
  const quote = { ...pairQuote(90e6), timestamp: fetched, windowStart: fetched - DAY };
  assert.equal(relativeVolume(quote, month, fetched).days, 30);
  // ...and stays not full when the same cached month is drawn the next day or later.
  for (const now of [Date.UTC(2026, 10, 26, 1), Date.UTC(2026, 10, 27, 12)]) {
    const r = relativeVolume(quote, month, now);
    assert.equal(r.days, 30);
    assert.equal(r.average, 60e6, "the partial day's small klines never enter the average");
  }
  // A month fetched once that day was over counts it.
  assert.equal(relativeVolume(quote, { ...month, fetchedAt: Date.UTC(2026, 10, 26) }, Date.UTC(2026, 10, 26)).days, 31);
  for (const at of [undefined, null, NaN]) assert.equal(relativeVolume(quote, { ...month, fetchedAt: at }, fetched), null);
});

test("a pair: the 24h volume counts only when its window spans the whole 24 hours", () => {
  const month = pairMonth();
  assert.ok(relativeVolume(pairQuote(90e6), month, PNOW));
  for (const windowStart of [undefined, null, 0, PNOW - 20 * H, PNOW]) {
    assert.equal(relativeVolume({ ...pairQuote(90e6), windowStart }, month, PNOW), null, String(windowStart));
  }
});

test("a pair: a malformed kline volume, a malformed 24h volume or another currency gives nothing", () => {
  const holed = pairMonth({ volume: (t) => (t === Date.UTC(2026, 10, 12) ? "n/a" : 10e6) });
  assert.equal(holed.history.volumes, false);
  assert.equal(relativeVolume(pairQuote(90e6), holed, PNOW), null);
  const zero = pairMonth({ volume: (t) => (t === Date.UTC(2026, 10, 12) ? 0 : 10e6) });
  assert.equal(relativeVolume(pairQuote(90e6), zero, PNOW), null);
  const month = pairMonth();
  for (const bad of [undefined, null, 0, "-1", "n/a", 1e16]) assert.equal(relativeVolume(pairQuote(bad), month, PNOW), null, String(bad));
  // The 24h volume and the klines must be in the same quote currency.
  assert.equal(relativeVolume({ ...pairQuote(90e6), currency: "BTC" }, month, PNOW), null);
  assert.equal(relativeVolume({ ...pairQuote(90e6), currency: null }, month, PNOW), null);
  // A history that isn't the 4-hour klines.
  assert.equal(relativeVolume(pairQuote(90e6), { ...month, history: { ...month.history, intervalMs: DAY } }, PNOW), null);
});

// The real dialog, drawn by the harness.
async function dialog(quote, range = "1D") {
  const { DialogParts, ChartParts } = await views();
  const v = Object.create(DialogParts.prototype);
  for (const name of Object.getOwnPropertyNames(ChartParts.prototype)) if (name !== "constructor") v[name] = ChartParts.prototype[name];
  Object.assign(v, { detail: quote, range, hover: null, pending: new Set(), historyErrors: {}, extPending: false,
    assetIcon: () => element(), logoChoice: () => [], extendedParts: () => [], rangeTabs: () => element() });
  // Wrapped: the recording element answers any method, `then` included, so awaiting it would never settle.
  return { tree: v.detailView(theme) };
}
const byId = (tree, id) => walk(tree).find((n) => n.calls?.some((c) => c[0] === "id" && c[1] === id));
const statRow = (tree, first) => walk(tree).find((n) => n.kind === "row" && walk(n).includes(first) && n.nodes.length >= 3);

test("the dialog: a quiet line under the 1D volume, only with the month loaded; no extra column", async (t) => {
  t.after(() => { historyStub.entry = null; });
  // The harness's clock is the real one: a session that closed an hour ago, a month before it.
  const now = Date.now();
  const session = [now - 7.5 * H, now - H];
  const days = [];
  for (let i = 1; i <= 25; i++) days.push(session[0] - i * DAY);
  const quote = { ...stockQuote(150e6), name: "Sample Holdings", price: 50, changePercent: 1, timestamp: session[1] - 60_000,
    open: 49, high: 51, low: 48, previousClose: 49.5, points: [], series: [], session, fetchedAt: now };
  historyStub.entry = null;
  let { tree } = await dialog(quote);
  assert.equal(byId(tree, "quotr-relative-volume"), undefined, "no 1M period loaded: nothing");
  assert.equal(statRow(tree, "Open").nodes.length, 5);

  historyStub.entry = stockMonth({ times: [...days.reverse(), session[0]], now });
  ({ tree } = await dialog(quote));
  const line = byId(tree, "quotr-relative-volume");
  assert.ok(line, "the figure shows");
  assert.deepEqual(walk(line).filter((n) => typeof n === "string"), ["1.5× avg"]);
  assert.match(line.calls.find((c) => c[0] === "tooltip")[1], /1\.5× the average of 25 full sessions/);
  // It sits inside the Volume column: still five columns.
  const row = statRow(tree, "Open");
  assert.equal(row.nodes.length, 5);
  assert.ok(walk(row.nodes[4]).includes(line));
  // Top-aligned, so the extra line hangs below and the five labels stay on one line.
  assert.ok(row.calls.some((c) => c[0] === "items_start"));

  // The session still trading: nothing.
  ({ tree } = await dialog({ ...quote, session: [now - H, now + 5 * H] }));
  assert.equal(byId(tree, "quotr-relative-volume"), undefined);
  // A quote fetched before the close, drawn after it (the dialog keeps the quote it opened with): nothing.
  ({ tree } = await dialog({ ...quote, fetchedAt: session[1] - H }));
  assert.equal(byId(tree, "quotr-relative-volume"), undefined);
  // On the 1M tab itself the period stats are unchanged: no figure there.
  ({ tree } = await dialog(quote, "1M"));
  assert.equal(byId(tree, "quotr-relative-volume"), undefined);
});

test("the dialog: a pair's 24h volume gets its figure the same way", async (t) => {
  t.after(() => { historyStub.entry = null; });
  const now = Date.now();
  const quote = { ...pairQuote(90e6), name: "Binance Spot", price: 100, changePercent: 1, timestamp: now, windowStart: now - DAY,
    fetchedAt: now, open: 99, high: 101, low: 98,
    previousClose: 99, points: [], series: [], periods: null };
  historyStub.entry = pairMonth({ now });
  const { tree } = await dialog(quote);
  const line = byId(tree, "quotr-relative-volume");
  assert.deepEqual(walk(line).filter((n) => typeof n === "string"), ["1.5× avg"]);
  const row = statRow(tree, "24h open");
  assert.equal(row.nodes.length, 4);
  assert.ok(row.calls.some((c) => c[0] === "items_start"));
  assert.ok(walk(row.nodes[3]).includes(line));
});
