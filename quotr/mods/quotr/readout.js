// Local customization (not part of upstream Pulse): the hover readout of the detail
// dialog's chart. No Herdr imports (and none of quotes.js, which imports this), so
// `node --test` runs it.
//
// Times are the sources' own: Yahoo bar timestamps (bar start, UTC seconds) shown on the
// exchange's clock, using the offset Yahoo reports for that trading day; Binance kline
// open times (UTC milliseconds) shown in UTC, Binance's own day boundary. Nothing here
// derives a time from a position or interpolates a price.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_POINTS = 400;

const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const label = (value) => (typeof value === "string" && /^[A-Za-z][A-Za-z0-9+\-]{0,9}$/.test(value) ? value : null);

export const UTC_ZONE = Object.freeze({ label: "UTC", offsetSeconds: 0, periods: [] });

/**
 * `times` in UTC seconds, `closes` beside them: the pairs where both are valid, oldest
 * first, one per time, the most recent MAX_POINTS. A close without a valid time (or the
 * reverse) is skipped, never matched to a neighbour.
 */
export function timedPoints(times, closes, max = MAX_POINTS) {
  if (!Array.isArray(times) || !Array.isArray(closes)) return [];
  const points = [];
  const n = Math.min(times.length, closes.length);
  for (let i = 0; i < n; i++) {
    if (positive(times[i]) && positive(closes[i])) points.push({ t: times[i] * 1000, close: closes[i] });
  }
  points.sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of points) if (!out.length || out[out.length - 1].t !== p.t) out.push(p);
  return out.length > max ? out.slice(out.length - max) : out;
}

/**
 * The exchange clock from a Yahoo chart `meta`: its abbreviation and offset, plus each
 * trading day's own offset from `tradingPeriods` (intraday responses), which is what keeps
 * times right across a daylight-saving change. Without a usable offset: UTC.
 */
export function yahooTimeZone(meta) {
  const periods = [];
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && positive(value.start) && positive(value.end) && value.end > value.start && finite(value.gmtoffset)) {
      periods.push({
        start: value.start * 1000,
        end: value.end * 1000,
        offsetSeconds: value.gmtoffset,
        label: label(value.timezone) ?? offsetLabel(value.gmtoffset),
      });
      return;
    }
    // With extended hours Yahoo groups the days by session: { pre, regular, post }.
    if (value && typeof value === "object") for (const key of ["pre", "regular", "post"]) if (key in value) walk(value[key]);
  };
  walk(meta?.tradingPeriods);
  periods.sort((a, b) => a.start - b.start);
  if (!finite(meta?.gmtoffset)) return { ...UTC_ZONE, periods };
  return { label: label(meta.timezone) ?? offsetLabel(meta.gmtoffset), offsetSeconds: meta.gmtoffset, periods };
}

/** "UTC+8", "UTC-3:30" for an offset with no abbreviation. */
export function offsetLabel(offsetSeconds) {
  if (!finite(offsetSeconds) || offsetSeconds === 0) return "UTC";
  const sign = offsetSeconds < 0 ? "-" : "+";
  const minutes = Math.round(Math.abs(offsetSeconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/**
 * The clock for one bar: the trading day that contains it, else the response's own offset
 * when no trading day disagrees with it, else UTC (always correct, just less local).
 */
export function zoneAt(t, zone) {
  const z = zone ?? UTC_ZONE;
  const periods = Array.isArray(z.periods) ? z.periods : [];
  for (const p of periods) if (t >= p.start && t <= p.end) return { label: p.label, offsetSeconds: p.offsetSeconds };
  if (periods.every((p) => p.offsetSeconds === z.offsetSeconds)) return { label: z.label, offsetSeconds: z.offsetSeconds };
  return { label: UTC_ZONE.label, offsetSeconds: 0 };
}

/**
 * The drawn point nearest the pointer. The line spaces points evenly by index (no gaps for
 * nights or weekends), so the nearest drawn point is the nearest index. -1 when there is
 * nothing to pick.
 */
export function nearestIndex(x, width, count) {
  if (!Number.isInteger(count) || count < 1 || !finite(x) || !(width > 0)) return -1;
  if (count === 1) return 0;
  const ratio = Math.min(1, Math.max(0, x / width));
  return Math.round(ratio * (count - 1));
}

/**
 * A point's time as the source means it.
 * Daily bars: the trading date on that clock ("Fri, Nov 14 · trading day"; Binance:
 * "Fri, Nov 14 · UTC day"). Intraday: date, time and zone ("Fri, Nov 14, 09:30 EST").
 * The year is added when it is not the current one.
 */
export function formatPointTime(t, zone, { daily = false, now = Date.now() } = {}) {
  if (!positive(t)) return null;
  const z = daily ? { label: zone?.label ?? "UTC", offsetSeconds: finite(zone?.offsetSeconds) ? zone.offsetSeconds : 0 } : zoneAt(t, zone);
  const d = new Date(t + z.offsetSeconds * 1000);
  const current = new Date(now + z.offsetSeconds * 1000).getUTCFullYear();
  const date = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    + (d.getUTCFullYear() === current ? "" : `, ${d.getUTCFullYear()}`);
  if (daily) return `${date} · ${z.label === "UTC" && z.offsetSeconds === 0 ? "UTC day" : "trading day"}`;
  return `${date}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${z.label}`;
}

/** What the readout shows for the point at `index`, or null when there is no valid point there. */
export function readoutAt(points, index, zone, { daily = false, now = Date.now() } = {}) {
  if (!Array.isArray(points) || !Number.isInteger(index) || index < 0 || index >= points.length) return null;
  const p = points[index];
  if (!p || !positive(p.t) || !positive(p.close)) return null;
  const when = formatPointTime(p.t, zone, { daily, now });
  return when ? { when, price: p.close, t: p.t } : null;
}
