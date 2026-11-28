// Relative volume for the Details dialog (issue #47): the day's volume against the average full day
// of the last month, from the 1M history the dialog has already loaded. No Herdr imports, so tests run
// it under Node. No request is ever made for it: without a loaded 1M period there is no figure.
//
// Full days only (the owner's condition):
// - A stock: its latest regular session's volume (Yahoo's regularMarketVolume), shown only once that
//   session has closed; while it trades there is no figure at all (a partial day is never compared).
//   The average is over the 1M daily bars of the sessions before it, each a whole session.
// - A pair: Binance's rolling 24h volume, always a whole 24 hours, against the average UTC day of the
//   1M 4-hour klines, counting only days with all six klines closed (never the current UTC day).
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

function stock(quote, history, now) {
  if (!history.daily || history.source !== "Yahoo Finance") return null;
  const session = quote.session;
  if (!Array.isArray(session) || !(session[0] > 0) || !(session[1] > session[0])) return null;
  // The session is still trading: its volume is partial, so there is no figure until it closes.
  if (now < session[1]) return null;
  const offset = (Number.isFinite(history.utcOffsetSeconds) ? history.utcOffsetSeconds : 0) * 1000;
  const dayOf = (t) => Math.floor((t + offset) / DAY);
  const today = dayOf(session[0]);
  const days = byDay(history.bars.map((b) => [dayOf(b.t), b.volume, b.t]));
  if (!days) return null;
  // The month's own bar for the quote's day can't hold more than that day's total.
  const same = days.get(today);
  if (same && same.volume > quote.volume * 1.01) return null;
  const full = [...days.entries()].filter(([day]) => day < today).map(([, d]) => d);
  return { full, unit: "", what: (n) => `${n} full ${n === 1 ? "session" : "sessions"}`, numerator: (v) => `The ${formatDay(session[0], now)} session's volume, ${v}` };
}

function pair(quote, history, entryAt) {
  if (history.source !== "Binance Spot" || history.intervalMs !== KLINE_4H) return null;
  // Binance's 24h volume is in the quote currency, as the klines' [7]: they must name the same one.
  if (!quote.currency || history.volumeUnit !== quote.currency) return null;
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
  const base = isCryptoPair(quote.symbol) ? pair({ ...quote, volume }, history, entry.fetchedAt ?? now) : stock({ ...quote, volume }, history, now);
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
