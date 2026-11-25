// The watchlist row's chart: a small version of the dialog's 1D chart. No Herdr imports.
//
// One rule ties it to the row's numbers: the line, its color and the dashed reference all come
// from the same quote as the price and percentage beside it. The reference is what the
// percentage is measured against (a stock's previous regular close, a pair's price 24 hours
// ago); the line is drawn against it, in the percentage's color. Only observed prices are
// drawn, each at its own time: bar closes, the first bar's open and the quote itself. Gaps in
// the data stay blank; nothing is interpolated or inferred.
import { formatPrice, isCryptoPair, shownQuote, GAP_MS } from "./quotes.js";
import { zoneAt, formatPointTime } from "./readout.js";

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

/** Index runs of consecutive points with no hole between them: [[0, 1, 2], [3, 4]]. */
export function splitRuns(count, isGap) {
  const runs = [];
  for (let i = 0; i < count; i++) {
    if (i === 0 || isGap(i)) runs.push([i]); else runs.at(-1).push(i);
  }
  return runs;
}

/** The reference, only when the displayed percentage really is measured against it. */
export function sparkReference(quote) {
  const q = quote ?? {};
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
 * A stock's trail (quotes.js, yahooTrail): the last regular close when known, then every trade
 * after it, ending on the price the row shows. null when the quote has none.
 */
export function trailPrices(quote) {
  const q = shownQuote(quote ?? {});
  const tr = q?.trail;
  if (!tr || q === quote || !Array.isArray(tr.points)) return null;
  const points = tr.points.filter((p) => positive(p?.t) && positive(p?.close));
  if (!points.length) return null;
  // A trail cached before the end point was part of it: the regular quote ends the line.
  if (tr.session === "regular" && tr.t >= points.at(-1).t) {
    const end = { ...points.at(-1), t: tr.t, close: tr.price, session: "regular" };
    if (points.at(-1).t === tr.t && points.at(-1).session !== "close") points[points.length - 1] = end;
    else if (tr.t > points.at(-1).t) points.push({ t: tr.t, close: tr.price, session: "regular" });
  }
  return points;
}

/**
 * Pre-market and after-hours runs as [{ session, from, to }] in pixels, each widened by `half`
 * pixels either side, as the dialog shades them.
 */
export function trailBands(points, xs, half) {
  const bands = [];
  for (let i = 0; i < points.length;) {
    let j = i;
    while (j + 1 < points.length && points[j + 1].session === points[i].session) j++;
    if (points[i].session === "pre" || points[i].session === "post") {
      bands.push({ session: points[i].session, from: Math.max(SPARK_LEFT, xs[i] - half), to: Math.min(SPARK_RIGHT, xs[j] + half) });
    }
    i = j + 1;
  }
  return points.length > 1 ? bands : [];
}

/**
 * The 56×22 geometry, in pixels: `line` [[x, y]], `runs` (`line` split where data is missing),
 * `reference` (y or null), `bands`, `stale`,
 * `label` (the one-line hover) and `description` (for screen readers).
 * `quote` is the stored quote; the row's own numbers come from shownQuote(quote).
 */
export function watchlistSparkline(quote, now, { failed = false } = {}) {
  const trail = trailPrices(quote);
  if (trail) return trailSparkline(shownQuote(quote), trail, now, failed);
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
    runs = splitRuns(line.length, (i) => observed[i].t - observed[i - 1].t > GAP_MS).map((r) => r.map((i) => line[i]));
    referenceY = reference !== null ? y(reference) : null;
  } else if (reference !== null) {
    referenceY = (SPARK_TOP + SPARK_BOTTOM) / 2;
  }
  const label = sparkLabel(q, observed, reference, crypto);
  return { line, runs, reference: referenceY, bands: [], stale: isStale(q, now, failed), label, description: `Chart: ${label}` };
}

const isStale = (q, now, failed) => failed || !positive(q.fetchedAt) || !Number.isFinite(now) || now < q.fetchedAt
  || now - q.fetchedAt > STALE_AFTER_MS;

/**
 * Spaced by trading time when every point has its slot (closed hours take no room, missing bars
 * keep theirs and break the line); by bar for a trail cached without slots.
 */
function trailSparkline(q, points, now, failed) {
  const reference = positive(q.previousClose) ? q.previousClose : null;
  const y = scale(reference === null ? points.map((p) => p.close) : [...points.map((p) => p.close), reference], reference);
  const n = points.length;
  const last = points.at(-1).slot;
  const slotted = points.every((p) => Number.isFinite(p.slot)) && last > 0;
  const span = SPARK_RIGHT - SPARK_LEFT;
  const xs = points.map((p, i) => slotted ? SPARK_LEFT + span * p.slot / last : n > 1 ? SPARK_LEFT + span * i / (n - 1) : SPARK_RIGHT);
  const line = points.map((p, i) => [xs[i], y(p.close)]);
  const runs = splitRuns(n, (i) => slotted && points[i].gap === true).map((r) => r.map((i) => line[i]));
  const half = slotted ? span * STOCK_BAR_MS / 2 / last : n > 1 ? span / 2 / (n - 1) : 0;
  const price = (value) => formatPrice({ price: value, currency: q.currency ?? null });
  const when = (t) => formatPointTime(t, q.timeZone, { now }) ?? "the last session";
  const closeAt = q.trail?.closeAt;
  const label = reference !== null && positive(closeAt) ? `Since the close of ${price(reference)} · ${when(closeAt)}`
    : `Since ${when(points[0].t)} · ${reference !== null ? `vs prev close ${price(reference)}` : "no reference"}`;
  return { line, runs, reference: reference === null ? null : y(reference), bands: trailBands(points, xs, half),
    stale: isStale(q, now, failed), label, description: `Chart: ${label}` };
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
