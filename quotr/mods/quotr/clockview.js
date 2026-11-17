// The New York market clock line (marketclock.js has the logic). A retained nested view: it redraws
// itself on its own timer, once a minute (every second in the last minute before an open or close),
// without redrawing the panel or touching the quote refresh. Nasdaq's schedule is asked for at most
// once per New York day plus every 3 hours (one request at a time across copies, backing off after
// failures) and kept in localStorage, so reloads and restarts show the clock at once, even offline.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, theme } from "herdr";
import {
  MARKET_INFO_URL, clockText, formatCountdown, marketClock, nextTickMs, parseMarketInfo, restoreSchedule, shouldFetch,
} from "./marketclock.js";

const STORE_KEY = "quotr.market.v1";
const HEADERS = { "User-Agent": "Herdr-Quotr/1.0", Accept: "application/json" };
const REQUEST_TIMEOUT_MS = 20_000;
// Shared by every clock in this mod (the panel's and the band's): one schedule, one request.
const MARKET = { schedule: null, failures: 0, lastAttempt: 0, inflight: false, loaded: false };

function loadSchedule() {
  if (MARKET.loaded) return;
  MARKET.loaded = true;
  try {
    const text = localStorage.getItem(STORE_KEY);
    MARKET.schedule = text ? restoreSchedule(JSON.parse(text)) : null;
  } catch { MARKET.schedule = null; }
}

/** One request for today's schedule. A failed or unexpected answer keeps the last good schedule. */
async function fetchSchedule(cx) {
  MARKET.inflight = true;
  MARKET.lastAttempt = Date.now();
  try {
    const request = fetch(MARKET_INFO_URL, { headers: HEADERS }).then(async (r) => ({ ok: r.ok, text: await r.text() }));
    const timeout = cx.sleep(REQUEST_TIMEOUT_MS).then(() => null);
    const response = await Promise.race([request, timeout]);
    if (!response || !response.ok) throw new Error("no answer");
    const schedule = parseMarketInfo(JSON.parse(response.text), Date.now());
    if (!schedule) throw new Error("unexpected answer");
    MARKET.schedule = schedule;
    MARKET.failures = 0;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(schedule)); } catch { /* kept in memory */ }
  } catch {
    MARKET.failures += 1;
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
        if (shouldFetch({ ...MARKET, now: Date.now() })) fetchSchedule(cx).then(() => cx.notify(), () => {});
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
    const loading = !checking() && (MARKET.inflight || (MARKET.lastAttempt === 0 && MARKET.failures === 0));
    const state = marketClock(MARKET.schedule, now, { loading });
    const text = clockText(state, now);
    const color = state.phase === "regular" ? t.done : state.phase === "pre" || state.phase === "post" ? t.working : t.dim;
    const tip = state.available
      ? `New York (${state.ny.zone}). US regular session ${state.phase === "regular" ? "open" : "closed"}; schedule from Nasdaq.`
      : "New York time. The market schedule couldn't be loaded or is out of date, so no countdown is shown.";
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
