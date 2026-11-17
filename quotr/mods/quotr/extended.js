// Pre-market and after-hours for stocks,
// from Yahoo's chart endpoint with includePrePost=true. No Herdr imports, so `node --test`
// runs it.
//
// What Yahoo actually provides (checked against live responses, Nov 2026):
// - `meta.hasPrePostMarketData`: false for markets Yahoo has no extended data for (HK, LSE,
//   Tokyo, indices); those get no request and no extended label.
// - `meta.tradingPeriods` as { pre, regular, post }, one period per trading day, each with
//   its own timezone and offset: sessions come from these, never from hard-coded hours.
// - No extended-hours quote field with a time: `regularMarketPrice` stays the regular
//   session's price. `meta.fulldayPrice` is Yahoo's latest price including extended hours,
//   but carries no timestamp, so the extended price shown is the latest bar inside a pre or
//   post period (its own time and close), and fulldayPrice is only a consistency check.
// - `range=1d` with extended hours returns only the current day, which before the open drops
//   the latest regular session; `range=2d` keeps it.
import { QuoteError, YAHOO_CHART, normalizeSymbol } from "./quotes.js";
import { UTC_ZONE, offsetLabel, yahooTimeZone } from "./readout.js";

export const SESSION_NAMES = { pre: "Pre-market", regular: "Regular", post: "After hours" };
export const STALE_AFTER_MS = 15 * 60_000;
// Bars and fulldayPrice agreeing within 0.5% is consistent (a 5-minute bar closes on its last trade).
export const CONSISTENT_WITHIN = 0.005;

const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Today's 5-minute bars and the previous trading day, extended hours included. */
export function extendedUrl(symbol) {
  return YAHOO_CHART + encodeURIComponent(normalizeSymbol(symbol)) + "?interval=5m&range=2d&includePrePost=true";
}

/**
 * Yahoo's sessions, in ms: { pre: [...], regular: [...], post: [...] }, each period
 * { start, end, offsetSeconds, label }, oldest first. The array shape (no extended data)
 * is all regular.
 */
export function sessionPeriods(meta) {
  const out = { pre: [], regular: [], post: [] };
  const take = (list, into) => {
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && positive(v.start) && positive(v.end) && v.end > v.start) {
        into.push({
          start: v.start * 1000,
          end: v.end * 1000,
          offsetSeconds: finite(v.gmtoffset) ? v.gmtoffset : 0,
          label: typeof v.timezone === "string" && /^[A-Za-z][A-Za-z0-9+\-]{0,9}$/.test(v.timezone) ? v.timezone : offsetLabel(v.gmtoffset),
        });
      }
    };
    walk(list);
    into.sort((a, b) => a.start - b.start);
  };
  const tp = meta?.tradingPeriods;
  if (Array.isArray(tp)) take(tp, out.regular);
  else if (tp && typeof tp === "object") { take(tp.pre, out.pre); take(tp.regular, out.regular); take(tp.post, out.post); }
  return out;
}

/**
 * The session a bar belongs to. Regular includes both ends (Yahoo's closing print sits on the
 * regular end); pre-market ends where regular starts; after hours starts at the regular end.
 * null for a bar outside every period (dropped, never guessed).
 */
export function sessionAt(t, periods) {
  if (periods.regular.some((p) => t >= p.start && t <= p.end)) return "regular";
  if (periods.pre.some((p) => t >= p.start && t < p.end)) return "pre";
  if (periods.post.some((p) => t >= p.start && t <= p.end)) return "post";
  return null;
}

const containing = (list, t) => list.find((p) => t >= p.start && t <= p.end) ?? null;

/** `response` is `{ status, ok, text }` with the body read; `now` in ms. Throws QuoteError for people. */
export function decodeExtended(symbol, response, now) {
  if (response.status === 429) throw new QuoteError("Yahoo rate limited requests.", { retryAfterMs: 60_000 });
  if (response.status === 404) throw new QuoteError("Ticker not found on Yahoo Finance.");
  if (!response.ok) throw new QuoteError(`Yahoo returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Yahoo returned an unreadable response."); }
  const result = body?.chart?.result?.[0];
  const meta = result?.meta;
  if (body?.chart?.error || !meta) throw new QuoteError("Yahoo returned no extended-hours data for this ticker.");
  let returned = null;
  try { returned = typeof meta.symbol === "string" ? normalizeSymbol(meta.symbol) : null; } catch { /* below */ }
  if (returned !== symbol) throw new QuoteError("Yahoo returned a different ticker.");

  const periods = sessionPeriods(meta);
  const timeZone = yahooTimeZone(meta);
  const hasPrePost = meta.hasPrePostMarketData === true && (periods.pre.length > 0 || periods.post.length > 0);
  const regularPrice = positive(meta.regularMarketPrice) ? meta.regularMarketPrice : null;
  const regularTime = positive(meta.regularMarketTime) ? meta.regularMarketTime * 1000 : null;
  const base = {
    symbol,
    hasPrePost,
    timeZone,
    periods,
    delaySeconds: finite(meta.exchangeDataDelayedBy) && meta.exchangeDataDelayedBy >= 0 ? meta.exchangeDataDelayedBy : null,
    regular: { price: regularPrice, t: regularTime },
    fetchedAt: now,
  };
  if (!hasPrePost) return { ...base, status: "not-applicable", points: [], latest: null, inconsistency: null };
  if (!regularPrice || !regularTime) throw new QuoteError("Yahoo returned no regular-session close to compare with.");

  // Every bar with its own time, close and session; anything else is skipped.
  const times = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const bars = [];
  times.forEach((s, i) => {
    const close = closes[i];
    if (!positive(s) || !positive(close)) return;
    const t = s * 1000;
    const session = sessionAt(t, periods);
    if (session) bars.push({ t, close, session });
  });
  bars.sort((a, b) => a.t - b.t);

  // The 1D chart: the latest regular session's trading day from its pre-market on, plus any
  // later extended bars (the next morning's pre-market).
  const latestRegular = [...periods.regular].reverse().find((p) => p.start <= regularTime) ?? periods.regular.at(-1) ?? null;
  const dayPre = latestRegular ? periods.pre.find((p) => p.end <= latestRegular.start && latestRegular.start - p.end < 3_600_000) : null;
  const windowStart = dayPre?.start ?? latestRegular?.start ?? (bars[0]?.t ?? now);
  const points = bars.filter((b) => b.t >= windowStart);

  const regularOpen = periods.regular.some((p) => now >= p.start && now < p.end);
  const closed = latestRegular ? now >= latestRegular.end && regularTime >= latestRegular.start : false;
  if (regularOpen || !closed) return { ...base, status: "regular-open", points, latest: null, inconsistency: null, windowStart };

  const after = bars.filter((b) => b.session !== "regular" && b.t > regularTime);
  if (!after.length) return { ...base, status: "none", points, latest: null, inconsistency: null, windowStart };
  const last = after[after.length - 1];
  const period = containing(last.session === "pre" ? periods.pre : periods.post, last.t);
  const open = Boolean(period) && now >= period.start && now < period.end;
  const ageMs = Math.max(0, now - last.t);
  const latest = {
    session: last.session,
    price: last.close,
    t: last.t,
    change: last.close - regularPrice,
    changePercent: (last.close - regularPrice) / regularPrice * 100,
    referencePrice: regularPrice,
    referenceTime: regularTime,
    open,
    ageMs,
    stale: open && ageMs > STALE_AFTER_MS,
  };
  const full = positive(meta.fulldayPrice) ? meta.fulldayPrice : null;
  const inconsistency = full !== null && Math.abs(full - last.close) / last.close > CONSISTENT_WITHIN
    ? { fulldayPrice: full, barPrice: last.close } : null;
  return { ...base, status: "ok", points, latest, inconsistency, windowStart };
}

/**
 * Runs of non-regular points as chart bands, in % of the width: each band spans from halfway
 * before its first point to halfway after its last, so it meets the regular line between them.
 */
export function sessionBands(points) {
  const n = points.length;
  if (n < 2) return [];
  const bands = [];
  let i = 0;
  while (i < n) {
    const s = points[i].session;
    let j = i;
    while (j + 1 < n && points[j + 1].session === s) j++;
    if (s === "pre" || s === "post") {
      bands.push({ session: s, from: Math.max(0, (i - 0.5) / (n - 1) * 100), to: Math.min(100, (j + 0.5) / (n - 1) * 100) });
    }
    i = j + 1;
  }
  return bands;
}

/** The schedule of one session on the exchange clock, e.g. "04:00–09:30 EST", from Yahoo's period. */
export function sessionHours(period) {
  if (!period) return null;
  const at = (t) => { const d = new Date(t + period.offsetSeconds * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
  return `${at(period.start)}–${at(period.end)} ${period.label}`;
}

export { UTC_ZONE };
