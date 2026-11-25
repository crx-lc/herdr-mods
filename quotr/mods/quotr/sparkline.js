// The watchlist row's chart: a small version of the dialog's 1D chart. No Herdr imports.
//
// One rule ties it to the row's numbers: the line, its color and the dashed reference all come
// from the same quote as the price and percentage beside it. The reference is what the
// percentage is measured against (a stock's previous regular close, a pair's price 24 hours
// ago); the line is drawn against it, in the percentage's color. Only observed prices are
// drawn, each at its own time: bar closes, the first bar's open and the quote itself. Gaps in
// the data stay blank; nothing is interpolated or inferred.
import { formatPrice, isCryptoPair } from "./quotes.js";
import { zoneAt } from "./readout.js";

export const SPARK_WIDTH = 56;
export const SPARK_HEIGHT = 22;
// Vertical room for the line: 2px top and bottom keep the stroke inside the box.
export const SPARK_TOP = 2;
export const SPARK_BOTTOM = 20;
export const SPARK_LEFT = 1;
export const SPARK_RIGHT = 55;
// The smallest vertical span, as a share of the reference: a 0.1% wiggle stays small.
export const MIN_SPAN = 0.01;
export const STALE_AFTER_MS = 180_000;
const DAY_MS = 86_400_000;
// Bar lengths: Yahoo's 5-minute bars, Binance's 15-minute klines.
export const STOCK_BAR_MS = 300_000;
export const CRYPTO_BAR_MS = 900_000;

const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const range = (r) => Array.isArray(r) && positive(r[0]) && positive(r[1]) && r[1] > r[0];

/** The time window the line spans: a pair's rolling 24h, a stock's regular session. */
export function sparkWindow(quote, observed) {
  const q = quote ?? {};
  if (isCryptoPair(q.symbol ?? "")) {
    if (!positive(q.timestamp)) return null;
    const start = positive(q.windowStart) && q.windowStart < q.timestamp ? q.windowStart : q.timestamp - DAY_MS;
    return [start, q.timestamp];
  }
  // A bar's end, or the closing print, may sit just past the session's end.
  const fits = (r) => range(r) && observed.every((p) => p.t >= r[0] && p.t <= r[1] + STOCK_BAR_MS);
  for (const r of [q.session, q.periods?.regular]) if (fits(r)) return r;
  // No session that holds every bar: span the bars themselves rather than drop them.
  if (observed.length > 1) return [observed[0].t, observed.at(-1).t];
  return null;
}

/**
 * Observed prices in time order: the first bar's open at the bar's start, each bar's close at
 * the bar's end (the bar still forming ends at the quote's time), then the quote itself.
 */
export function observedPrices(quote) {
  const q = quote ?? {};
  const bar = isCryptoPair(q.symbol ?? "") ? CRYPTO_BAR_MS : STOCK_BAR_MS;
  const points = Array.isArray(q.points) ? q.points.filter((p) => positive(p?.t) && positive(p?.close)) : [];
  const out = [];
  if (positive(q.firstOpen?.t) && positive(q.firstOpen?.price) && (!points.length || q.firstOpen.t <= points[0].t)) {
    out.push({ t: q.firstOpen.t, price: q.firstOpen.price });
  }
  const latest = positive(q.timestamp) ? q.timestamp : Infinity;
  for (const p of points) out.push({ t: Math.max(p.t, Math.min(p.t + bar, latest)), price: p.close });
  out.sort((a, b) => a.t - b.t);
  // The quote is a real trade at its own time; it ends the line when it is newer than the bars.
  if (positive(q.price) && positive(q.timestamp) && (!out.length || q.timestamp > out.at(-1).t)) {
    out.push({ t: q.timestamp, price: q.price });
  }
  // One price per time: a later entry at the same time replaces the earlier.
  const unique = [];
  for (const p of out) {
    if (unique.length && unique.at(-1).t === p.t) unique[unique.length - 1] = p;
    else unique.push(p);
  }
  return unique;
}

/** The reference, only when the displayed percentage really is measured against it. */
export function sparkReference(quote) {
  const q = quote ?? {};
  if (!positive(q.price) || !positive(q.previousClose) || !Number.isFinite(q.changePercent)) return null;
  const computed = (q.price - q.previousClose) / q.previousClose * 100;
  return Math.abs(computed - q.changePercent) < 1e-6 ? q.previousClose : null;
}

/**
 * The 56×22 geometry, in pixels: `line` [[x, y]], `reference` (y or null), `stale`, `label`
 * (the one-line hover) and `description` (for screen readers).
 */
export function watchlistSparkline(quote, now, { failed = false } = {}) {
  const q = quote ?? {};
  const crypto = isCryptoPair(q.symbol ?? "");
  const all = observedPrices(q);
  const window = sparkWindow(q, all);
  const slack = crypto ? 0 : STOCK_BAR_MS;
  const observed = window ? all.filter((p) => p.t >= window[0] && p.t <= window[1] + slack) : [];
  const reference = sparkReference(q);
  let line = [];
  let referenceY = null;
  if (observed.length) {
    const values = observed.map((p) => p.price);
    if (reference !== null) values.push(reference);
    let low = Math.min(...values);
    let high = Math.max(...values);
    const minimum = (reference ?? (low + high) / 2) * MIN_SPAN;
    if (high - low < minimum) {
      const middle = (low + high) / 2;
      low = middle - minimum / 2;
      high = middle + minimum / 2;
    }
    const y = (v) => SPARK_BOTTOM - (SPARK_BOTTOM - SPARK_TOP) * (v - low) / (high - low);
    const x = (t) => SPARK_LEFT + (SPARK_RIGHT - SPARK_LEFT) * Math.min(1, (t - window[0]) / (window[1] - window[0]));
    line = observed.map((p) => [x(p.t), y(p.price)]);
    referenceY = reference !== null ? y(reference) : null;
  } else if (reference !== null) {
    referenceY = (SPARK_TOP + SPARK_BOTTOM) / 2;
  }
  const stale = failed || !positive(q.fetchedAt) || !Number.isFinite(now) || now < q.fetchedAt
    || now - q.fetchedAt > STALE_AFTER_MS;
  const label = sparkLabel(q, observed, reference, crypto);
  return { line, reference: referenceY, stale, label, description: `Chart: ${label}` };
}

function clock(t, zone) {
  const z = zoneAt(t, zone);
  const d = new Date(t + z.offsetSeconds * 1000);
  return { text: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`, zone: z.label };
}

/** One short line: what the line covers and what it is measured against. */
export function sparkLabel(q, observed, reference, crypto) {
  const price = (value) => formatPrice({ price: value, currency: q.currency ?? null });
  const against = reference === null ? "no reference"
    : crypto ? `vs ${price(reference)} 24h ago` : `vs prev close ${price(reference)}`;
  if (!observed.length) return `No bars yet · ${against}`;
  if (crypto) return `Last 24h · ${against}`;
  const from = clock(observed[0].t, q.timeZone);
  const to = clock(observed.at(-1).t, q.timeZone);
  return `Regular ${from.text}–${to.text} ${to.zone} · ${against}`;
}
