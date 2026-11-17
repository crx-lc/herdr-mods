// Local customization tests for the detail chart's hover readout (readout.js, and the
// timestamped points it reads from quotes.js, watchlist.js and history.js).
// Run: node --test "%USERPROFILE%\.config\herdr-app\mods\quotr\.tests"
import test from "node:test";
import assert from "node:assert/strict";
import {
  UTC_ZONE, formatPointTime, nearestIndex, offsetLabel, readoutAt, timedPoints, yahooTimeZone, zoneAt,
} from "../readout.js";
import { chartGeometry, decodeBinance, decodeKlinePoints, decodeYahoo } from "../quotes.js";
import { decodeBinanceHistory, decodeYahooHistory, rangeWindow } from "../history.js";
import { Watchlist } from "../watchlist.js";

const ok = (body) => ({ status: 200, ok: true, text: JSON.stringify(body) });
const NOW = Date.UTC(2026, 10, 17, 18, 0); // Tue Nov 17 2026, 13:00 in New York
const EST = { timezone: "EST", gmtoffset: -18000 };

test("nearest point: rounds to the closest drawn index and clamps to the ends", () => {
  assert.equal(nearestIndex(0, 400, 5), 0);
  assert.equal(nearestIndex(400, 400, 5), 4);
  assert.equal(nearestIndex(49, 400, 5), 0, "just under halfway to point 1");
  assert.equal(nearestIndex(51, 400, 5), 1, "just over halfway to point 1");
  assert.equal(nearestIndex(250, 400, 5), 3);
  assert.equal(nearestIndex(-30, 400, 5), 0, "left of the chart: first point");
  assert.equal(nearestIndex(900, 400, 5), 4, "right of the chart: last point");
  assert.equal(nearestIndex(123, 400, 1), 0);
});

test("nearest point matches where chartGeometry draws each point", () => {
  const series = [5, 9, 7, 8, 6, 10, 4];
  const g = chartGeometry(series, null);
  const width = 404;
  g.points.forEach(([x], i) => assert.equal(nearestIndex(x / 100 * width, width, series.length), i));
});

test("nearest point: nothing to pick gives -1, never a guess", () => {
  assert.equal(nearestIndex(10, 400, 0), -1);
  assert.equal(nearestIndex(10, 0, 5), -1);
  assert.equal(nearestIndex(NaN, 400, 5), -1);
  assert.equal(nearestIndex(undefined, 400, 5), -1);
  assert.equal(nearestIndex(10, undefined, 5), -1);
  assert.equal(nearestIndex(10, 400, 2.5), -1);
});

test("timed points keep only pairs with a valid time and a valid price", () => {
  const points = timedPoints([300, null, 100, 200, 0, -5, 400, 200], [3, 99, 1, null, 7, 8, Number.NaN, 2.5]);
  assert.deepEqual(points, [{ t: 100_000, close: 1 }, { t: 200_000, close: 2.5 }, { t: 300_000, close: 3 }],
    "sorted by time, one per time, nulls/zero/negative/NaN skipped and never borrowed from a neighbour");
  assert.deepEqual(timedPoints([1, 2, 3], [10]), [{ t: 1000, close: 10 }], "unequal lengths: only the paired part");
  assert.deepEqual(timedPoints(undefined, [1, 2]), []);
  assert.deepEqual(timedPoints([1, 2], "x"), []);
  assert.equal(timedPoints([...Array(10).keys()].map((i) => i + 1), Array(10).fill(1), 4).length, 4);
});

test("readout is null for an invalid index or point", () => {
  const points = [{ t: NOW, close: 10 }, { t: 0, close: 11 }, { t: NOW + 1, close: null }];
  assert.equal(readoutAt(points, -1, UTC_ZONE), null);
  assert.equal(readoutAt(points, 3, UTC_ZONE), null);
  assert.equal(readoutAt(points, 1.5, UTC_ZONE), null);
  assert.equal(readoutAt(points, 1, UTC_ZONE), null, "no time: no readout");
  assert.equal(readoutAt(points, 2, UTC_ZONE), null, "no price: no readout");
  assert.equal(readoutAt([], 0, UTC_ZONE), null);
  assert.equal(readoutAt(null, 0, UTC_ZONE), null);
  assert.deepEqual(readoutAt(points, 0, UTC_ZONE, { now: NOW }), { when: "Tue, Nov 17, 18:00 UTC", price: 10, t: NOW });
});

test("Yahoo's clock: per trading day offsets, flattened from tradingPeriods", () => {
  const zone = yahooTimeZone({
    ...EST,
    tradingPeriods: [[{ timezone: "EST", start: 1794839400, end: 1794862800, gmtoffset: -18000 }], [{ junk: true }]],
  });
  assert.equal(zone.label, "EST");
  assert.equal(zone.offsetSeconds, -18000);
  assert.deepEqual(zone.periods, [{ start: 1794839400000, end: 1794862800000, offsetSeconds: -18000, label: "EST" }]);
  assert.deepEqual(yahooTimeZone({}), { label: "UTC", offsetSeconds: 0, periods: [] }, "no offset: UTC, not a guess");
  assert.equal(yahooTimeZone({ gmtoffset: 28800 }).label, "UTC+8", "no abbreviation: the offset itself");
  assert.equal(offsetLabel(19800), "UTC+5:30");
  assert.equal(offsetLabel(-12600), "UTC-3:30");
});

test("intraday times use the trading day's own offset across a daylight-saving change", () => {
  // US clocks fell back on Sun Nov 1 2026: Fri Oct 30 is EDT (UTC-4), Mon Nov 2 is EST (UTC-5).
  const zone = {
    label: "EST", offsetSeconds: -18000,
    periods: [
      { start: Date.UTC(2026, 9, 30, 13, 30), end: Date.UTC(2026, 9, 30, 20, 0), offsetSeconds: -14400, label: "EDT" },
      { start: Date.UTC(2026, 10, 2, 14, 30), end: Date.UTC(2026, 10, 2, 21, 0), offsetSeconds: -18000, label: "EST" },
    ],
  };
  assert.equal(formatPointTime(Date.UTC(2026, 9, 30, 13, 30), zone, { now: NOW }), "Fri, Oct 30, 09:30 EDT");
  assert.equal(formatPointTime(Date.UTC(2026, 10, 2, 14, 30), zone, { now: NOW }), "Mon, Nov 2, 09:30 EST");
  assert.equal(formatPointTime(Date.UTC(2026, 10, 2, 21, 0), zone, { now: NOW }), "Mon, Nov 2, 16:00 EST", "the closing bar sits on the period's end");
  // A bar outside every trading day while the days disagree: UTC, which is always right.
  assert.equal(zoneAt(Date.UTC(2026, 9, 31, 12), zone).label, "UTC");
  // Days that agree with the response: its own clock.
  assert.deepEqual(zoneAt(Date.UTC(2026, 10, 3), { label: "EST", offsetSeconds: -18000, periods: [zone.periods[1]] }),
    { label: "EST", offsetSeconds: -18000 });
});

test("daily bars show the trading date on the exchange's calendar", () => {
  // Hong Kong (UTC+8): the Nov 17 session opens 01:30Z, still Nov 16 in UTC.
  const hk = yahooTimeZone({ timezone: "HKT", gmtoffset: 28800 });
  assert.equal(formatPointTime(Date.UTC(2026, 10, 17, 1, 30), hk, { daily: true, now: NOW }), "Tue, Nov 17 · trading day");
  // New York: the 14:30Z bar is that day's session.
  assert.equal(formatPointTime(Date.UTC(2026, 10, 13, 14, 30), yahooTimeZone(EST), { daily: true, now: NOW }), "Fri, Nov 13 · trading day");
  // Binance: a daily kline is a UTC day.
  assert.equal(formatPointTime(Date.UTC(2026, 10, 16), UTC_ZONE, { daily: true, now: NOW }), "Mon, Nov 16 · UTC day");
  // Another year is named.
  assert.equal(formatPointTime(Date.UTC(2025, 10, 18, 14, 30), yahooTimeZone(EST), { daily: true, now: NOW }), "Tue, Nov 18, 2025 · trading day");
  assert.equal(formatPointTime(0, UTC_ZONE, { daily: true }), null);
  assert.equal(formatPointTime(Number.NaN, UTC_ZONE), null);
});

test("intraday times without a usable zone fall back to UTC and say so", () => {
  assert.equal(formatPointTime(Date.UTC(2026, 10, 16, 15, 0), undefined, { now: NOW }), "Mon, Nov 16, 15:00 UTC");
  assert.equal(formatPointTime(Date.UTC(2026, 10, 16, 15, 0), UTC_ZONE, { now: NOW }), "Mon, Nov 16, 15:00 UTC");
});

test("the 1D Yahoo quote keeps each close with its own bar time and the exchange clock", () => {
  const q = decodeYahoo("AAPL", ok({ chart: { result: [{
    meta: { symbol: "AAPL", regularMarketPrice: 230.1, regularMarketTime: 1_794_862_800, previousClose: 225, currency: "USD", ...EST,
      tradingPeriods: [[{ timezone: "EST", start: 1794839400, end: 1794862800, gmtoffset: -18000 }]] },
    timestamp: [1794839400, 1794839700, 1794840000],
    indicators: { quote: [{ close: [226.5, null, 230.1] }] },
  }], error: null } }), 1);
  assert.deepEqual(q.series, [226.5, 230.1], "the upstream line is unchanged");
  assert.deepEqual(q.points, [{ t: 1794839400000, close: 226.5 }, { t: 1794840000000, close: 230.1 }]);
  assert.equal(q.timeZone.label, "EST");
  assert.equal(readoutAt(q.points, 1, q.timeZone, { now: NOW }).when, "Mon, Nov 16, 09:40 EST");
});

test("a Yahoo quote without bar times has no points, so no readout", () => {
  const q = decodeYahoo("AAPL", ok({ chart: { result: [{
    meta: { symbol: "AAPL", regularMarketPrice: 230.1, regularMarketTime: 1_794_862_800, previousClose: 225 },
    indicators: { quote: [{ close: [226.5, 230.1] }] },
  }], error: null } }), 1);
  assert.deepEqual(q.series, [226.5, 230.1]);
  assert.deepEqual(q.points, []);
  assert.equal(q.timeZone.label, "UTC");
});

test("Binance points keep each kline's open time (UTC) and skip klines without one", () => {
  const points = decodeKlinePoints(ok([
    [Date.UTC(2026, 10, 17, 15, 0), "1", "2", "0.5", "64000.5"],
    [null, "1", "2", "0.5", "64100"],
    "junk",
    [Date.UTC(2026, 10, 17, 15, 15), "1", "2", "0.5", "64200"],
  ]));
  assert.deepEqual(points, [{ t: Date.UTC(2026, 10, 17, 15, 0), close: 64000.5 }, { t: Date.UTC(2026, 10, 17, 15, 15), close: 64200 }]);
  assert.equal(readoutAt(points, 1, UTC_ZONE, { now: NOW }).when, "Tue, Nov 17, 15:15 UTC");
  const quote = decodeBinance(["BTC/USDT"], ok([{ symbol: "BTCUSDT", lastPrice: "65000", prevClosePrice: "64000", closeTime: 5 }]), 1)["BTC/USDT"];
  assert.deepEqual(quote.points, []);
  assert.equal(quote.timeZone.label, "UTC");
});

test("the watchlist's 24-hour crypto line carries its point times", async () => {
  const kline = (t, c) => [t, "1", "1", "1", String(c)];
  const w = new Watchlist({
    load: () => ({ version: 1, symbols: ["BTC/USDT"], paused: true }),
    save: () => {},
    fetch: async (url) => ({
      status: 200, ok: true,
      text: async () => JSON.stringify(url.includes("klines")
        ? [kline(Date.UTC(2026, 10, 17, 15), 64000), kline(Date.UTC(2026, 10, 17, 15, 15), 64500)]
        : [{ symbol: "BTCUSDT", lastPrice: "64500", prevClosePrice: "64000", closeTime: NOW }]),
    }),
    now: () => NOW,
    sleep: async () => {},
    changed: () => {},
  });
  await w.round(true);
  const q = w.quotes["BTC/USDT"];
  assert.deepEqual(q.series, [64000, 64500]);
  assert.deepEqual(q.points.map((p) => p.t), [Date.UTC(2026, 10, 17, 15), Date.UTC(2026, 10, 17, 15, 15)]);
  assert.equal(q.series.length, q.points.length, "the drawn line and the readout's points are the same points");
});

test("history ranges carry their clock and whether bars are daily", () => {
  const now = Date.UTC(2026, 10, 17, 18);
  const yahoo = (granularity) => ok({ chart: { result: [{
    meta: { symbol: "AAPL", dataGranularity: granularity, ...EST },
    timestamp: [1794839400], indicators: { quote: [{ close: [230] }] },
  }], error: null } });
  const w = decodeYahooHistory("AAPL", "1W", yahoo("30m"), rangeWindow("1W", now));
  assert.equal(w.daily, false);
  assert.equal(w.timeZone.label, "EST");
  assert.equal(decodeYahooHistory("AAPL", "1M", yahoo("1d"), rangeWindow("1M", now)).daily, true);
  assert.equal(decodeYahooHistory("AAPL", "1Y", yahoo("1d"), rangeWindow("1Y", now)).daily, true);
  const k = ok([[Date.UTC(2026, 10, 16), "1", "1", "1", "2"]]);
  const b1m = decodeBinanceHistory("BTC/USDT", "1M", k, rangeWindow("1M", now));
  assert.equal(b1m.daily, false, "4-hour klines are shown with their time");
  assert.deepEqual(b1m.timeZone, UTC_ZONE);
  assert.equal(decodeBinanceHistory("BTC/USDT", "1Y", k, rangeWindow("1Y", now)).daily, true);
});
