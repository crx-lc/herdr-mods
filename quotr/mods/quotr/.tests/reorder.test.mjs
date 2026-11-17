// Local customization tests for reordering the watchlist (Watchlist.move and sync).
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { Watchlist } from "../watchlist.js";

// Two copies sharing one store, like two Pulse panels sharing Herdr's shared state.
function shared(symbols, paused = false) {
  let stored = { version: 1, symbols: [...symbols], paused };
  const fetches = [];
  const host = () => ({
    load: () => stored,
    save: (p) => { stored = JSON.parse(JSON.stringify(p)); },
    fetch: async (url) => { fetches.push(url); return { status: 500, ok: false, text: async () => "" }; },
    now: () => 0,
    sleep: () => new Promise(() => {}),
    changed: () => {},
  });
  return { host, fetches, stored: () => stored };
}

test("moves to any position, clamped, and saves the order", () => {
  const s = shared(["BTC/USDT", "INTR", "AZUL", "MSFT", "NU"]);
  const w = new Watchlist(s.host());
  assert.equal(w.move("MSFT", 0), "Moved MSFT to position 1.");
  assert.deepEqual(s.stored().symbols, ["MSFT", "BTC/USDT", "INTR", "AZUL", "NU"]);
  assert.equal(w.move("MSFT", 1), "Moved MSFT to position 2.", "down one");
  assert.deepEqual(w.preferences.symbols, ["BTC/USDT", "MSFT", "INTR", "AZUL", "NU"]);
  assert.equal(w.move("BTC/USDT", 99), "Moved BTC/USDT to position 5.", "past the end: the bottom");
  assert.equal(w.move("NU", -5), "Moved NU to position 1.", "before the start: the top");
  assert.deepEqual(s.stored().symbols, ["NU", "MSFT", "INTR", "AZUL", "BTC/USDT"]);
});

test("a move that changes nothing, or of an unknown ticker, saves nothing", () => {
  const s = shared(["A", "B", "C"]);
  const w = new Watchlist(s.host());
  const before = s.stored();
  assert.equal(w.move("A", 0), "");
  assert.equal(w.move("C", 2), "");
  assert.equal(w.move("ZZZ", 0), "ZZZ is not on your watchlist.");
  assert.equal(w.move("B", "x"), "Moved B to position 1.", "a non-number position is the top, not an error");
  assert.notEqual(s.stored(), before);
});

test("reordering keeps quotes and the pause, and starts no refresh", () => {
  const s = shared(["A", "B", "C"], true);
  const w = new Watchlist(s.host());
  w.quotes.A = { symbol: "A", price: 1 };
  w.quotes.C = { symbol: "C", price: 3 };
  const revision = w.revision;
  w.dirty = false;
  let woken = false;
  w.wake = () => { woken = true; };
  w.move("C", 0);
  assert.deepEqual(w.preferences, { version: 1, symbols: ["C", "A", "B"], paused: true });
  assert.deepEqual(Object.keys(w.quotes).sort(), ["A", "C"], "quotes kept");
  assert.equal(w.revision, revision, "a round in flight keeps its results");
  assert.equal(w.dirty, false);
  assert.equal(woken, false, "the refresh loop is not woken");
  assert.equal(s.fetches.length, 0);
});

test("another copy adopts a reorder without a new round, but an added ticker still refreshes", () => {
  const s = shared(["A", "B", "C"]);
  const a = new Watchlist(s.host());
  const b = new Watchlist(s.host());
  a.move("C", 0);
  const revision = b.revision;
  b.dirty = false;
  assert.equal(b.sync(), true);
  assert.deepEqual(b.preferences.symbols, ["C", "A", "B"]);
  assert.equal(b.revision, revision);
  assert.equal(b.dirty, false);
  assert.equal(b.sync(), false, "nothing more to adopt");
  a.add("D");
  assert.equal(b.sync(), true);
  assert.equal(b.revision, revision + 1, "a new ticker means a new round");
  assert.equal(b.dirty, true);
});
