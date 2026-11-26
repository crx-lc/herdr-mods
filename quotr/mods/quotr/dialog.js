// The detail dialog a row opens: ranges and their history requests, pre-market and after-hours, the
// period stats, and the dialog itself. Methods of the Quotr view (main.js joins them to its class),
// so `this` is the view; a dialog is a copy of the mod whose props carry the quote.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay } from "herdr";
import {
  SESSION_LABELS, formatBandPrice, formatChange, formatPrice, formatStaleDate, formatTime, isCryptoPair,
  marketSession, cleanVolume, formatVolume,
} from "./quotes.js";
import { HistoryStore, RANGES, RANGE_SPECS, formatDay, sourceName } from "./history.js";
import { UTC_ZONE, formatPointTime } from "./readout.js";
import { SESSION_NAMES, sessionBands } from "./extended.js";
import { HEADERS, HISTORY } from "./context.js";

export class DialogParts {
  // The dialog's range selector and its history requests.
  selectRange(range, cx) {
    if (range === this.range) return;
    this.range = range;
    if (range !== "1D") this.loadRange(range, cx);
    cx.notify();
  }

  // Fetches only the open ticker's selected range; a fresh cached period needs no request.
  loadRange(range, cx) {
    const symbol = this.detail.symbol;
    const key = HistoryStore.key(symbol, range);
    if (this.pending.has(key) || HISTORY.peek(symbol, range, Date.now())?.fresh) return;
    this.pending.add(key);
    cx.spawn(async (cx) => {
      try {
        await HISTORY.load(symbol, range, {
          fetch: async (url) => {
            const response = await fetch(url, { headers: HEADERS });
            return { status: response.status, ok: response.ok, text: await response.text() };
          },
          now: () => Date.now(),
          sleep: (ms) => cx.sleep(ms),
          yahooRetryAt: this.detail.yahooRetryAt ?? 0,
        });
        delete this.historyErrors[key];
      } catch (cause) {
        this.historyErrors[key] = cause instanceof Error ? cause.message : `Could not reach ${sourceName(symbol)}.`;
      } finally {
        this.pending.delete(key);
        cx.notify();
      }
      // A stock's 1W: its day volumes come after the line is shown, never holding it up. A failure,
      // a timeout or a refused answer just leaves the period without volume.
      if (range === "1W" && !isCryptoPair(symbol) && !this.historyErrors[key]) {
        try {
          await HISTORY.loadDayVolumes(symbol, range, {
            fetch: async (url) => {
              const response = await fetch(url, { headers: HEADERS });
              return { status: response.status, ok: response.ok, text: await response.text() };
            },
            now: () => Date.now(),
            sleep: (ms) => cx.sleep(ms),
            yahooRetryAt: this.detail.yahooRetryAt ?? 0,
            // GPUI's timer, so a hung request can't hold it (cx.sleep would wait on the same task).
            deadline: (promise, ms) => new Promise((resolve) => {
              let done = false;
              const finish = (value) => { if (!done) { done = true; resolve(value); } };
              cx.timer.after(ms, () => finish(null));
              promise.then(finish, () => finish(null));
            }),
          });
          cx.notify();
        } catch { /* no volume for this period */ }
      }
    });
  }

  // One extended-hours request for the open stock (cached a minute,
  // through the same Yahoo cooldown and spacing). A failure leaves the regular session as is.
  loadExtended(cx) {
    const symbol = this.detail.symbol;
    if (this.extPending || HISTORY.peekExtended(symbol, Date.now())?.fresh) return;
    this.extPending = true;
    cx.spawn(async (cx) => {
      try {
        await HISTORY.loadExtended(symbol, {
          fetch: async (url) => {
            const response = await fetch(url, { headers: HEADERS });
            return { status: response.status, ok: response.ok, text: await response.text() };
          },
          now: () => Date.now(),
          sleep: (ms) => cx.sleep(ms),
          yahooRetryAt: this.detail.yahooRetryAt ?? 0,
        });
        this.extError = null;
      } catch (cause) {
        this.extError = cause instanceof Error ? cause.message : "Could not reach Yahoo Finance.";
      } finally {
        this.extPending = false;
        cx.notify();
      }
    });
  }

  // The latest pre-market / after-hours price, its time and its change against the regular
  // close, or why there is none. Never shown as the regular price, never called real time.
  extendedParts(q, t, now) {
    if (isCryptoPair(q.symbol)) return [];
    const note = (text, color = t.dim) => div().text_size(11).text_color(color).child(text);
    if (q.hasPrePost === false) return [note("Yahoo provides no pre-market or after-hours data for this market.")];
    if (q.hasPrePost !== true) return [];
    const entry = HISTORY.peekExtended(q.symbol, now);
    const ext = entry?.data;
    if (!ext) {
      if (this.extPending || !this.extError) return [note("Checking pre-market and after hours…", t.dim)];
      return [note(`Pre-market / after hours unavailable: ${this.extError} Regular session shown.`, t.blocked)];
    }
    const fetched = this.extError
      ? [note(`Extended hours fetched ${formatTime(entry.fetchedAt)}; refresh failed: ${this.extError}`, t.blocked)] : [];
    if (ext.status === "not-applicable") return [note("Yahoo provides no pre-market or after-hours data for this market."), ...fetched];
    if (ext.status === "regular-open") return fetched;
    if (ext.status === "none" || !ext.latest) {
      const close = ext.regular.t ? formatPointTime(ext.regular.t, ext.timeZone, { now }) : "the regular close";
      return [note(`No pre-market or after-hours trades since the regular close (${close}).`), ...fetched];
    }
    const L = ext.latest;
    const when = formatPointTime(L.t, ext.timeZone, { now });
    const notes = [];
    if (L.stale) notes.push(note(`No newer trades reported since ${when} (${Math.round(L.ageMs / 60_000)} min).`, t.working));
    if (!L.open) notes.push(note(`${SESSION_NAMES[L.session]} has ended; this is its last reported trade.`));
    if (ext.inconsistency) {
      notes.push(note(`Yahoo's extended-hours price (${formatPrice({ price: ext.inconsistency.fulldayPrice, currency: q.currency })}) `
        + "differs from its latest bar; the bar is shown.", t.blocked));
    }
    if (ext.delaySeconds) notes.push(note(`Delay ${Math.ceil(ext.delaySeconds / 60)}m`));
    return [
      h_flex().gap(8).items_center().flex_wrap()
        .child(div().flex_none().px(6).h(18).flex().items_center().rounded(4).border_1()
          .border_color(L.session === "pre" ? t.ansi4 : t.ansi5).text_size(10.5)
          .text_color(L.session === "pre" ? t.ansi4 : t.ansi5).child(SESSION_NAMES[L.session]))
        .child(div().text_size(14).font_semibold().child(formatPrice({ price: L.price, currency: q.currency })))
        .child(div().text_size(12).font_semibold().text_color(this.changeColor(t, L.changePercent)).child(formatChange(L.changePercent)))
        .child(div().text_size(11).text_color(t.dim).child(`vs regular close · ${when}`)),
      ...notes,
      ...fetched,
    ];
  }

  rangeTabs(t) {
    return h_flex().gap(2).items_center().children(RANGES.map((range) => {
      const on = range === this.range;
      return div().id(`quotr-range-${range}`).h(22).px(9).flex().items_center().rounded(5).text_size(11)
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
        .when(!on, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => this.selectRange(range, cx))
        .child(range);
    }));
  }

  // The 140px chart area for 1W / 1M / 1Y, plus its labeled stats and status lines.
  periodParts(q, t, stat) {
    const range = this.range;
    const now = Date.now();
    const key = HistoryStore.key(q.symbol, range);
    const entry = HISTORY.peek(q.symbol, range, now);
    const loading = this.pending.has(key);
    const error = this.historyErrors[key];
    const box = (text, color, pulse) => div().h(140).flex().items_center().justify_center().px(16).text_center()
      .text_size(11.5).text_color(color).when(Boolean(pulse), (el) => el.loop("opacity", { from: 0.4, to: 1, period: 1200 }))
      .child(text);
    const name = RANGE_SPECS[range].name;

    if (!entry) {
      if (loading || !error) return [box(`Loading ${name} from ${sourceName(q.symbol)}…`, t.dim, true)];
      return [box(error, t.blocked)];
    }
    const s = entry.summary;
    const h = entry.history;
    const notes = [];
    if (loading) notes.push(div().text_size(11).text_color(t.working).child("Updating…"));
    if (error) {
      notes.push(div().text_size(11).text_color(t.blocked)
        .child(`Cached ${name} · fetched ${formatDay(entry.fetchedAt, now)} ${formatTime(entry.fetchedAt)} · ${error}`));
    } else if (!entry.fresh && !loading) {
      notes.push(div().text_size(11).text_color(t.dim)
        .child(`Fetched ${formatDay(entry.fetchedAt, now)} ${formatTime(entry.fetchedAt)}`));
    }
    if (s.empty) return [box(`${h.source} returned no ${name} data for ${q.symbol}.`, t.dim), ...notes];

    const color = this.changeColor(t, s.change);
    const since = formatDay(s.firstAt, now);
    // A partial period is labeled by what it covers, never as the full range.
    const changeLabel = s.startsLate ? `Change since ${since}` : `${range} change`;
    const span = `${since} – ${formatDay(s.lastAt, now)}`;
    const coverage = [span,
      s.sessions !== null ? `${s.sessions} ${s.sessions === 1 ? "session" : "sessions"}` : "trades 24h",
      h.interval, h.source].join(" · ");
    const partial = [
      s.startsLate ? `${h.source} data starts ${since}` : "",
      s.endsEarly ? `latest bar is ${formatDay(s.lastAt, now)} ${formatTime(s.lastAt)}` : "",
    ].filter(Boolean).join("; ");

    // Volume, only when every bar has its own (history.js): bars under the chart, the period total.
    const volumeUnit = h.volumeUnit ?? null;
    const showVolume = Boolean(h.volumes) && s.volume !== null && s.points > 1;
    return [
      s.points > 1
        ? this.chart({ series: h.bars.map((b) => b.close), previousClose: s.first }, color, t, {
          width: "full", height: 140, fill: true,
          hover: { id: `quotr-chart-${range}`, points: h.bars, zone: h.timeZone ?? UTC_ZONE, daily: Boolean(h.daily), currency: q.currency,
            volumes: showVolume, volumeUnit, byDay: Boolean(h.volumesByDay) },
        })
        : box(`Only one ${name} data point from ${h.source}; no line to draw.`, t.dim),
      ...(showVolume ? [this.volumeStrip(h.bars, `quotr-chart-${range}`, t, { byDay: Boolean(h.volumesByDay) })] : []),
      h_flex().gap(12)
        .child(v_flex().flex_1().gap(2)
          .child(div().text_size(10.5).text_color(t.dim).child(changeLabel))
          .child(div().font_semibold().text_color(color).child(formatChange(s.change))))
        .child(stat(s.startsLate ? "High shown" : `${range} high`, s.high))
        .child(stat(s.startsLate ? "Low shown" : `${range} low`, s.low))
        .when(showVolume, (el) => el.child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(10.5).text_color(t.dim).truncate().child(s.startsLate ? "Volume shown" : `${range} volume`))
          .child(div().font_semibold().truncate().child(`${formatVolume(s.volume)}${volumeUnit ? ` ${volumeUnit}` : ""}`)))),
      div().text_size(11).text_color(t.dim).child(coverage),
      ...(partial ? [div().text_size(11).text_color(t.blocked).child(`Partial period: ${partial}.`)] : []),
      ...notes,
    ];
  }

  // The dialog a row opens: the day's chart, its range and the session.
  detailView(t) {
    const q = this.detail;
    const now = Date.now();
    const color = this.changeColor(t, q.changePercent);
    const session = marketSession(q, now);
    const sessionColor = session === "open" || session === "24h" ? t.ansi2 : session === "closed" ? t.dim : t.working;
    const value = (price) => (price ? formatBandPrice({ ...q, price }) : "—");
    const stale = formatStaleDate(q.timestamp, now);
    const crypto = isCryptoPair(q.symbol);
    const day = this.range === "1D";
    // Extended hours (stocks where Yahoo has them).
    const ext = crypto ? null : HISTORY.peekExtended(q.symbol, now)?.data ?? null;
    const extLine = ext?.hasPrePost && ext.points.length > 1 ? ext.points : null;
    const extShown = ext?.status === "ok" && Boolean(ext.latest);
    // Outside 1D the line below the stats describes the period, so this one names the quote.
    const asOf = [`${day ? "As of" : "Quote as of"} ${stale ? `${stale} ` : ""}${formatTime(q.timestamp)}`,
      q.delaySeconds ? `Delay ${Math.ceil(q.delaySeconds / 60)}m` : "",
      crypto ? "Binance Spot · 24h" : "Yahoo Finance · regular session"].filter(Boolean).join(" · ");
    const stat = (label, price) => v_flex().flex_1().gap(2)
      .child(div().text_size(10.5).text_color(t.dim).child(label))
      .child(div().font_semibold().child(value(price)));
    // Volume, a fifth column only when it is known: stocks in shares, pairs in their quote currency.
    const volume = cleanVolume(q.volume);
    const volumeStat = (label) => v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(10.5).text_color(t.dim).truncate().child(label))
      .child(div().font_semibold().truncate().child(crypto ? `${formatVolume(volume)} ${q.currency ?? ""}`.trim() : formatVolume(volume)));

    return v_flex().id("quotr-detail").w_full().p(18).gap(14).text_color(t.foreground).text_size(12.5)
      .child(h_flex().items_center().gap(10)
        .child(this.assetIcon(q.symbol, 49, t))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(16).font_semibold().truncate().child(q.symbol))
          .child(div().text_size(11.5).text_color(t.dim).truncate().child(q.name)))
        .child(h_flex().flex_none().gap(6).items_center().px(8).h(22).rounded(11).border_1().border_color(t.border)
          .child(div().w(6).h(6).rounded_full().bg(sessionColor))
          .child(div().text_size(11).text_color(sessionColor).child(SESSION_LABELS[session])))
        .child(div().id("quotr-detail-close").flex_none().w(18).text_right().text_size(14).text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click(() => closeOverlay(this.overlay)).child("×")))
      // The current quote and its own change, labeled, whatever range is selected.
      .child(h_flex().gap(10).items_end()
        .child(div().text_size(26).font_semibold().child(formatPrice(q)))
        .child(div().pb(4).text_size(13).font_semibold().text_color(color).child(formatChange(q.changePercent)))
        .child(div().pb(5).text_size(11).text_color(t.dim)
          .child(crypto ? "24h change" : extShown ? "regular session · day change vs prev close" : "day change vs prev close")))
      .children(this.extendedParts(q, t, now))
      .child(this.rangeTabs(t))
      .children(day
        ? [
          // With each point's own time, the line is drawn from those
          // points so the readout names exactly what is drawn. Without times (an older quote,
          // or a source that gave none), the line is drawn as before, with no readout.
          // With extended hours, the line runs from the latest regular
          // session's pre-market through its after hours (and the next pre-market), each bar in
          // its own session, shaded; the regular-only line stays the fallback.
          ...(extLine
            ? [this.chart({ series: extLine.map((p) => p.close), previousClose: q.previousClose }, color, t, {
              width: "full", height: 140, fill: true, bands: sessionBands(extLine),
              hover: { id: "quotr-chart-1D", points: extLine, zone: ext.timeZone ?? UTC_ZONE, daily: false, currency: q.currency },
            }), this.sessionLegend(ext, t)]
            : q.points?.length > 1
            ? [this.chart({ series: q.points.map((p) => p.close), previousClose: q.previousClose }, color, t, {
              width: "full", height: 140, fill: true,
              hover: { id: "quotr-chart-1D", points: q.points, zone: q.timeZone ?? UTC_ZONE, daily: false, currency: q.currency },
            })]
            : q.series?.length > 1
              ? [this.chart(q, color, t, { width: "full", height: 140, fill: true }),
                div().text_size(11).text_color(t.dim).child("Point times unavailable for this line; hover readout off.")]
              : [div().h(60).flex().items_center().justify_center().text_color(t.dim).child("No intraday line yet.")]),
          crypto
            ? h_flex().gap(12).child(stat("24h open", q.open)).child(stat("24h high", q.high)).child(stat("24h low", q.low))
              .when(volume !== null, (el) => el.child(volumeStat("24h volume")))
            : h_flex().gap(12).child(stat("Open", q.open)).child(stat("High", q.high)).child(stat("Low", q.low))
              .child(stat("Prev close", q.previousClose))
              .when(volume !== null, (el) => el.child(volumeStat("Volume"))),
        ]
        : this.periodParts(q, t, stat))
      .child(div().text_size(11).text_color(t.dim).child(asOf))
      // The "Pulse for Mac" card is removed from the dialog.
      .when(Boolean(q.error), (el) => el.child(div().text_size(11).text_color(t.blocked).child(`Cached quote · ${q.error}`)))
      // "Logo by … ↗ · Source: Auto · …": the credit and the per-ticker choice together.
      .children(this.logoChoice(q.symbol, t));
  }
}
