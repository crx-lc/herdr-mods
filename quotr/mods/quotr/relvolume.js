// Relative volume for the Details dialog (issue #47): the day's volume against the average full day
// of the last month, from the 1M history the dialog has already loaded. No Herdr imports, so tests run
// it under Node. No request is ever made for it: without a loaded 1M period there is no figure.
//
// Full days only (the owner's condition). Completeness is proved by when the data was captured, never
// assumed because the clock has moved on: a quote or a month kept in memory stays what it was.
// - A stock: its latest regular session's volume (Yahoo's regularMarketVolume) counts only when the
//   quote was fetched after that session closed plus the exchange's delay. A quote fetched during the
//   session stays partial however late the dialog is drawn: no figure at all (never a partial one).
//   The average is over the 1M daily bars of the sessions before it, each counted only when the month
//   was fetched after that exchange day had ended (a bar fetched mid-session is a partial day).
// - A pair: a 24h market has no close, so a completed day is a UTC day whose last 4-hour kline had
//   closed when the month was fetched (all six klines present). Its numerator, Binance's rolling 24h
//   volume, is complete when its window spans the full 24 hours.
// Without the capture time needed to tell (a quote's fetchedAt, the month's fetchedAt), no figure.
// Anything that doesn't hold up gives no figure: a missing, zero or malformed volume (cleanVolume), a
// period whose volumes aren't trusted (history.js: a bar without one, or two answers for one bar), a
// day listed twice with different volumes, a month's bar for the quote's own day above that day's
// total, a currency that doesn't match, or fewer than MIN_DAYS full days to average.
import { cleanVolume, formatVolume, isCryptoPair } from "./quotes.js";
import { formatDay } from "./history.js";

const DAY = 86_400_000;
const KLINE_4H = 4 * 3_600_000;
/** Fewer full days than this and the average says too little. */
export const MIN_DAYS = 10;

/** "1.4× avg"; "12× avg" from 10 up; "<0.1× avg" below a tenth. */
export function formatRatio(ratio) {
  if (!(Number.isFinite(ratio) && ratio > 0)) return "";
  if (ratio < 0.1) return "<0.1× avg";
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× avg`;
}

/** Days → volume, or null when one day carries two different volumes. */
function byDay(entries) {
  const days = new Map();
  for (const [day, volume, t] of entries) {
    const seen = days.get(day);
    if (seen && seen.volume !== volume) return null;
    if (!seen) days.set(day, { volume, t });
  }
  return days;
}

/** Whether a stock quote's day volume is the whole session's: fetched after its close plus the delay. */
export function sessionComplete(quote) {
  const session = quote?.session;
  if (!Array.isArray(session) || !(session[0] > 0) || !(session[1] > session[0])) return false;
  const delay = Number.isFinite(quote.delaySeconds) && quote.delaySeconds > 0 ? quote.delaySeconds * 1000 : 0;
  return Number.isFinite(quote.fetchedAt) && quote.fetchedAt >= session[1] + delay;
}

function stock(quote, history, now, entryAt) {
  if (!history.daily || history.source !== "Yahoo Finance") return null;
  const session = quote.session;
  // Fetched before the session (and the exchange's delay) was over, the volume is partial for good:
  // no figure, however late this is drawn.
  if (!sessionComplete(quote)) return null;
  const offset = (Number.isFinite(history.utcOffsetSeconds) ? history.utcOffsetSeconds : 0) * 1000;
  const dayOf = (t) => Math.floor((t + offset) / DAY);
  const today = dayOf(session[0]);
  const days = byDay(history.bars.map((b) => [dayOf(b.t), b.volume, b.t]));
  if (!days) return null;
  // The month's own bar for the quote's day can't hold more than that day's total.
  const same = days.get(today);
  if (same && same.volume > quote.volume * 1.01) return null;
  // A day before the quote's, and over (its exchange date ended) when the month was fetched.
  const ended = (day) => (day + 1) * DAY - offset <= entryAt;
  const full = [...days.entries()].filter(([day]) => day < today && ended(day)).map(([, d]) => d);
  return { full, unit: "", what: (n) => `${n} full ${n === 1 ? "session" : "sessions"}`, numerator: (v) => `The ${formatDay(session[0], now)} session's volume, ${v}` };
}

function pair(quote, history, entryAt) {
  if (history.source !== "Binance Spot" || history.intervalMs !== KLINE_4H) return null;
  // Binance's 24h volume is in the quote currency, as the klines' [7]: they must name the same one.
  if (!quote.currency || history.volumeUnit !== quote.currency) return null;
  // The rolling window must span the whole 24 hours (Binance's openTime to closeTime).
  if (!(quote.windowStart > 0) || !(quote.timestamp - quote.windowStart >= DAY - 60_000)) return null;
  const groups = new Map();
  for (const b of history.bars) {
    const day = Math.floor(b.t / DAY);
    // Its noon names the day: a local date read from it is that UTC date anywhere within ±12 hours.
    const g = groups.get(day) ?? { start: day * DAY, t: day * DAY + DAY / 2, volume: 0, count: 0 };
    g.volume += b.volume;
    g.count++;
    groups.set(day, g);
  }
  // A full UTC day: all six 4-hour klines, the last one closed when the month was fetched.
  const full = [...groups.values()].filter((g) => g.count === DAY / KLINE_4H && g.start + DAY <= entryAt);
  return { full, unit: ` ${quote.currency}`, what: (n) => `${n} full UTC ${n === 1 ? "day" : "days"}`, numerator: (v) => `The last 24 hours' volume, ${v}` };
}

/**
 * The relative volume for `quote` from `entry` (HistoryStore.peek(symbol, "1M", now): `{ history,
 * fetchedAt }`), or null. `{ ratio, text: "1.4× avg", average, days, tip }`.
 */
export function relativeVolume(quote, entry, now) {
  const history = entry?.history;
  if (!quote || !history || history.range !== "1M" || history.symbol !== quote.symbol) return null;
  // Every bar of the month has its own trusted volume (history.js, as merged in #44).
  if (history.volumes !== true || !Array.isArray(history.bars) || !history.bars.length) return null;
  if (history.bars.some((b) => cleanVolume(b.volume) === null)) return null;
  const volume = cleanVolume(quote.volume);
  if (volume === null) return null;
  // When the month was fetched: what it says about which days were over. Unknown, no figure.
  const entryAt = entry.fetchedAt;
  if (!Number.isFinite(entryAt)) return null;
  const base = isCryptoPair(quote.symbol) ? pair({ ...quote, volume }, history, entryAt) : stock({ ...quote, volume }, history, now, entryAt);
  if (!base || base.full.length < MIN_DAYS) return null;
  const average = base.full.reduce((sum, d) => sum + d.volume, 0) / base.full.length;
  if (!(average > 0)) return null;
  const ratio = volume / average;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const first = Math.min(...base.full.map((d) => d.t));
  const last = Math.max(...base.full.map((d) => d.t));
  const span = `${formatDay(first, now)} – ${formatDay(last, now)}`;
  return {
    ratio,
    text: formatRatio(ratio),
    average,
    days: base.full.length,
    tip: `${base.numerator(`${formatVolume(volume)}${base.unit}`)}, is ${formatRatio(ratio).replace(" avg", "")} the average of `
      + `${base.what(base.full.length)} (${span}), ${formatVolume(average)}${base.unit}. From the 1M history.`,
  };
}
