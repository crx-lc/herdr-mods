// The New York market clock line (marketclock.js has the logic). A retained nested view: it redraws
// itself on its own timer, once a minute (every second in the last minute before an open or close),
// without redrawing the panel or touching the quote refresh. Nasdaq's schedule is asked for at most
// once per New York day plus every 3 hours (one request at a time across copies, backing off after
// failures) and kept in localStorage, so reloads and restarts show the clock at once, even offline.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, exec, theme } from "herdr";
import {
  MARKET_INFO_URL, clockText, formatCountdown, marketClock, nextTickMs, parseMarketInfo, restoreSchedule, shouldFetch,
} from "./marketclock.js";

const STORE_KEY = "quotr.market.v1";
const HEADERS = { "User-Agent": "Herdr-Quotr/1.0", Accept: "application/json" };
const UA = HEADERS["User-Agent"];
const REQUEST_TIMEOUT_MS = 15_000;
// However a request ends (or doesn't), "loading" never lasts longer than this.
const BUSY_LIMIT_MS = 45_000;
// Shared by every clock in this mod (the panel's and the band's): one schedule, one request.
const MARKET = { schedule: null, failures: 0, lastAttempt: 0, inflight: false, loaded: false, lastError: "", startedAt: Date.now() };
const busy = (now) => MARKET.inflight && now - MARKET.lastAttempt < BUSY_LIMIT_MS;

function loadSchedule() {
  if (MARKET.loaded) return;
  MARKET.loaded = true;
  try {
    const text = localStorage.getItem(STORE_KEY);
    MARKET.schedule = text ? restoreSchedule(JSON.parse(text)) : null;
  } catch { MARKET.schedule = null; }
}

/** `promise`'s value, or null once `ms` pass (a GPUI timer, so a hung request can't hold it). */
function withDeadline(cx, promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    cx.timer.after(ms, () => finish(null));
    promise.then(finish, () => finish(null));
  });
}

/** Herdr's fetch. → { status, text } or null. */
async function viaFetch() {
  const r = await fetch(MARKET_INFO_URL, { headers: HEADERS });
  return { status: r.status, text: await r.text() };
}

/** The same GET through curl, run directly (no shell), https only, with its own time limit. */
async function viaCurl() {
  const r = await exec("curl", ["-sS", "--proto", "=https", "--max-time", "12", "-A", UA, "-H", "Accept: application/json",
    "-w", "\n%{http_code}", MARKET_INFO_URL], { timeout: REQUEST_TIMEOUT_MS });
  const out = String(r?.stdout ?? "");
  const cut = out.lastIndexOf("\n");
  return r?.code === 0 && cut > 0 ? { status: Number(out.slice(cut + 1)), text: out.slice(0, cut) } : null;
}

/** A checked schedule from one answer, or a short reason it isn't one. */
function readAnswer(response) {
  if (!response) return { error: "no answer" };
  if (response.status !== 200) return { error: `HTTP ${response.status}` };
  let json;
  try { json = JSON.parse(response.text); } catch { return { error: "unreadable answer" }; }
  const schedule = parseMarketInfo(json, Date.now());
  return schedule ? { schedule } : { error: "unexpected answer" };
}

/** One try for today's schedule: Herdr's fetch, then curl. A failure keeps the last good schedule. */
async function fetchSchedule(cx) {
  MARKET.inflight = true;
  MARKET.lastAttempt = Date.now();
  try {
    let result = readAnswer(await withDeadline(cx, viaFetch(), REQUEST_TIMEOUT_MS));
    if (!result.schedule) {
      const second = readAnswer(await withDeadline(cx, viaCurl(), REQUEST_TIMEOUT_MS + 2_000));
      if (second.schedule) result = second;
      else result = { error: `${result.error}; curl: ${second.error}` };
    }
    if (!result.schedule) throw new Error(result.error);
    MARKET.schedule = result.schedule;
    MARKET.failures = 0;
    MARKET.lastError = "";
    try { localStorage.setItem(STORE_KEY, JSON.stringify(result.schedule)); } catch { /* kept in memory */ }
  } catch (error) {
    MARKET.failures += 1;
    MARKET.lastError = String(error?.message ?? error);
  } finally {
    MARKET.inflight = false;
  }
}

export class MarketClock extends View {
  init(props, cx) {
    this.band = Boolean(props?.band);
    loadSchedule();
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        if (shouldFetch({ ...MARKET, inflight: busy(Date.now()), now: Date.now() })) fetchSchedule(cx).then(() => cx.notify(), () => cx.notify());
        cx.notify();
        const now = Date.now();
        await cx.sleep(nextTickMs(marketClock(MARKET.schedule, now), now));
      }
    });
  }

  update(props) { this.band = Boolean(props?.band); }

  render() {
    const t = theme();
    const now = Date.now();
    const loading = !checking() && (busy(now) || (MARKET.lastAttempt === 0 && now - MARKET.startedAt < BUSY_LIMIT_MS));
    const state = marketClock(MARKET.schedule, now, { loading });
    const text = clockText(state, now);
    const color = state.phase === "regular" ? t.done : state.phase === "pre" || state.phase === "post" ? t.working : t.dim;
    const tip = state.available
      ? `New York (${state.ny.zone}). US regular session ${state.phase === "regular" ? "open" : "closed"}; schedule from Nasdaq.`
      : `New York time. The market schedule couldn't be loaded or is out of date, so no countdown is shown.${MARKET.lastError ? ` Last try: ${MARKET.lastError}.` : ""}`;
    if (this.band) {
      const short = state.available ? `${state.event.kind === "close" ? "closes" : "opens"} ${formatCountdown(state.event.at - now)}` : "";
      return h_flex().id("quotr-clock").flex_none().gap(5).items_center().whitespace_nowrap().tooltip(tip)
        .child(div().font_semibold().child(text.left))
        .child(div().text_color(color).child(state.available ? text.phase : "schedule unavailable"))
        .when(Boolean(short), (el) => el.child(div().text_color(t.dim).child(short)));
    }
    return h_flex().id("quotr-clock").w_full().min_w(0).items_center().gap(6).text_size(11.5).whitespace_nowrap().tooltip(tip)
      .child(div().flex_none().font_semibold().text_color(t.foreground).child(text.left))
      .child(div().flex_none().text_color(color).child(text.phase))
      // When the panel is narrow, the event's time gives way first; the countdown always shows.
      .when(Boolean(text.right), (el) => el
        .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.muted).child(`${text.event} ·`))
        .child(div().flex_none().text_color(t.foreground).child(text.countdown)));
  }
}
