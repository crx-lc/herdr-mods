// Loading the market schedule for the clock: one request at a time, Herdr's fetch first and curl
// second, each against a deadline, and a last good schedule kept through failures. No Herdr imports
// (fetch, curl, the timer and storage are passed in as a host), so `node --test` runs it.
import { MARKET_INFO_URL, marketClock, parseMarketInfo, restoreSchedule, shouldFetch } from "./marketclock.js";

export const USER_AGENT = "Herdr-Quotr/1.0";
export const REQUEST_TIMEOUT_MS = 15_000;
/** However a request ends (or doesn't), "loading" never shows longer than this. */
export const BUSY_LIMIT_MS = 45_000;

/** curl's arguments for the schedule: https only, its own time limit, the status code on a last line. */
export function curlArgs(url = MARKET_INFO_URL) {
  return ["-sS", "--proto", "=https", "--max-time", "12", "-A", USER_AGENT, "-H", "Accept: application/json", "-w", "\n%{http_code}", url];
}

/** { status, text } from that curl run's result ({ code, stdout }), or null when it failed. */
export function readCurl(result) {
  const out = String(result?.stdout ?? "");
  const cut = out.lastIndexOf("\n");
  if (result?.code !== 0 || cut <= 0) return null;
  const status = Number(out.slice(cut + 1));
  return Number.isInteger(status) && status > 0 ? { status, text: out.slice(0, cut) } : null;
}

/** A checked schedule from one answer ({ status, text }), or a short reason it isn't one. */
export function readAnswer(response, now) {
  if (!response) return { error: "no answer" };
  if (response.status !== 200) return { error: `HTTP ${response.status}` };
  let json;
  try { json = JSON.parse(response.text); } catch { return { error: "unreadable answer" }; }
  const schedule = parseMarketInfo(json, now);
  return schedule ? { schedule } : { error: "unexpected answer" };
}

/**
 * The schedule and how it is kept current. host:
 *   now() → ms
 *   viaFetch() → Promise<{ status, text }>           Herdr's fetch
 *   viaCurl() → Promise<{ status, text } | null>     the same GET through curl
 *   deadline(promise, ms) → Promise<value | null>    null once ms pass, however the promise ends
 *   load() → stored text | null,  save(text)         localStorage
 */
export class ScheduleFeed {
  constructor(host) {
    this.host = host;
    this.schedule = null;
    this.failures = 0;
    this.lastAttempt = 0;
    this.inflight = false;
    this.lastError = "";
    this.loaded = false;
    this.startedAt = host.now();
  }

  /** The stored schedule, read once; junk is ignored. */
  restore() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = this.host.load();
      this.schedule = text ? restoreSchedule(JSON.parse(text)) : null;
    } catch { this.schedule = null; }
  }

  /** A request is out and hasn't overstayed. */
  busy(now = this.host.now()) {
    return this.inflight && now - this.lastAttempt < BUSY_LIMIT_MS;
  }

  /** Whether "Loading schedule…" may show: a request out, or none made yet shortly after start. */
  loading(now = this.host.now()) {
    return this.busy(now) || (this.lastAttempt === 0 && now - this.startedAt < BUSY_LIMIT_MS);
  }

  /** Whether to ask now (marketclock.js's rules; a request that overstayed doesn't block the next). */
  due(now = this.host.now()) {
    return shouldFetch({ schedule: this.schedule, now, failures: this.failures, lastAttempt: this.lastAttempt, inflight: this.busy(now) });
  }

  /** What the clock shows now. */
  state(now = this.host.now(), { loading = this.loading(now) } = {}) {
    return marketClock(this.schedule, now, { loading });
  }

  /** One source's answer against the deadline; a throw or a timeout is "no answer". */
  async ask(source, ms) {
    let request;
    try { request = Promise.resolve(source()); } catch { return { error: "no answer" }; }
    return readAnswer(await this.host.deadline(request.catch(() => null), ms), this.host.now());
  }

  /**
   * One try: fetch, then curl. Resolves true when a new schedule is in place; never rejects. A
   * failure keeps the last good schedule, counts toward the retry wait and records why.
   */
  async refresh() {
    const started = this.host.now();
    this.inflight = true;
    this.lastAttempt = started;
    let result = { error: "no answer" };
    try {
      result = await this.ask(() => this.host.viaFetch(), REQUEST_TIMEOUT_MS);
      if (!result.schedule) {
        const second = await this.ask(() => this.host.viaCurl(), REQUEST_TIMEOUT_MS + 2_000);
        result = second.schedule ? second : { error: `${result.error}; curl: ${second.error}` };
      }
    } catch (error) {
      result = { error: String(error?.message ?? error) };
    }
    // A newer try has started since (this one overstayed): its outcome stands, not this one's.
    if (this.lastAttempt !== started) return false;
    this.inflight = false;
    if (!result.schedule) {
      this.failures += 1;
      this.lastError = result.error;
      return false;
    }
    this.schedule = result.schedule;
    this.failures = 0;
    this.lastError = "";
    try { this.host.save(JSON.stringify(result.schedule)); } catch { /* kept in memory */ }
    return true;
  }
}
