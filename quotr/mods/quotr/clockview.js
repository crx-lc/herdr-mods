// The New York market clock line (marketclock.js has the logic). A retained nested view: it redraws
// itself on its own timer, once a minute (every second in the last minute before an open or close),
// without redrawing the panel or touching the quote refresh. Nasdaq's schedule is asked for at most
// once per New York day plus every 3 hours (one request at a time across copies, backing off after
// failures) and kept in localStorage, so reloads and restarts show the clock at once, even offline.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, settings, theme } from "herdr";
import { MARKET_INFO_URL, clockText, formatCountdown, nextTickMs } from "./marketclock.js";
import { REQUEST_TIMEOUT_MS, ScheduleFeed, USER_AGENT, curlArgs, readCurl } from "./marketfeed.js";
import { designWidth, layoutClock } from "./widths.js";

const STORE_KEY = "quotr.market.v1";
const HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };
// The current frame's context, for the deadline timer (GPUI timers, so a hung request can't hold it).
let timerCx = null;
// Shared by every clock in this mod (the panel's and the band's): one schedule, one request.
// Loading, fallback and retry rules live in marketfeed.js; this is only Herdr's side of them.
const MARKET = new ScheduleFeed({
  now: () => Date.now(),
  viaFetch: async () => {
    const r = await fetch(MARKET_INFO_URL, { headers: HEADERS });
    return { status: r.status, text: await r.text() };
  },
  // The same GET through curl, run directly (no shell).
  viaCurl: async () => readCurl(await exec("curl", curlArgs(), { timeout: REQUEST_TIMEOUT_MS })),
  deadline: (promise, ms) => new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    timerCx.timer.after(ms, () => finish(null));
    promise.then(finish, () => finish(null));
  }),
  load: () => localStorage.getItem(STORE_KEY),
  save: (text) => localStorage.setItem(STORE_KEY, text),
});

export class MarketClock extends View {
  init(props, cx) {
    this.band = Boolean(props?.band);
    // The line's own width (zoom 1), from its first layout on: a narrow panel shortens the line.
    this.width = null;
    MARKET.restore();
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        timerCx = cx;
        if (MARKET.due()) MARKET.refresh().then(() => cx.notify());
        cx.notify();
        const now = Date.now();
        await cx.sleep(nextTickMs(MARKET.state(now), now));
      }
    });
  }

  update(props) { this.band = Boolean(props?.band); }

  render() {
    const t = theme();
    const now = Date.now();
    const state = MARKET.state(now, { loading: !checking() && MARKET.loading(now) });
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
    // Today's line while it fits; then without the date (the tooltip keeps it); then on two lines
    // (widths.js). The event's time shortens first, as before; the countdown always shows.
    const fit = layoutClock(this.width, { time: state.ny.time, day: text.day, phase: text.phase, countdown: text.countdown });
    const measure = (el) => el.on_size_change((size, cx) => {
      const width = designWidth(size, settings()?.zoom);
      if (width !== this.width) { this.width = width; cx.notify(); }
    });
    const time = h_flex().flex_none().gap(4).items_center()
      .child(div().font_semibold().text_color(t.foreground).child("NY"))
      .when(fit.day, (el) => el.child(div().text_color(t.muted).child(text.day)))
      .child(div().font_semibold().text_color(t.foreground).child(state.ny.time));
    const event = (el) => el.when(Boolean(text.right), (el) => el
      .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.muted).child(`${text.event} ·`))
      .child(div().flex_none().text_color(t.foreground).child(text.countdown)));
    if (fit.wrap) {
      return measure(v_flex().id("quotr-clock").w_full().min_w(0).gap(2).text_size(11.5).whitespace_nowrap().tooltip(`${text.day} · ${tip}`))
        .child(h_flex().min_w(0).items_center().gap(6).child(time)
          .child(div().flex_1().min_w(0).truncate().text_color(color).child(text.phase)))
        .when(Boolean(text.right), (el) => el.child(event(h_flex().min_w(0).items_center().gap(6))));
    }
    // "NY Tue Nov 17 14:16": New York's own date, which can differ from the local one.
    return event(measure(h_flex().id("quotr-clock").w_full().min_w(0).items_center().gap(6).text_size(11.5).whitespace_nowrap()
      .tooltip(fit.day ? tip : `${text.day} · ${tip}`))
      .child(time)
      .child(div().flex_none().text_color(color).child(text.phase)));
  }
}
