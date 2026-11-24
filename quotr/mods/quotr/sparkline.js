// Watchlist only: observed bars and headline day move use separate scales.
// No host imports, inferred opening price, synthetic points, or quote/bar splicing.
import { chartGeometry, formatChange, isCryptoPair } from "./quotes.js";
import { formatPointTime } from "./readout.js";

export const SPARK_WIDTH = 56;
export const SPARK_HEIGHT = 22;
export const MOVE_LIMIT = 50; // percent; symmetric fixed scale, capped beyond either end
const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const range = (r) => Array.isArray(r) && positive(r[0]) && positive(r[1]) && r[1] > r[0];

/** Pixel geometry. x uses the reported regular session / rolling 24h window;
 * y uses only observed closes. The lower rail uses the headline's reference.
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
    to: 28 + 26 * Math.max(-1, Math.min(1, q.changePercent / MOVE_LIMIT)),
    capped: Math.abs(q.changePercent) > MOVE_LIMIT,
  } : null;
  const window = crypto && positive(q.timestamp)
    ? [q.timestamp - 86_400_000, q.timestamp] : q.periods?.regular;
  const series = Array.isArray(q.series) ? q.series : [];
  const points = Array.isArray(q.points) ? q.points : [];
  // Fail closed on a corrupt, unpaired, unordered, or out-of-session cached line.
  const usable = range(window) && points.length > 0 && points.length === series.length
    && points.every((p, i) => positive(p?.t) && positive(p.close) && p.close === series[i]
      && p.t >= window[0] && p.t <= window[1] && (i === 0 || p.t > points[i - 1].t));
  const shape = usable ? chartGeometry(series, null) : null;
  const line = usable ? points.map((p, i) => [
    2 + 52 * (p.t - window[0]) / (window[1] - window[0]),
    shape ? 1 + shape.points[i][1] * 0.13 : 7.5,
  ]) : [];
  const stale = failed || !positive(q.fetchedAt) || !Number.isFinite(now) || now < q.fetchedAt
    || now - q.fetchedAt > 180_000;
  const time = (t) => formatPointTime(t, q.timeZone, { now }) ?? "unknown";
  const description = [
    `Top: observed ${crypto ? "15-minute" : "regular-session 5-minute"} closes, independent vertical scale.`,
    usable ? `${points.length} bars, ${time(points[0].t)} to ${time(points.at(-1).t)}; range ${Math.min(...series)}–${Math.max(...series)}.`
      : "Bar times/session unavailable or inconsistent; line omitted.",
    "Blank time is unobserved; coverage may be partial; no opening-price inference.",
    move ? `Bottom: ${formatChange(move.percent)} vs ${referenceName} ${q.previousClose}; zero at center, −50% to +50%${move.capped ? ", capped" : ""}.`
      : `Bottom omitted: ${referenceName} unavailable or inconsistent with displayed change.`,
    `Quote: ${time(q.timestamp)}. ${stale ? "Stale or refresh failed." : "Fetched within 3 minutes; exchange delays may apply."}`,
    usable && points.at(-1).t !== q.timestamp ? "Quote and last bar have different timestamps; bar freshness is independent; quote is not appended to bars." : "",
  ].filter(Boolean).join(" ");
  return { line, move, stale, description };
}
