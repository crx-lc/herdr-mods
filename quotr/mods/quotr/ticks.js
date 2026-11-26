// Which rows' prices moved since their previous
// quote, and which way, for the panel's tick flash and arrow. No Herdr imports, so `node --test` runs it.
//
// A tick is a NEW quote object for a symbol (a refresh delivered data), compared with the price of
// the quote it replaced. Redraws without new data, a first-ever quote and a removed symbol are not ticks.

import { shownQuote } from "./quotes.js";

// The price the row shows (a stock's latest trade, extended hours included).
const priceOf = (q) => shownQuote(q)?.price;

export function createTickMemory() {
  return { ref: new Map(), price: new Map() };
}

/** Remembers the current quotes without reporting ticks (start-up, restored quotes). */
export function primeTicks(memory, quotes, symbols) {
  for (const s of symbols) {
    const q = quotes[s];
    if (!q) continue;
    memory.ref.set(s, q);
    const price = priceOf(q);
    if (Number.isFinite(price) && price > 0) memory.price.set(s, price);
  }
}

/** [{ symbol, dir: "up" | "down" | "flat", delta }] for each symbol whose quote object changed. */
export function takeTicks(memory, quotes, symbols) {
  const out = [];
  for (const s of symbols) {
    const q = quotes[s];
    if (!q || memory.ref.get(s) === q) continue;
    memory.ref.set(s, q);
    const shown = priceOf(q);
    const price = Number.isFinite(shown) && shown > 0 ? shown : null;
    const before = memory.price.get(s);
    if (price === null) continue;
    memory.price.set(s, price);
    if (before === undefined) continue; // the first quote for this row: nothing to compare with
    const delta = price - before;
    out.push({ symbol: s, dir: delta > 0 ? "up" : delta < 0 ? "down" : "flat", delta });
  }
  // Forget symbols that left the list, so re-adding one starts fresh.
  for (const s of [...memory.ref.keys()]) if (!symbols.includes(s)) { memory.ref.delete(s); memory.price.delete(s); }
  return out;
}
