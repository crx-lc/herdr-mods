// The New York market clock: New York time, the US regular session's next open or close, and a
// countdown. No Herdr imports (time and data are passed in), so `node --test` runs it.
//
// Time zone: Herdr's QuickJS has no Intl and no time-zone database, so America/New_York is computed
// from the US daylight-saving rule in force since 2007 (second Sunday of March 02:00 to first Sunday
// of November 02:00): UTC-4 then, UTC-5 otherwise. No list of dates, nothing that expires.
//
// Calendar: no list is shipped either. Each day's schedule comes from Nasdaq's market-info endpoint
// (the one behind nasdaq.com's market status): whether today is a business day, today's pre-market,
// regular and after-hours times in ET (early closes included) and the next trading date. It is not
// a documented API, so its answer is checked strictly; anything unexpected, too old or already past
// gives "schedule unavailable", never a guessed countdown. The one assumption: the regular session
// opens at 09:30 ET (an early close moves the close, never the open).

export const MARKET_INFO_URL = "https://api.nasdaq.com/api/market-info";
export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const DAY = 24 * HOUR;
/** A schedule older than this is not trusted (the clock still runs). */
export const MAX_AGE_MS = 24 * HOUR;
/** Asked for again this often while the panel is open, and on every New York date change. */
export const REFRESH_MS = 3 * HOUR;
/** After a failed request: waits before the next try, the last one repeating. */
export const RETRY_MS = [30_000, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE];
export const REGULAR_OPEN = "09:30";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

/** Day of the month of the n-th Sunday of a month (month 0-based). */
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

/** New York's UTC offset in hours at an instant: -4 (EDT) or -5 (EST). */
export function nyOffsetHours(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 7); // 02:00 EST
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 6); // 02:00 EDT
  return utcMs >= start && utcMs < end ? -4 : -5;
}

/** New York's wall clock at an instant. */
export function nyParts(utcMs) {
  const offset = nyOffsetHours(utcMs);
  const d = new Date(utcMs + offset * HOUR);
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
  return {
    year, month, day, hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
    weekday: d.getUTCDay(), date: `${year}-${pad(month)}-${pad(day)}`, zone: offset === -4 ? "EDT" : "EST",
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** The instant of a New York date ("YYYY-MM-DD") and time ("HH:MM[:SS]"); null if malformed. */
export function nyToUtc(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time ?? "");
  if (!dm || !tm) return null;
  const wall = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], +(tm[3] ?? 0));
  const back = new Date(wall);
  if (back.getUTCMonth() !== +dm[2] - 1 || back.getUTCDate() !== +dm[3] || +tm[1] > 23 || +tm[2] > 59) return null;
  // EDT if that instant is in daylight time, else EST (the skipped 02:00 hour in March maps forward).
  return nyOffsetHours(wall + 4 * HOUR) === -4 ? wall + 4 * HOUR : wall + 5 * HOUR;
}

const addDays = (date, n) => {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** "Nov 18, 2026" → "2026-11-18"; null if it isn't one. */
export function parseUsDate(text) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(String(text ?? "").trim());
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  if (month < 0) return null;
  const date = `${m[3]}-${pad(month + 1)}-${pad(+m[2])}`;
  return nyToUtc(date, "12:00") == null ? null : date;
}

/** "2026-11-17T09:30:00" → { date, time }; null otherwise. */
function rawEt(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/.exec(typeof value === "string" ? value : "");
  return m && nyToUtc(m[1], m[2]) != null ? { date: m[1], time: m[2], at: nyToUtc(m[1], m[2]) } : null;
}

/**
 * A checked schedule from Nasdaq's market-info answer, fetched at `fetchedAt`; null when the answer
 * isn't what this expects. { fetchedAt, date, business, pre, open, close, post, next, overnight }:
 * instants in ms; `date` the New York day it describes; `next` the next trading date.
 */
export function parseMarketInfo(json, fetchedAt) {
  const d = json?.data;
  if (!d || typeof d !== "object" || typeof d.isBusinessDay !== "boolean") return null;
  if (json.status && json.status.rCode != null && json.status.rCode !== 200) return null;
  const today = nyParts(fetchedAt).date;
  const next = parseUsDate(d.nextTradeDate);
  // Nasdaq lists times for overnight sessions in these fields; when it does, "closed" can't be claimed.
  const overnight = [d.preMidOpeningTime, d.preMidClosingTime, d.postMidOpeningTime, d.postMidClosingTime].some((v) => v != null && v !== "");
  let schedule = { fetchedAt, date: today, business: false, pre: null, open: null, close: null, post: null, next, overnight };
  if (d.isBusinessDay) {
    const open = rawEt(d.openRaw), close = rawEt(d.closeRaw), pre = rawEt(d.pmOpenRaw), post = rawEt(d.ahCloseRaw);
    if (!open || !close || open.date !== close.date) return null;
    // Sanity: an open between 09:00 and 11:00, a close after noon and by 16:00, at least an hour apart.
    if (open.time < "09:00" || open.time > "11:00" || close.time < "12:00" || close.time > "16:00:00" || close.at - open.at < HOUR) return null;
    // The day described is the session's own: today, or the last one (an answer from before 04:00).
    if (open.date > today || open.date < addDays(today, -4)) return null;
    schedule = {
      ...schedule, date: open.date, business: true, open: open.at, close: close.at,
      pre: pre && pre.date === open.date && pre.at < open.at ? pre.at : null,
      post: post && post.date === open.date && post.at > close.at ? post.at : null,
    };
  }
  // The next trading date: after the day described, within ten days (the longest closures are shorter).
  if (!next || next <= schedule.date || next > addDays(schedule.date, 10)) return null;
  return schedule;
}

/** "42s", "18m", "3h 05m", "2d 4h". */
export function formatCountdown(ms) {
  if (!(ms > 0)) return "now";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.max(1, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${pad(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** An event's New York time, with its day when it isn't today: "16:00", "Mon 09:30", "Nov 30 09:30". */
export function formatEventTime(at, now) {
  const e = nyParts(at), n = nyParts(now);
  if (e.date === n.date) return e.time;
  const days = Math.round((nyToUtc(e.date, "12:00") - nyToUtc(n.date, "12:00")) / DAY);
  return days > 0 && days < 7 ? `${WEEKDAYS[e.weekday]} ${e.time}` : `${MONTHS[e.month - 1]} ${e.day} ${e.time}`;
}

/**
 * What the clock shows at `now`:
 * { ny, available, reason?, phase, label, event?: { kind: "open"|"close", at, early } }.
 * phase: "regular" (regular session on), "pre" / "post" (pre-market / after-hours, per Nasdaq's
 * hours for that day), "closed" (no session at all, per the schedule: weekend, holiday, overnight),
 * "regular-closed" (the regular session is closed; extended hours not known for this time), or
 * "unavailable" (no schedule, a stale one, or one that is used up: the clock alone).
 */
export function marketClock(schedule, now, { maxAgeMs = MAX_AGE_MS, loading = false } = {}) {
  const ny = nyParts(now);
  const none = (reason) => ({ ny, available: false, reason, phase: "unavailable", label: loading && reason === "missing" ? "Loading schedule…" : "Market schedule unavailable" });
  if (!schedule) return none("missing");
  if (now - schedule.fetchedAt > maxAgeMs || schedule.fetchedAt - now > 5 * MINUTE) return none("stale");
  const nextOpen = nyToUtc(schedule.next, REGULAR_OPEN);
  const sameDay = ny.date === schedule.date;
  const closedLabel = () => {
    if (schedule.overnight) return ["regular-closed", "Regular closed"];
    if (!sameDay) return ["regular-closed", "Regular closed"];
    if (!schedule.business) return ["closed", ny.weekday === 0 || ny.weekday === 6 ? "Weekend" : "Holiday"];
    return ["closed", "Closed"];
  };
  const open = (at) => ({ kind: "open", at, early: false });
  if (schedule.business && now < schedule.open) {
    const [phase, label] = sameDay && schedule.pre != null && now >= schedule.pre ? ["pre", "Pre-market"] : closedLabel();
    return { ny, available: true, phase, label, event: open(schedule.open) };
  }
  if (schedule.business && now < schedule.close) {
    const early = nyParts(schedule.close).time < "16:00";
    return { ny, available: true, phase: "regular", label: "Open", event: { kind: "close", at: schedule.close, early } };
  }
  if (nextOpen == null || now >= nextOpen) return none("used");
  if (schedule.business && schedule.post != null && now < schedule.post) {
    return { ny, available: true, phase: "post", label: "After-hours", event: open(nextOpen) };
  }
  const [phase, label] = closedLabel();
  return { ny, available: true, phase, label, event: open(nextOpen) };
}

/**
 * The line's parts: left "NY 15:42", phase "Open", event "Closes 16:00", countdown "18m", and right,
 * the last two joined ("Closes 16:00 · 18m"); no event or countdown when the schedule is unavailable.
 */
export function clockText(state, now) {
  const left = `NY ${state.ny.time}`;
  if (!state.available) return { left, phase: state.label, event: "", countdown: "", right: "" };
  const e = state.event;
  const verb = e.kind === "close" ? (e.early ? "Early close" : "Closes") : "Opens";
  const event = `${verb} ${formatEventTime(e.at, now)}`;
  const countdown = formatCountdown(e.at - now);
  return { left, phase: state.label, event, countdown, right: `${event} · ${countdown}` };
}

/** Milliseconds until the line next changes: the next second while seconds show, else the next minute. */
export function nextTickMs(state, now) {
  const toMinute = MINUTE - (now % MINUTE) + 20;
  const left = state.event ? state.event.at - now : Infinity;
  return left > 0 && left <= MINUTE + 1000 ? 1000 - (now % 1000) + 20 : toMinute;
}

/**
 * Whether to ask Nasdaq now: no schedule, one from another New York day, one older than REFRESH_MS
 * or used up; never sooner than the retry wait after a failure.
 */
export function shouldFetch({ schedule, now, failures = 0, lastAttempt = 0, inflight = false }) {
  if (inflight) return false;
  if (failures > 0 && now - lastAttempt < RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]) return false;
  if (!schedule) return true;
  if (nyParts(now).date !== nyParts(schedule.fetchedAt).date) return true;
  if (now - schedule.fetchedAt >= REFRESH_MS) return true;
  return marketClock(schedule, now).reason === "used";
}

/** A stored schedule back from JSON, or null if it isn't one. */
export function restoreSchedule(value) {
  const s = value && typeof value === "object" ? value : null;
  const num = (v) => v === null || Number.isFinite(v);
  if (!s || !Number.isFinite(s.fetchedAt) || typeof s.business !== "boolean" || typeof s.date !== "string" || typeof s.next !== "string") return null;
  if (![s.pre, s.open, s.close, s.post].every(num)) return null;
  if (s.business && !(Number.isFinite(s.open) && Number.isFinite(s.close))) return null;
  return { fetchedAt: s.fetchedAt, date: s.date, business: s.business, pre: s.pre, open: s.open, close: s.close, post: s.post, next: s.next, overnight: Boolean(s.overnight) };
}

