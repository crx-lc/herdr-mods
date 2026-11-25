// The watchlist row's chart: a small version of the dialog's 1D chart. No Herdr imports.
//
// The line is a stock's latest regular session (a pair's rolling 24h), against a dashed line at
// the price the row's percentage is measured against, in that percentage's color. For a stock the
// row may show a newer pre-market or after-hours trade (quotes.js shownQuote); the chart stays on
// the regular session, and the dashed line is still the close that trade is measured against.
// Only observed prices are drawn, each at its own time; consecutive prices are joined, so a
// stretch with no trade is a straight segment, never a blank (the owner's decision, issue #37).
import { formatPrice, formatChange, isCryptoPair, shownQuote, STOCK_BAR_MS, CRYPTO_BAR_MS } from "./quotes.js";
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
export { STOCK_BAR_MS, CRYPTO_BAR_MS };

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
 * Observed prices in time order: the first bar's open at the bar's start, each finished bar's
 * close at the bar's end, then the displayed quote, which always ends the line. A bar still
 * forming at the quote's time (or after it) is left out: its close was read at some other moment
 * than the quote's, so it can't be placed against it.
 */
export function observedPrices(quote) {
  const q = quote ?? {};
  const bar = isCryptoPair(q.symbol ?? "") ? CRYPTO_BAR_MS : STOCK_BAR_MS;
  const shown = positive(q.price) && positive(q.timestamp) ? { t: q.timestamp, price: q.price } : null;
  const until = shown?.t ?? Infinity;
  const points = Array.isArray(q.points) ? q.points.filter((p) => positive(p?.t) && positive(p?.close)) : [];
  const out = [];
  if (positive(q.firstOpen?.t) && positive(q.firstOpen?.price) && q.firstOpen.t <= until
    && (!points.length || q.firstOpen.t <= points[0].t)) {
    out.push({ t: q.firstOpen.t, price: q.firstOpen.price });
  }
  for (const p of points) if (p.t + bar <= until) out.push({ t: p.t + bar, price: p.close });
  out.sort((a, b) => a.t - b.t);
  if (shown) out.push(shown);
  // One price per time: the later entry (the quote, at the end) wins.
  const unique = [];
  for (const p of out) {
    if (unique.length && unique.at(-1).t === p.t) unique[unique.length - 1] = p;
    else unique.push(p);
  }
  return unique;
}

/**
 * The reference, only when the displayed percentage really is measured against it. For a stock
 * that is the row's shown quote (its latest trade, extended hours included).
 */
export function sparkReference(quote) {
  const q = shownQuote(quote ?? {}) ?? {};
  if (!positive(q.price) || !positive(q.previousClose) || !Number.isFinite(q.changePercent)) return null;
  const computed = (q.price - q.previousClose) / q.previousClose * 100;
  return Math.abs(computed - q.changePercent) < 1e-6 ? q.previousClose : null;
}

/** The vertical scale over `values`, at least MIN_SPAN of `basis` tall: price → y in pixels. */
function scale(values, basis) {
  let low = Math.min(...values);
  let high = Math.max(...values);
  const minimum = (basis ?? (low + high) / 2) * MIN_SPAN;
  if (high - low < minimum) {
    const middle = (low + high) / 2;
    low = middle - minimum / 2;
    high = middle + minimum / 2;
  }
  return (v) => SPARK_BOTTOM - (SPARK_BOTTOM - SPARK_TOP) * (v - low) / (high - low);
}

/**
 * The 56×22 geometry, in pixels: `line` [[x, y]], `runs` (the line's drawn pieces: one, joined),
 * `reference` (y or null), `stale`, `label` (the one-line hover) and `description`
 * (for screen readers). `quote` is the stored quote: its regular session is drawn.
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
  let runs = [];
  let referenceY = null;
  if (observed.length) {
    const values = observed.map((p) => p.price);
    if (reference !== null) values.push(reference);
    const y = scale(values, reference);
    const x = (t) => SPARK_LEFT + (SPARK_RIGHT - SPARK_LEFT) * Math.min(1, (t - window[0]) / (window[1] - window[0]));
    line = observed.map((p) => [x(p.t), y(p.price)]);
    // Joined, never broken: no trade in a while is a straight segment (the owner's decision).
    runs = [line];
    referenceY = reference !== null ? y(reference) : null;
  } else if (reference !== null) {
    referenceY = (SPARK_TOP + SPARK_BOTTOM) / 2;
  }
  // After the next day's first pre-market trade the reference is this session's own close.
  const label = sparkLabel(q, observed, reference, crypto, reference !== null && reference !== q.previousClose);
  return { line, runs, reference: referenceY, stale: isStale(q, now, failed), label, description: `Chart: ${label}` };
}

const isStale = (q, now, failed) => failed || !positive(q.fetchedAt) || !Number.isFinite(now) || now < q.fetchedAt
  || now - q.fetchedAt > STALE_AFTER_MS;

/**
 * What a row's pre-market or after-hours price is, for its icon's one-line tooltip; null when the
 * row shows the regular quote. `quote` is the stored quote.
 */
export function extendedNote(quote) {
  const q = quote ?? {};
  const shown = shownQuote(q);
  const session = shown?.shownSession;
  if (session !== "pre" && session !== "post") return null;
  const price = (value) => formatPrice({ price: value, currency: q.currency ?? null });
  const at = clock(shown.timestamp, q.timeZone);
  const trade = `${session === "pre" ? "Pre-market" : "After-hours"} trade ${price(shown.price)} at ${at.text} ${at.zone}`;
  if (!positive(shown.previousClose) || !Number.isFinite(shown.changePercent)) return `${trade} · no previous close`;
  // From the next day's first pre-market trade, the reference is the latest session's own close.
  if (shown.previousClose === q.price) return `${trade} · ${formatChange(shown.changePercent)} vs the close ${price(q.price)}`;
  return `${trade} · ${formatChange(shown.changePercent)} vs prev close ${price(shown.previousClose)} · close ${price(q.price)} (${formatChange(q.changePercent)})`;
}

function clock(t, zone) {
  const z = zoneAt(t, zone);
  const d = new Date(t + z.offsetSeconds * 1000);
  return { text: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`, zone: z.label };
}

/** One short line: what the line covers and what it is measured against. */
export function sparkLabel(q, observed, reference, crypto, ownClose = false) {
  const price = (value) => formatPrice({ price: value, currency: q.currency ?? null });
  const against = reference === null ? "no reference"
    : crypto ? `vs ${price(reference)} 24h ago` : `vs ${ownClose ? "close" : "prev close"} ${price(reference)}`;
  if (!observed.length) return `No bars yet · ${against}`;
  if (crypto) return `Last 24h · ${against}`;
  const from = clock(observed[0].t, q.timeZone);
  const to = clock(observed.at(-1).t, q.timeZone);
  return `Regular ${from.text}–${to.text} ${to.zone} · ${against}`;
}
