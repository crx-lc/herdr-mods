// Tests for marketclock.js: New York time across DST, Nasdaq's schedule answer, the session phase,
// the next open or close with its countdown, and every way the schedule can be missing or untrustworthy.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HOUR, MINUTE, clockText, formatCountdown, marketClock, nextTickMs, nyOffsetHours, nyParts, nyToUtc,
  parseMarketInfo, parseUsDate, restoreSchedule, shouldFetch,
} from "../marketclock.js";

const Z = (iso) => Date.parse(iso); // a UTC instant

// The answer Nasdaq gave on Tue 2026-11-17 at 14:02 ET (trimmed to the fields read, plus a few).
const REAL = '{"data":{"country":"U.S.","marketIndicator":"Market Open","preMidOpeningTime":null,"preMidClosingTime":null,"postMidOpeningTime":null,"postMidClosingTime":null,"marketOpeningTime":"Nov 17, 2026 09:30 AM ET","marketClosingTime":"Nov 17, 2026 04:00 PM ET","previousTradeDate":"Nov 16, 2026","nextTradeDate":"Nov 18, 2026","isBusinessDay":true,"mrktStatus":"Open","pmOpenRaw":"2026-11-17T04:00:00","ahCloseRaw":"2026-11-17T20:00:00","openRaw":"2026-11-17T09:30:00","closeRaw":"2026-11-17T16:00:00","prevTrdDTRaw":"2026-11-16T00:00:00","isTradingHours":true},"message":null,"status":{"rCode":200}}';

/** A Nasdaq-shaped answer for one day. */
function answer({ business = true, date = "2026-11-17", pre = "04:00", open = "09:30", close = "16:00", post = "20:00", next = "Nov 18, 2026", mid = null } = {}) {
  return {
    data: {
      isBusinessDay: business, nextTradeDate: next, preMidOpeningTime: mid, preMidClosingTime: null, postMidOpeningTime: null, postMidClosingTime: null,
      pmOpenRaw: `${date}T${pre}:00`, openRaw: `${date}T${open}:00`, closeRaw: `${date}T${close}:00`, ahCloseRaw: `${date}T${post}:00`,
    },
    status: { rCode: 200 },
  };
}
const schedule = (fetchedIso, opts) => parseMarketInfo(answer(opts), Z(fetchedIso));
const show = (s, nowIso) => {
  const now = Z(nowIso);
  const state = marketClock(s, now);
  const text = clockText(state, now);
  return `${text.left} | ${text.phase}${text.right ? ` | ${text.right}` : ""}`;
};

test("New York time follows US daylight saving time, by rule", () => {
  // 2026: starts Sun Mar 8 02:00 EST (07:00Z), ends Sun Nov 1 02:00 EDT (06:00Z).
  assert.equal(nyOffsetHours(Z("2026-03-08T06:59:59Z")), -5);
  assert.equal(nyOffsetHours(Z("2026-03-08T07:00:00Z")), -4);
  assert.equal(nyOffsetHours(Z("2026-11-01T05:59:59Z")), -4);
  assert.equal(nyOffsetHours(Z("2026-11-01T06:00:00Z")), -5);
  // A year no list covers: 2031 (second Sunday of March is the 9th; first of November the 2nd).
  assert.equal(nyOffsetHours(Z("2031-03-09T07:00:00Z")), -4);
  assert.equal(nyOffsetHours(Z("2031-11-02T06:00:00Z")), -5);
  const p = nyParts(Z("2026-07-03T13:05:09Z"));
  assert.deepEqual([p.date, p.time, p.zone, p.weekday], ["2026-07-03", "09:05", "EDT", 5]);
  assert.equal(nyParts(Z("2026-11-18T04:59:00Z")).date, "2026-11-17", "23:59 EST is still the 17th in New York");
});

test("New York wall time to an instant, either side of each change", () => {
  assert.equal(nyToUtc("2026-03-06", "09:30"), Z("2026-03-06T14:30:00Z"), "Friday before: EST");
  assert.equal(nyToUtc("2026-03-09", "09:30"), Z("2026-03-09T13:30:00Z"), "Monday after: EDT");
  assert.equal(nyToUtc("2026-03-08", "01:00"), Z("2026-03-08T06:00:00Z"));
  assert.equal(nyToUtc("2026-03-08", "03:00"), Z("2026-03-08T07:00:00Z"));
  assert.equal(nyToUtc("2026-10-30", "16:00"), Z("2026-10-30T20:00:00Z"), "Friday before: EDT");
  assert.equal(nyToUtc("2026-11-02", "09:30"), Z("2026-11-02T14:30:00Z"), "Monday after: EST");
  assert.equal(nyToUtc("2026-02-30", "09:30"), null);
  assert.equal(nyToUtc("2026-11-17", "25:00"), null);
  assert.equal(parseUsDate("Nov 18, 2026"), "2026-11-18");
  assert.equal(parseUsDate("Feb 30, 2026"), null);
  assert.equal(parseUsDate("Foo 1, 2026"), null);
});

test("Nasdaq's real answer parses into today's schedule", () => {
  const s = parseMarketInfo(JSON.parse(REAL), Z("2026-11-17T19:02:00Z"));
  assert.deepEqual(s, {
    fetchedAt: Z("2026-11-17T19:02:00Z"), date: "2026-11-17", business: true, overnight: false, next: "2026-11-18",
    pre: Z("2026-11-17T09:00:00Z"), open: Z("2026-11-17T14:30:00Z"), close: Z("2026-11-17T21:00:00Z"), post: Z("2026-11-18T01:00:00Z"),
  });
});

test("a normal day: before, during and after the regular session", () => {
  const s = schedule("2026-11-17T08:00:00Z"); // fetched 03:00 EST
  assert.equal(show(s, "2026-11-17T08:30:00Z"), "NY 03:30 | Closed | Opens 09:30 · 6h 00m", "before pre-market");
  assert.equal(show(s, "2026-11-17T14:12:00Z"), "NY 09:12 | Pre-market | Opens 09:30 · 18m");
  assert.equal(show(s, "2026-11-17T14:29:15Z"), "NY 09:29 | Pre-market | Opens 09:30 · 45s");
  assert.equal(show(s, "2026-11-17T14:30:00Z"), "NY 09:30 | Open | Closes 16:00 · 6h 30m");
  assert.equal(show(s, "2026-11-17T20:42:00Z"), "NY 15:42 | Open | Closes 16:00 · 18m");
  assert.equal(show(s, "2026-11-17T21:42:00Z"), "NY 16:42 | After-hours | Opens Wed 09:30 · 16h 48m");
  assert.equal(show(s, "2026-11-18T01:30:00Z"), "NY 20:30 | Closed | Opens Wed 09:30 · 13h 00m", "after after-hours");
});

test("past midnight on an old schedule only the regular session is claimed closed", () => {
  const s = schedule("2026-11-17T20:00:00Z");
  assert.equal(show(s, "2026-11-18T06:00:00Z"), "NY 01:00 | Regular closed | Opens 09:30 · 8h 30m");
  assert.equal(show(s, "2026-11-18T10:00:00Z"), "NY 05:00 | Regular closed | Opens 09:30 · 4h 30m", "not 'Closed': pre-market may be on");
});

test("a weekend counts down to Monday's open", () => {
  const s = schedule("2026-11-21T15:00:00Z", { business: false, date: "2026-11-20", next: "Nov 23, 2026" });
  assert.equal(s.date, "2026-11-21", "a non-business answer describes the day it was fetched");
  assert.equal(show(s, "2026-11-21T15:00:00Z"), "NY 10:00 | Weekend | Opens Mon 09:30 · 1d 23h");
});

test("a holiday (Thanksgiving, Thu 2026-11-26) is not a trading day, whatever the weekday", () => {
  const s = schedule("2026-11-26T13:00:00Z", { business: false, next: "Nov 27, 2026" });
  assert.equal(show(s, "2026-11-26T16:00:00Z"), "NY 11:00 | Holiday | Opens Fri 09:30 · 22h 30m");
  // After the Wednesday close, a schedule from Wednesday already points past Thursday.
  const wed = schedule("2026-11-25T22:00:00Z", { date: "2026-11-25", next: "Nov 27, 2026" });
  assert.equal(show(wed, "2026-11-26T00:30:00Z"), "NY 19:30 | After-hours | Opens Fri 09:30 · 1d 14h");
});

test("an early close (Fri 2026-11-27, 13:00) and its shorter after-hours", () => {
  const s = schedule("2026-11-27T12:00:00Z", { date: "2026-11-27", close: "13:00", post: "17:00", next: "Nov 30, 2026" });
  assert.equal(show(s, "2026-11-27T17:00:00Z"), "NY 12:00 | Open | Early close 13:00 · 1h 00m");
  assert.equal(show(s, "2026-11-27T18:30:00Z"), "NY 13:30 | After-hours | Opens Mon 09:30 · 2d 20h");
  assert.equal(show(s, "2026-11-27T22:30:00Z"), "NY 17:30 | Closed | Opens Mon 09:30 · 2d 16h");
});

test("countdowns across a DST change are an hour shorter or longer, as on the wall clock", () => {
  const spring = schedule("2026-03-06T22:00:00Z", { date: "2026-03-06", next: "Mar 9, 2026" });
  assert.equal(marketClock(spring, Z("2026-03-07T15:00:00Z")).event.at, Z("2026-03-09T13:30:00Z"));
  assert.equal(show(spring, "2026-03-07T03:00:00Z"), "NY 22:00 | Closed | Opens Mon 09:30 · 2d 10h", "Fri 22:00 EST → Mon 09:30 EDT is 58.5 h");
  const monday = schedule("2026-03-09T12:00:00Z", { date: "2026-03-09", next: "Mar 10, 2026" });
  assert.equal(show(monday, "2026-03-09T13:00:00Z"), "NY 09:00 | Pre-market | Opens 09:30 · 30m");
  const fall = schedule("2026-10-30T21:00:00Z", { date: "2026-10-30", next: "Nov 2, 2026" });
  assert.equal(marketClock(fall, Z("2026-10-31T15:00:00Z")).event.at, Z("2026-11-02T14:30:00Z"));
  assert.equal(show(fall, "2026-10-30T21:00:00Z"), "NY 17:00 | After-hours | Opens Mon 09:30 · 2d 17h", "Fri 17:00 EDT → Mon 09:30 EST is 65.5 h");
});

test("no schedule: the clock alone, never a countdown", () => {
  assert.equal(show(null, "2026-11-17T20:42:00Z"), "NY 15:42 | Market schedule unavailable");
  assert.equal(clockText(marketClock(null, Z("2026-11-17T20:42:00Z"), { loading: true }), 0).phase, "Loading schedule…");
});

test("answers that aren't what's expected are refused", () => {
  const at = Z("2026-11-17T19:00:00Z");
  const bad = {
    "no data": {}, "no business flag": { data: { nextTradeDate: "Nov 18, 2026" } }, "error code": { ...answer(), status: { rCode: 400 } },
    "garbage open": answer({ open: "xx:yy" }), "close after 16:00": answer({ close: "17:00" }), "open at noon": answer({ open: "12:00" }),
    "close before open": answer({ open: "10:00", close: "10:30" }), "next before today": answer({ next: "Nov 16, 2026" }),
    "next too far": answer({ next: "Dec 30, 2026" }), "next unreadable": answer({ next: "tomorrow" }),
    "a future day": answer({ date: "2026-11-19", next: "Nov 20, 2026" }), "a week-old day": answer({ date: "2026-11-10", next: "Nov 11, 2026" }),
  };
  for (const [name, json] of Object.entries(bad)) assert.equal(parseMarketInfo(json, at), null, name);
  assert.equal(parseMarketInfo(null, at), null);
});

test("stale or used-up schedules are unavailable, not confidently wrong", () => {
  const s = schedule("2026-11-17T08:00:00Z");
  assert.equal(marketClock(s, Z("2026-11-18T08:00:01Z")).reason, "stale", "older than 24 h");
  assert.equal(marketClock(s, Z("2026-11-17T07:00:00Z")).reason, "stale", "fetched in the future: a wrong clock");
  // Wednesday 09:31: Tuesday's schedule knew the open, not Wednesday's close (an early close?).
  const tue = schedule("2026-11-17T21:00:00Z");
  assert.equal(show(tue, "2026-11-18T14:31:00Z"), "NY 09:31 | Market schedule unavailable");
  assert.equal(marketClock(tue, Z("2026-11-18T14:31:00Z")).reason, "used");
});

test("listed overnight sessions: never 'Closed', only 'Regular closed'", () => {
  const s = schedule("2026-11-17T08:00:00Z", { mid: "Nov 17, 2026 08:00 PM ET" });
  assert.equal(show(s, "2026-11-18T02:00:00Z"), "NY 21:00 | Regular closed | Opens Wed 09:30 · 12h 30m");
  assert.equal(show(s, "2026-11-17T08:30:00Z"), "NY 03:30 | Regular closed | Opens 09:30 · 6h 00m");
});

test("countdown text and the redraw pace", () => {
  assert.deepEqual([0, 999, 59_001, 60_000, 18 * MINUTE + 59_000, 3 * HOUR + 5 * MINUTE, 50 * HOUR].map(formatCountdown),
    ["now", "1s", "1m", "1m", "18m", "3h 05m", "2d 2h"]);
  assert.equal(formatCountdown(59_001), "1m", "a minute not yet down to seconds");
  assert.equal(formatCountdown(59_000), "59s");
  const s = schedule("2026-11-17T08:00:00Z");
  const now = Z("2026-11-17T20:42:10.500Z");
  assert.equal(nextTickMs(marketClock(s, now), now), 49_520, "the next minute, not every second");
  const close = Z("2026-11-17T20:59:30.250Z");
  assert.equal(nextTickMs(marketClock(s, close), close), 770, "the last minute: every second");
  assert.equal(nextTickMs(marketClock(null, now), now), 49_520);
});

test("when to ask Nasdaq again", () => {
  const s = schedule("2026-11-17T15:00:00Z");
  assert.equal(shouldFetch({ schedule: null, now: Z("2026-11-17T15:00:00Z") }), true);
  assert.equal(shouldFetch({ schedule: null, now: 1, inflight: true }), false, "one request at a time");
  assert.equal(shouldFetch({ schedule: s, now: Z("2026-11-17T17:00:00Z") }), false, "fresh");
  assert.equal(shouldFetch({ schedule: s, now: Z("2026-11-17T18:00:00Z") }), true, "3 h old");
  assert.equal(shouldFetch({ schedule: schedule("2026-11-18T04:00:00Z"), now: Z("2026-11-18T05:01:00Z") }), true, "a new New York day (23:00 → 00:01)");
  const failedAt = Z("2026-11-17T15:00:00Z");
  assert.equal(shouldFetch({ schedule: null, now: failedAt + 20_000, failures: 1, lastAttempt: failedAt }), false, "30 s after one failure");
  assert.equal(shouldFetch({ schedule: null, now: failedAt + 31_000, failures: 1, lastAttempt: failedAt }), true);
  assert.equal(shouldFetch({ schedule: null, now: failedAt + 29 * MINUTE, failures: 9, lastAttempt: failedAt }), false, "capped at 30 min");
  assert.equal(shouldFetch({ schedule: null, now: failedAt + 30 * MINUTE, failures: 9, lastAttempt: failedAt }), true);
});

test("a stored schedule survives JSON, and junk doesn't", () => {
  const s = schedule("2026-11-17T15:00:00Z");
  assert.deepEqual(restoreSchedule(JSON.parse(JSON.stringify(s))), s);
  for (const junk of [null, 3, "x", {}, { ...s, fetchedAt: "now" }, { ...s, open: null }, { ...s, close: "16:00" }]) {
    assert.equal(restoreSchedule(junk), null, JSON.stringify(junk));
  }
});

test("the panel's date is New York's, with its weekday", () => {
  assert.equal(nyParts(Z("2026-11-17T19:16:00Z")).day, "Tue Nov 17");
  assert.equal(nyParts(Z("2026-11-18T03:30:00Z")).day, "Tue Nov 17", "22:30 in New York, already Wednesday in UTC");
  assert.equal(nyParts(Z("2027-01-01T04:59:00Z")).day, "Thu Dec 31");
  assert.equal(clockText(marketClock(null, Z("2026-11-21T15:00:00Z")), 0).day, "Sat Nov 21", "shown without a schedule too");
});
