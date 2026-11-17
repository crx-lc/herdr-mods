// Tests for marketfeed.js: loading the market schedule through fetch and curl, with a fake host.
// Covers the failure the live panel hit first: a request that never answers.
import test from "node:test";
import assert from "node:assert/strict";
import { BUSY_LIMIT_MS, REQUEST_TIMEOUT_MS, ScheduleFeed, USER_AGENT, curlArgs, readAnswer, readCurl } from "../marketfeed.js";
import { MARKET_INFO_URL, MINUTE } from "../marketclock.js";

const NOW = Date.parse("2026-11-17T19:00:00Z"); // Tue 14:00 in New York
const GOOD = JSON.stringify({
  data: {
    isBusinessDay: true, nextTradeDate: "Nov 18, 2026", pmOpenRaw: "2026-11-17T04:00:00", openRaw: "2026-11-17T09:30:00",
    closeRaw: "2026-11-17T16:00:00", ahCloseRaw: "2026-11-17T20:00:00",
  },
  status: { rCode: 200 },
});
const ok = { status: 200, text: GOOD };
const HANG = new Promise(() => {}); // a request that never answers

/** A host whose sources are given; `deadline` resolves null for a promise that hasn't settled by then. */
function host({ viaFetch, viaCurl = async () => null, stored = null } = {}) {
  const h = {
    clock: NOW, calls: [], deadlines: [], saved: null,
    now: () => h.clock,
    viaFetch: () => { h.calls.push("fetch"); return viaFetch(); },
    viaCurl: () => { h.calls.push("curl"); return viaCurl(); },
    // Settled promises win; a hanging one "times out" at once, advancing the clock by the limit.
    deadline: (promise, ms) => {
      h.deadlines.push(ms);
      const late = new Promise((resolve) => setImmediate(() => { h.clock += ms; resolve(null); }));
      return Promise.race([promise, late]);
    },
    load: () => stored,
    save: (text) => { h.saved = text; },
  };
  return h;
}

test("fetch answers: the schedule is in place and stored, curl isn't run", async () => {
  const h = host({ viaFetch: async () => ok });
  const feed = new ScheduleFeed(h);
  assert.equal(await feed.refresh(), true);
  assert.deepEqual(h.calls, ["fetch"]);
  assert.equal(feed.schedule.date, "2026-11-17");
  assert.deepEqual([feed.failures, feed.inflight, feed.lastError], [0, false, ""]);
  assert.deepEqual(JSON.parse(h.saved), feed.schedule);
  assert.equal(feed.state().phase, "regular");
});

test("fetch never answers: its deadline passes and curl gets the schedule", async () => {
  const h = host({ viaFetch: () => HANG, viaCurl: async () => ok });
  const feed = new ScheduleFeed(h);
  assert.equal(await feed.refresh(), true);
  assert.deepEqual(h.calls, ["fetch", "curl"]);
  assert.deepEqual(h.deadlines, [REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS + 2_000]);
  assert.equal(feed.inflight, false, "nothing left hanging");
});

test("fetch throws, rejects or returns an error status: curl is the second try", async () => {
  for (const viaFetch of [() => { throw new Error("not granted"); }, async () => { throw new Error("offline"); }, async () => ({ status: 403, text: "" })]) {
    const h = host({ viaFetch, viaCurl: async () => ok });
    const feed = new ScheduleFeed(h);
    assert.equal(await feed.refresh(), true);
    assert.deepEqual(h.calls, ["fetch", "curl"]);
  }
});

test("both hang: the try ends, counts as a failure and says why; never a stuck 'loading'", async () => {
  const h = host({ viaFetch: () => HANG, viaCurl: () => HANG });
  const feed = new ScheduleFeed(h);
  assert.equal(feed.loading(), true, "before the first try");
  assert.equal(await feed.refresh(), false);
  assert.deepEqual([feed.failures, feed.inflight, feed.lastError], [1, false, "no answer; curl: no answer"]);
  assert.equal(feed.loading(), false);
  assert.equal(feed.state().label, "Market schedule unavailable");
  assert.equal(h.saved, null);
});

test("a failed try keeps the last good schedule and waits before the next", async () => {
  let answer = ok;
  const h = host({ viaFetch: async () => answer, viaCurl: async () => ({ status: 200, text: "<html>blocked</html>" }) });
  const feed = new ScheduleFeed(h);
  await feed.refresh();
  const first = feed.schedule;
  answer = { status: 500, text: "" };
  h.clock += 3 * 60 * MINUTE; // 3 h later: due again
  assert.equal(feed.due(), true);
  assert.equal(await feed.refresh(), false);
  assert.equal(feed.schedule, first, "still the last good one");
  assert.equal(feed.lastError, "HTTP 500; curl: unreadable answer");
  assert.equal(feed.due(), false, "30 s retry wait");
  h.clock += 31_000;
  assert.equal(feed.due(), true);
});

test("an unexpected answer is refused, whichever way it came", async () => {
  const odd = { status: 200, text: JSON.stringify({ data: { isBusinessDay: true, nextTradeDate: "soon" } }) };
  const h = host({ viaFetch: async () => odd, viaCurl: async () => odd });
  const feed = new ScheduleFeed(h);
  assert.equal(await feed.refresh(), false);
  assert.equal(feed.lastError, "unexpected answer; curl: unexpected answer");
  assert.equal(feed.schedule, null);
});

test("one request at a time; one that overstays stops blocking and can't overwrite a newer result", async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const h = host({ viaFetch: () => slow });
  h.deadline = (promise) => promise; // no deadline at all: the worst case
  const feed = new ScheduleFeed(h);
  const first = feed.refresh();
  assert.equal(feed.busy(), true);
  assert.equal(feed.due(), false, "not while one is out");
  h.clock += BUSY_LIMIT_MS;
  assert.equal(feed.busy(), false, "overstayed");
  assert.equal(feed.loading(), false, "'loading' is over too");
  assert.equal(feed.due(), true);
  h.viaFetch = async () => ok;
  assert.equal(await feed.refresh(), true, "the newer try");
  const kept = feed.schedule;
  release({ status: 500, text: "" });
  assert.equal(await first, false, "the old try's late failure is dropped");
  assert.deepEqual([feed.schedule, feed.failures, feed.lastError], [kept, 0, ""]);
});

test("a stored schedule shows at once; junk in storage is ignored; storage that throws is survived", async () => {
  const good = new ScheduleFeed(host({ viaFetch: async () => ok }));
  await good.refresh();
  const again = new ScheduleFeed(host({ stored: good.host.saved }));
  again.restore();
  assert.deepEqual(again.schedule, good.schedule);
  assert.equal(again.state().available, true, "no request needed");
  for (const stored of ["{not json", "42", JSON.stringify({ fetchedAt: "x" })]) {
    const feed = new ScheduleFeed(host({ stored }));
    feed.restore();
    assert.equal(feed.schedule, null, stored);
  }
  const h = host({ viaFetch: async () => ok });
  h.load = () => { throw new Error("no storage"); };
  h.save = () => { throw new Error("full"); };
  const feed = new ScheduleFeed(h);
  feed.restore();
  assert.equal(await feed.refresh(), true, "kept in memory");
});

test("curl: https only, no shell, a time limit; its output split into body and status", () => {
  const args = curlArgs();
  assert.equal(args.at(-1), MARKET_INFO_URL);
  assert.deepEqual(args.slice(0, 5), ["-sS", "--proto", "=https", "--max-time", "12"]);
  assert.ok(args.includes(USER_AGENT));
  assert.deepEqual(readCurl({ code: 0, stdout: `${GOOD}\n200` }), { status: 200, text: GOOD });
  assert.deepEqual(readCurl({ code: 0, stdout: "line1\nline2\n404" }), { status: 404, text: "line1\nline2" });
  for (const bad of [{ code: 28, stdout: "\n000" }, { code: 0, stdout: "200" }, { code: 0, stdout: "body\nxyz" }, { code: 0, stdout: "body\n000" }, null, {}]) {
    assert.equal(readCurl(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readAnswer(null, NOW), { error: "no answer" });
  assert.deepEqual(readAnswer({ status: 429, text: "" }, NOW), { error: "HTTP 429" });
});
