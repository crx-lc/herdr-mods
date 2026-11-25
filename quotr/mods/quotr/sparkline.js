// Watchlist only: observed bars and headline day move use separate scales.
// No host imports, inferred opening price, synthetic points, or quote/bar splicing.
import { formatPrice, formatChange, isCryptoPair } from "./quotes.js";
import { formatPointTime } from "./readout.js";

export const SPARK_WIDTH = 56;
export const SPARK_HEIGHT = 22;
export const MOVE_LIMIT = 50; // percent; symmetric fixed scale, capped beyond either end
export const MIN_MOVE_PIXELS = 3; // visibility cue, not literal linear magnitude below this length
export const MIN_PRICE_SPAN = 0.01; // total vertical span: at least 1% of observed midpoint
const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const range = (r) => Array.isArray(r) && positive(r[0]) && positive(r[1]) && r[1] > r[0];

/** Pixel geometry. x uses the reported regular session / rolling 24h window;
 * y uses only observed closes with a price-relative minimum span. The lower rail uses the headline's reference.
 * An old cache without matching point times omits the line conservatively.
 */
export function watchlistSparkline(quote, now, { failed = false } = {}) {
  const q = quote ?? {};
  const crypto = isCryptoPair(q.symbol ?? "");
  const referenceName = crypto ? "rolling 24h reference" : "previous regular close";
  const calculated = positive(q.price) && positive(q.previousClose)
    ? (q.price - q.previousClose) / q.previousClose * 100 : null;
  const consistent = calculated !== null && Number.isFinite(calculated) && Number.isFinite(q.changePercent)
    && Math.abs(calculated - q.changePercent) < 0.000001;
  const move = consistent ? {
    percent: q.changePercent,
    from: 28,
    to: 28 + Math.sign(q.changePercent) * (q.changePercent === 0 ? 0
      : Math.max(MIN_MOVE_PIXELS, 26 * Math.min(1, Math.abs(q.changePercent) / MOVE_LIMIT))),
    capped: Math.abs(q.changePercent) > MOVE_LIMIT,
  } : null;
  const window = crypto
    ? (positive(q.timestamp) ? [q.timestamp - 86_400_000, q.timestamp] : null) : q.periods?.regular;
  const series = Array.isArray(q.series) ? q.series : [];
  const points = Array.isArray(q.points) ? q.points : [];
  // Validate the entire cache before clipping: no unpaired or corrupt survivors.
  const paired = points.length > 0 && points.length === series.length
    && Array.from(points).every((p, i) => positive(p?.t) && positive(p.close) && p.close === series[i]
      && (i === 0 || p.t > points[i - 1].t));
  const inWindow = (p) => p.t >= window[0] && p.t <= window[1];
  const observed = range(window) && paired
    ? (crypto ? points.filter(inWindow) : points.every(inWindow) ? points : []) : [];
  const usable = observed.length > 0;
  const closes = observed.map(p => p.close);
  const low = usable ? Math.min(...closes) : null;
  const high = usable ? Math.max(...closes) : null;
  const midpoint = usable ? low + (high - low) / 2 : null;
  // 1% floor keeps noise flat; 16% padding keeps real swings clear of stroke edges.
  // Only observed prices set this extent; never the daily reference or headline quote.
  const span = usable ? Math.max(midpoint * MIN_PRICE_SPAN, (high - low) * 1.16) : null;
  const line = observed.map(p => [
    2 + 52 * (p.t - window[0]) / (window[1] - window[0]),
    7.5 - 11 * (p.close - midpoint) / span,
  ]);
  const stale = failed || !positive(q.fetchedAt) || !Number.isFinite(now) || now < q.fetchedAt
    || now - q.fetchedAt > 180_000;
  const time = (t) => formatPointTime(t, q.timeZone, { now }) ?? "unknown";
  const price = (value) => formatPrice({ price: value, currency: q.currency ?? null });
  // One paragraph each, in this order; the card shows them wrapped, `description` joins them.
  const notes = [
    `Top: observed ${crypto ? "15-minute" : "regular-session 5-minute"} closes, independent vertical scale with minimum total span 1% of observed midpoint (16% padding for larger ranges).`,
    usable ? `${observed.length} bars, ${time(observed[0].t)} to ${time(observed.at(-1).t)}; observed range ${price(low)}–${price(high)}.`
      : "Bar times/session unavailable or inconsistent; line omitted.",
    "Blank time is unobserved; coverage may be partial; no opening-price inference.",
    move ? `Bottom: ${formatChange(move.percent)} vs ${referenceName} ${price(q.previousClose)}; zero at center, −50% to +50%; nonzero rail has a 3px visibility minimum, not linear magnitude below that length${move.capped ? ", capped" : ""}.`
      : `Bottom omitted: ${referenceName} unavailable or inconsistent with displayed change.`,
    `Quote: ${time(q.timestamp)}. ${stale ? "Stale or refresh failed." : "Fetched within 3 minutes; exchange delays may apply."}`,
    usable && observed.at(-1).t !== q.timestamp ? "Quote and last bar have different timestamps; bar freshness is independent; quote is not appended to bars." : "",
  ].filter(Boolean);
  return { line, move, stale, notes, description: notes.join(" ") };
}

// The card that explains the sparkline goes beside it, never over it: a card over its own trigger
// swallows the pointer, so it can't close on leave and the row's click never arrives.
export const SPARK_CARD_WIDTH = 320;
export const SPARK_CARD_MIN_WIDTH = 160; // narrower than this, the card goes under the row instead
export const SPARK_CARD_GAP = 6; // between the sparkline and the card
export const SPARK_CARD_MARGIN = 8; // between the card and the window's edge

/** Which side of the sparkline the card goes on, and how wide it is.
 * `trigger` is the sparkline's { left, width } in window pixels, `viewportWidth` the window's drawable width.
 * Left first (Quotr is usually docked right), then right, then the roomier side at a narrower width.
 * Unknown geometry or a window too narrow for either side: "below", the Popup's own placement.
 */
export function sparkCardPlacement(trigger, viewportWidth) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  if (!finite(viewportWidth) || viewportWidth <= 0 || !finite(trigger?.left) || !finite(trigger?.width)
    || trigger.width < 0) {
    return { side: "below", width: SPARK_CARD_WIDTH };
  }
  const room = {
    left: Math.floor(trigger.left - SPARK_CARD_GAP - SPARK_CARD_MARGIN),
    right: Math.floor(viewportWidth - trigger.left - trigger.width - SPARK_CARD_GAP - SPARK_CARD_MARGIN),
  };
  for (const side of ["left", "right"]) if (room[side] >= SPARK_CARD_WIDTH) return { side, width: SPARK_CARD_WIDTH };
  const side = room.left >= room.right ? "left" : "right";
  if (room[side] >= SPARK_CARD_MIN_WIDTH) return { side, width: room[side] };
  return { side: "below", width: Math.max(SPARK_CARD_MIN_WIDTH, Math.min(SPARK_CARD_WIDTH,
    Math.floor(viewportWidth - 2 * SPARK_CARD_MARGIN))) };
}
