// Local customization tests for price ticks (ticks.js): what flashes, which way, and when not.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { createTickMemory, primeTicks, takeTicks } from "../ticks.js";

const q = (symbol, price) => ({ symbol, price });

test("a new quote reports up, down or flat against the one it replaced", () => {
  const m = createTickMemory();
  const quotes = { A: q("A", 10), B: q("B", 10), C: q("C", 10) };
  primeTicks(m, quotes, ["A", "B", "C"]);
  quotes.A = q("A", 10.5);
  quotes.B = q("B", 9.25);
  quotes.C = q("C", 10);
  assert.deepEqual(takeTicks(m, quotes, ["A", "B", "C"]), [
    { symbol: "A", dir: "up", delta: 0.5 },
    { symbol: "B", dir: "down", delta: -0.75 },
    { symbol: "C", dir: "flat", delta: 0 },
  ]);
});

test("redraws without new data are not ticks", () => {
  const m = createTickMemory();
  const quotes = { A: q("A", 10) };
  primeTicks(m, quotes, ["A"]);
  assert.deepEqual(takeTicks(m, quotes, ["A"]), [], "same quote object");
  quotes.A = q("A", 11);
  assert.equal(takeTicks(m, quotes, ["A"]).length, 1);
  assert.deepEqual(takeTicks(m, quotes, ["A"]), [], "reported once, not on every later redraw");
});

test("the first quote for a row has nothing to compare with", () => {
  const m = createTickMemory();
  const quotes = {};
  primeTicks(m, quotes, ["NEW"]);
  quotes.NEW = q("NEW", 5);
  assert.deepEqual(takeTicks(m, quotes, ["NEW"]), []);
  quotes.NEW = q("NEW", 6);
  assert.deepEqual(takeTicks(m, quotes, ["NEW"]), [{ symbol: "NEW", dir: "up", delta: 1 }]);
});

test("after a reload, the restored price is the previous one", () => {
  const m = createTickMemory();
  const quotes = { INTR: q("INTR", 3.96) }; // restored from the snapshot
  primeTicks(m, quotes, ["INTR"]);
  quotes.INTR = q("INTR", 3.99);             // the first fresh quote
  assert.deepEqual(takeTicks(m, quotes, ["INTR"]).map((t) => t.dir), ["up"]);
});

test("an invalid price is not a tick and doesn't become the reference", () => {
  const m = createTickMemory();
  const quotes = { A: q("A", 10) };
  primeTicks(m, quotes, ["A"]);
  quotes.A = q("A", NaN);
  assert.deepEqual(takeTicks(m, quotes, ["A"]), []);
  quotes.A = q("A", 9);
  assert.deepEqual(takeTicks(m, quotes, ["A"]), [{ symbol: "A", dir: "down", delta: -1 }], "still compared with 10");
});

test("a removed and re-added ticker starts fresh", () => {
  const m = createTickMemory();
  const quotes = { A: q("A", 10), B: q("B", 1) };
  primeTicks(m, quotes, ["A", "B"]);
  delete quotes.A;
  takeTicks(m, quotes, ["B"]);
  quotes.A = q("A", 20);
  assert.deepEqual(takeTicks(m, quotes, ["A", "B"]), [], "no jump from a price it had before removal");
});
