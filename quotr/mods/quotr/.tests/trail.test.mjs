// The row's stock line: every trade since the last regular close (quotes.js yahooTrail, shownQuote;
// sparkline.js trail geometry), from Yahoo's two-day extended-hours answer.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeYahoo, shownQuote, yahooUrl } from "../quotes.js";
import { watchlistSparkline, trailPrices, SPARK_LEFT, SPARK_RIGHT } from "../sparkline.js";
import { createTickMemory, primeTicks, takeTicks } from "../ticks.js";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

const H = 3_600_000, M = 60_000, BAR = 5 * M;
const TUE = Date.UTC(2026, 10, 24), WED = TUE + 24 * H, THU = WED + 24 * H;
// US sessions in UTC (EST): pre 04:00–09:30, regular 09:30–16:00, post 16:00–20:00.
const sessions = (d) => ({ pre: [d + 9 * H, d + 14.5 * H], regular: [d + 14.5 * H, d + 21 * H], post: [d + 21 * H, d + 25 * H] });
const sec = (ms) => ms / 1000;

/**
 * Yahoo's chart answer for `days` (two trading days), bars every 5 minutes up to `now`, priced by
 * `price(day, session, t)`. `extended: false` is a market with only regular hours (an index).
 */
function answer({ days, now, price, previousClose = 100, extended = true, regularClose }) {
  const timestamp = [], close = [], open = [];
  for (const d of days) {
    const s = sessions(d);
    for (const name of extended ? ["pre", "regular", "post"] : ["regular"]) {
      for (let t = s[name][0]; t < s[name][1] && t <= now; t += BAR) {
        timestamp.push(sec(t)); close.push(price(d, name, t)); open.push(price(d, name, t));
      }
    }
  }
  const regulars = days.map((d) => sessions(d).regular).filter((r) => r[0] <= now);
  const latest = regulars.at(-1);
  const regularBars = timestamp.map((s, i) => [s * 1000, close[i]]).filter(([t]) => t >= latest[0] && t < latest[1]);
  const regularMarketPrice = now >= latest[1] && regularClose ? regularClose : regularBars.at(-1)[1];
  const period = ([start, end]) => [{ timezone: "EST", start: sec(start), end: sec(end), gmtoffset: -18_000 }];
  const tradingPeriods = extended
    ? { pre: days.map((d) => period(sessions(d).pre)), regular: days.map((d) => period(sessions(d).regular)), post: days.map((d) => period(sessions(d).post)) }
    : days.map((d) => period(sessions(d).regular));
  const meta = { symbol: "SAMPLE", currency: "USD", regularMarketPrice, regularMarketTime: sec(Math.min(now, latest[1])),
    previousClose, chartPreviousClose: 77, hasPrePostMarketData: extended, gmtoffset: -18_000, timezone: "EST", tradingPeriods,
    currentTradingPeriod: { regular: { start: sec(sessions(days.at(-1)).regular[0]), end: sec(sessions(days.at(-1)).regular[1]) } } };
  return decodeYahoo("SAMPLE", { status: 200, ok: true, text: JSON.stringify({ chart: { result: [{ meta, timestamp, indicators: { quote: [{ close, open }] } }] } }) }, now);
}

// Tuesday closes at 100; Wednesday gaps down 8% at the open and trades flat; after hours a little lower.
const gap = (d, session) => d === TUE ? (session === "post" ? 100.2 : 100) : session === "pre" ? 95 : session === "regular" ? 91.88 : 91;

test("the row's request is two days with extended hours", () => {
  assert.match(yahooUrl("AAPL"), /interval=5m&range=2d&includePrePost=true$/);
});

test("during the session: from Tuesday's close through its after hours, Wednesday's pre-market and session", () => {
  const now = WED + 18 * H + 22 * M; // 13:22 EST
  const q = answer({ days: [TUE, WED], now, price: gap });
  const tr = q.trail;
  assert.equal(tr.reference, 100); assert.equal(tr.start, TUE + 21 * H);
  assert.deepEqual(tr.points[0], { t: TUE + 21 * H, close: 100, session: "close" });
  const sessionsSeen = [...new Set(tr.points.map((p) => p.session))];
  assert.deepEqual(sessionsSeen, ["close", "post", "pre", "regular"]);
  // In time order; the first after-hours bar starts at the close itself.
  assert.ok(tr.points.every((p, i) => i === 0 || p.t > tr.points[i - 1].t || (i === 1 && p.t === tr.start)));
  assert.ok(!tr.points.some((p) => p.t > TUE + 14.5 * H && p.t < TUE + 21 * H), "nothing from before the close");
  assert.equal(tr.session, "regular"); assert.equal(tr.price, 91.88);
  assert.ok(Math.abs(tr.changePercent - -8.12) < 1e-9);
  // The dialog's quote is untouched: Wednesday's regular session only, against the previous close.
  assert.equal(q.price, 91.88); assert.ok(Math.abs(q.changePercent - -8.12) < 1e-9);
  assert.ok(q.points.every((p) => p.t >= WED + 14.5 * H && p.t < WED + 21 * H));
  assert.equal(q.open, 91.88);
  assert.deepEqual(q.session, [WED + 14.5 * H, WED + 21 * H]);
});

test("after hours: the row shows the latest after-hours trade against the same close", () => {
  const now = WED + 22 * H + 30 * M; // 17:30 EST
  const q = answer({ days: [TUE, WED], now, price: gap, regularClose: 91.9 });
  const shown = shownQuote(q);
  assert.equal(shown.price, 91); assert.equal(shown.shownSession, "post");
  assert.equal(shown.previousClose, 100); assert.ok(Math.abs(shown.changePercent - -9) < 1e-9);
  assert.equal(shown.timestamp, q.trail.points.at(-1).t);
  assert.equal(q.price, 91.9, "the dialog keeps the regular close");
});

test("at the next day's first pre-market trade the reference rolls to the latest close", () => {
  const now = THU + 10 * H; // 05:00 EST Thursday; Yahoo's two days are now Wednesday and Thursday
  const q = answer({ days: [WED, THU], now, previousClose: 100, regularClose: 91.9,
    price: (d, s) => d === WED ? (s === "post" ? 91 : 91.88) : 92.5 });
  const tr = q.trail;
  assert.equal(tr.reference, 91.9, "Wednesday's close, final by now");
  assert.equal(tr.start, WED + 21 * H);
  assert.deepEqual([...new Set(tr.points.map((p) => p.session))], ["close", "post", "pre"]);
  assert.equal(tr.session, "pre"); assert.equal(tr.price, 92.5);
  assert.ok(Math.abs(tr.changePercent - (92.5 - 91.9) / 91.9 * 100) < 1e-9);
});

test("overnight and weekends, before any new pre-market trade, the last trading day stays", () => {
  const now = WED + 30 * H; // 01:00 EST Thursday, no Thursday bars yet
  const q = answer({ days: [TUE, WED], now, price: gap, regularClose: 91.9 });
  assert.equal(q.trail.reference, 100); assert.equal(q.trail.start, TUE + 21 * H);
  assert.equal(q.trail.session, "post");
});

test("a market without extended hours: the session after the previous close, nothing else", () => {
  const now = WED + 18 * H;
  const q = answer({ days: [TUE, WED], now, price: gap, extended: false });
  const tr = q.trail;
  assert.deepEqual([...new Set(tr.points.map((p) => p.session))], ["close", "regular"]);
  assert.equal(tr.points.length, 1 + (18 - 14.5) * 12 + 1);
  assert.equal(tr.session, "regular");
});

test("no previous close, no sessions or no bars: no trail, the row falls back to the plain quote", () => {
  const now = WED + 18 * H;
  const noRef = answer({ days: [TUE, WED], now, price: gap, previousClose: null });
  assert.equal(noRef.trail, null);
  assert.equal(shownQuote(noRef), noRef);
  assert.equal(watchlistSparkline(noRef, now).bands.length, 0);
  // A cached quote from before this change has no trail at all.
  const old = { ...noRef, trail: undefined };
  assert.equal(shownQuote(old), old);
  for (const bad of [{ price: 0 }, { reference: -1 }, { changePercent: NaN }, { t: null }]) {
    const q = { ...noRef, trail: { ...answer({ days: [TUE, WED], now, price: gap }).trail, ...bad } };
    assert.equal(shownQuote(q), q, JSON.stringify(bad));
  }
});

test("the row chart: bar-spaced from the close, ending on the shown price, on the shown side of the reference", () => {
  const now = WED + 18 * H + 22 * M;
  const q = answer({ days: [TUE, WED], now, price: gap });
  const points = trailPrices(q);
  assert.equal(points.at(-1).close, shownQuote(q).price);
  const g = watchlistSparkline(q, now);
  assert.equal(g.line.length, points.length);
  assert.equal(g.line[0][0], SPARK_LEFT); assert.equal(g.line.at(-1)[0], SPARK_RIGHT);
  const step = (SPARK_RIGHT - SPARK_LEFT) / (points.length - 1);
  g.line.forEach(([x], i) => assert.ok(Math.abs(x - (SPARK_LEFT + i * step)) < 1e-9, "even spacing: closed hours take no room"));
  assert.equal(g.line[0][1], g.reference, "the line starts on the dotted close");
  assert.ok(g.line.at(-1)[1] - g.reference > 14, "an 8% drop sits well below it");
  // After hours and pre-market are shaded, the session isn't.
  assert.deepEqual(g.bands.map((b) => b.session), ["post", "pre"]);
  for (const b of g.bands) assert.ok(b.from >= SPARK_LEFT && b.to <= SPARK_RIGHT && b.to > b.from);
  assert.match(g.label, /^Since the close of 100\.00 USD · Tue, Nov 24, 16:00 EST$/);
  // A gain mirrors it.
  const up = answer({ days: [TUE, WED], now, price: (d, s) => d === TUE ? 100 : 104 });
  const gu = watchlistSparkline(up, now);
  assert.ok(gu.reference - gu.line.at(-1)[1] > 10);
});

test("ticks follow the price the row shows", () => {
  const now = WED + 22 * H;
  const first = answer({ days: [TUE, WED], now, price: gap, regularClose: 91.9 });
  const memory = createTickMemory();
  primeTicks(memory, { SAMPLE: first }, ["SAMPLE"]);
  const later = answer({ days: [TUE, WED], now: now + 10 * M, price: (d, s, t) => gap(d, s) + (t > now ? 0.5 : 0), regularClose: 91.9 });
  assert.equal(later.price, first.price, "the regular close did not move");
  assert.deepEqual(takeTicks(memory, { SAMPLE: later }, ["SAMPLE"]).map((x) => x.dir), ["up"]);
});

test("the real panel row shows the latest trade, its session and the band; the dialog gets the stored quote", async () => {
  const now = WED + 22 * H + 30 * M;
  const q = answer({ days: [TUE, WED], now, price: gap, regularClose: 91.9 });
  q.fetchedAt = Date.now();
  const { Quotr } = await views();
  const v = new Quotr();
  v.watch = { preferences: { symbols: ["SAMPLE"], paused: false }, quotes: { SAMPLE: q }, errors: {}, message: "", inflight: new Set() };
  v.assetIcon = () => element(); v.logoCredits = () => [];
  const nodes = walk(v.panel(element(), theme));
  assert.ok(nodes.includes("91.00 USD"), "the after-hours price");
  assert.ok(nodes.includes("-9.00%"));
  assert.ok(nodes.some((n) => typeof n === "string" && /After hours/.test(n)));
  assert.ok(!nodes.includes("91.90 USD"));
  const spark = nodes.find((n) => n.calls?.some((c) => c[0] === "id" && c[1] === "quotr-spark-SAMPLE"));
  const paints = walk(spark).filter((n) => n.kind === "paint");
  const fills = paints.filter((n) => n.calls.find((c) => c[0] === "path")[1].calls.some((c) => c[0] === "fill"));
  assert.equal(fills.length, 4, "Tuesday after hours, Wednesday pre-market and after hours, then the line's fill");
  assert.equal(paints.at(-1).calls.find((c) => c[0] === "paint")[1], theme.ansi1);
});
