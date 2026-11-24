// Herdr Quotr: stock and crypto quotes beside your agents (based on Pulse by fatwang2, MIT; see
// README.md and LICENSE-PULSE.txt). A watchlist panel with an
// add field and a line per ticker; docked as a short strip (top or bottom), it
// draws one line of quotes. A row opens the ticker's day as a dialog: the same
// mod, given the quote in its props.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { nextCommand, openOverlay, props, setShared, shared, theme, checking } from "herdr";
import { Watchlist, INTERVAL_MS } from "./watchlist.js";
import { formatBandPrice, formatChange, formatPrice, formatStaleDate, isCryptoPair } from "./quotes.js";
import { createTickMemory, primeTicks, takeTicks } from "./ticks.js";
import { MarketClock } from "./clockview.js";
import {
  STORE, RENAMED_KEYS, HEADERS, BAND_HEIGHT, LOGO, brand, stamp, loadSnapshot, saveSnapshot, LOGOS,
} from "./context.js";
import { ChartParts } from "./charts.js";
import { LogoParts } from "./logoview.js";
import { DialogParts } from "./dialog.js";

export default class Quotr extends View {
  init(_props, cx) {
    const given = props() ?? {};
    if (given.detail) {
      this.detail = given.detail;
      this.overlay = given.overlay;
      // The dialog opens on 1D, the quote's own day, as before.
      this.range = "1D";
      this.hover = null;
      this.pending = new Set();
      this.historyErrors = {};
      // Extended hours, asked for only where Yahoo says it has them.
      this.extPending = false;
      this.extError = null;
      if (!isCryptoPair(this.detail.symbol) && this.detail.hasPrePost === true) this.loadExtended(cx);
      return;
    }
    this.size = null;
    // The market clock, one for each layout (an entity mounts once per render).
    this.clockPanel = cx.new(MarketClock, { band: false });
    this.clockBand = cx.new(MarketClock, { band: true });
    this.reordering = false;
    this.typed = "";
    this.notice = "";
    this.error = "";
    this.inputFocused = false;
    this.input = InputState.new({ placeholder: "Add a ticker: AAPL, 0700.HK, BTC/USDT" });
    this.input.on("change", () => { this.typed = this.input.value(); });
    this.input.on("submit", (_e, cx) => this.add(cx));
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });

    // Quotr: the watchlist and logo choices saved under the Pulse names, copied over once.
    if (!checking()) {
      for (const [now, before] of RENAMED_KEYS) {
        if (shared(now) == null && shared(before) != null) setShared(now, shared(before));
      }
    }
    this.watch = new Watchlist({
      load: () => shared(STORE),
      save: (preferences) => setShared(STORE, preferences),
      // Read-only GETs to Yahoo Finance and Binance; see quotes.js for the two hosts.
      fetch: (url) => fetch(url, { headers: HEADERS }),
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
      changed: () => {},
    });
    // Last quotes from before a reload or restart, until fresh ones arrive.
    if (!checking()) this.watch.restore(loadSnapshot());
    // Tick flashes. The restored prices are the "previous" ones, so the first
    // refresh after a reload already shows which way each price moved.
    this.ticks = createTickMemory();
    primeTicks(this.ticks, this.watch.quotes, this.watch.preferences.symbols);
    this.flashes = {};
    this.flashSeq = 0;
    // The loop owns its own cx for its whole life: sleeping and redrawing go through it.
    cx.spawn(async (cx) => {
      this.watch.host.sleep = (ms) => cx.sleep(ms);
      // Missing logos start with each round (see the logo note above).
      this.watch.host.beforeRound = (symbols) => { if (!checking()) this.fetchLogos(cx, symbols); };
      // On Refresh, each symbol's logo is downloaded again, queued right before its quote.
      this.watch.host.beforeQuote = (symbol, manual) => { if (manual && !checking()) this.queueLogo(cx, symbol); };
      this.watch.host.changed = () => {
        // Once a round has finished (not on every row), keep its quotes for the next start.
        if (!this.watch.loading && !checking()) saveSnapshot(this.watch.quotes, this.watch.preferences.symbols);
        // A new quote that moved: tint its price at once, then let the tint fade natively (one
        // follow-up redraw sets the target; GPUI animates the rest, no repeating timer).
        const ids = [];
        for (const tick of takeTicks(this.ticks, this.watch.quotes, this.watch.preferences.symbols)) {
          const id = ++this.flashSeq;
          this.flashes[tick.symbol] = { dir: tick.dir, id, on: tick.dir !== "flat" };
          if (tick.dir !== "flat") ids.push(id);
        }
        if (ids.length) {
          cx.timer.after(80, (cx) => {
            for (const f of Object.values(this.flashes)) if (ids.includes(f.id)) f.on = false;
            cx.notify();
          });
        }
        cx.notify();
      };
      await this.watch.run();
    });
    // Logos. The cache index is read once; then, at the start of every quote
    // round (including the one right after a ticker is added), missing logos are fetched beside the
    // quotes, never in their way: each shows as soon as its file is checked; the monogram until then.
    if (!checking()) {
      cx.spawn(async (cx) => {
        if (!LOGOS.loaded) await LOGOS.load();
        cx.notify();
      });
    }
    // `quotr.refresh` and `quotr.pause` (bind them in keys.json if you like).
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.watch.refreshNow();
        else if (command === "pause") this.togglePause();
        cx.notify();
      }
    });
  }

  close() {
    this.watch?.stop();
  }

  act(cx, action) {
    this.error = "";
    try { this.notice = action() ?? ""; } catch (cause) {
      this.notice = "";
      this.error = cause instanceof Error ? cause.message : "Could not save the watchlist.";
    }
    cx.notify();
  }

  add(cx) {
    this.act(cx, () => {
      const message = this.watch.add(this.typed);
      this.input.set_value("");
      this.typed = "";
      return message;
    });
  }

  togglePause() {
    return this.watch.pause(!this.watch.preferences.paused);
  }

  openDetail(symbol) {
    const quote = this.watch.quotes[symbol];
    if (!quote) return;
    openOverlay({
      mod: "quotr", kind: "dialog", width: 440,
      // yahooRetryAt: the panel's Yahoo cooldown, so the dialog's history requests respect it too.
      props: { detail: { ...quote, error: this.watch.errors[symbol] ?? null, yahooRetryAt: this.watch.retryAt } },
    });
  }

  render() {
    const t = theme();
    if (this.detail) return this.detailView(t);
    // Herdr re-renders every copy when shared state changes: adopt another copy's edit now.
    this.watch.sync();
    const root = (this.size && this.size.height < BAND_HEIGHT ? h_flex() : v_flex())
      .id("quotr").size_full().bg(t.chrome).text_color(t.foreground).text_size(12.5)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); });
    return this.size && this.size.height < BAND_HEIGHT ? this.band(root, t) : this.panel(root, t);
  }

  // One line: Quotr, then as many quotes as fit.
  band(root, t) {
    const w = this.watch;
    const symbols = w.preferences.symbols;
    return root.px(12).gap(14).items_center().overflow_hidden()
      .child(h_flex().flex_none().gap(6).items_center()
        .child(image(LOGO).w(14).h(14).rounded(3))
        .child(div().text_color(brand()).font_semibold().child("Quotr")))
      .child(this.clockBand)
      .when(w.preferences.paused, (el) => el.child(div().flex_none().text_color(t.blocked).child("Paused")))
      .when(!symbols.length, (el) => el.child(div().text_color(t.dim).truncate().child("Make the panel taller to add tickers.")))
      .children(symbols.map((symbol) => {
        const quote = w.quotes[symbol];
        const failed = Boolean(w.errors[symbol]);
        return h_flex().flex_none().gap(5).items_center().whitespace_nowrap()
          .child(this.assetIcon(symbol, 13, t, { logos: false }))
          .child(div().font_semibold().child(symbol))
          .child(div().text_color(quote && !failed ? t.foreground : t.dim).child(quote ? formatBandPrice(quote) : failed ? "unavailable" : "…"))
          .when(Boolean(quote), (el) => el.child(div().text_color(this.changeColor(t, quote.changePercent)).child(formatChange(quote.changePercent))))
          .when(Boolean(quote) && failed, (el) => el.child(div().text_color(t.dim).child("cached")));
      }));
  }

  // Top, up, down, bottom, in the sparkline's 56px; the ends that can't move are dimmed.
  moveButtons(symbol, index, count, t) {
    const one = (key, glyph, to, enabled, title) => div().id(`quotr-move-${key}-${symbol}`).flex_none().w(14).h(22)
      .flex().items_center().justify_center().rounded(3).text_size(12)
      .when(enabled, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => this.act(cx, () => this.watch.move(symbol, to))))
      .when(!enabled, (el) => el.text_color(t.border))
      .child(glyph);
    return h_flex().flex_none().w(56).h(22).items_center()
      .child(one("top", "⇈", 0, index > 0, "Move to top"))
      .child(one("up", "↑", index - 1, index > 0, "Move up"))
      .child(one("down", "↓", index + 1, index < count - 1, "Move down"))
      .child(one("bottom", "⇊", count - 1, index < count - 1, "Move to bottom"));
  }

  button(t, id, label, onClick) {
    return h_flex().id(id).flex_none().h(22).px(8).items_center().rounded(5).border_1().border_color(t.border)
      .text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  panel(root, t) {
    const w = this.watch;
    const { paused, symbols } = w.preferences;
    const now = Date.now();
    const statusColor = paused ? t.blocked : w.loading ? t.working : t.done;
    const status = paused ? "Auto-refresh paused" : w.loading ? "Refreshing quotes…" : `Auto-refresh every ${INTERVAL_MS / 1000}s`;
    const rateLimited = w.message.includes("rate limited");

    const header = v_flex().flex_none().px(12).pt(12).gap(6)
      .child(h_flex().items_center().gap(7)
        .child(image(LOGO).flex_none().w(18).h(18).rounded(5))
        .child(div().flex_none().text_size(13.5).font_semibold().text_color(brand()).child("Quotr"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
          .child(`${symbols.length} ${symbols.length === 1 ? "ticker" : "tickers"}`))
        // Reorder mode (the rows' sparklines become move buttons).
        .when(symbols.length > 1 || this.reordering, (el) => el.child(this.button(t, "quotr-reorder",
          this.reordering ? "Done" : "Reorder", (cx) => { this.reordering = !this.reordering; this.notice = ""; cx.notify(); })))
        .child(this.button(t, "quotr-refresh", "Refresh", (cx) => { this.watch.refreshNow(); cx.notify(); }))
        .child(this.button(t, "quotr-pause", paused ? "Resume" : "Pause", (cx) => this.act(cx, () => this.togglePause()))))
      // The New York market clock, between the title and the refresh status.
      .child(this.clockPanel)
      .child(h_flex().items_center().gap(6)
        .child(div().flex_none().w(6).h(6).rounded_full().bg(statusColor)
          .when(w.loading, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })))
        .child(div().text_size(11.5).text_color(statusColor).child(status)));

    const field = v_flex().flex_none().px(12).pt(10).gap(6)
      .child(Input.new(this.input).h(30).px(8).rounded(6).border_1()
        .border_color(this.inputFocused ? brand() : t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(this.error)))
      .when(!this.error && Boolean(this.notice), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(this.notice)))
      .when(Boolean(w.message), (el) => el.child(div().text_size(11.5).text_color(rateLimited ? t.blocked : t.dim).child(w.message)));

    if (this.reordering && symbols.length < 2) this.reordering = false;
    const reordering = this.reordering;
    const rows = symbols.map((symbol, index) => {
      const quote = w.quotes[symbol];
      const failed = w.errors[symbol];
      const stale = quote ? formatStaleDate(quote.timestamp, now) : "";
      // When this row's value was last fetched, if it is older than a few refreshes
      // (restored after a reload, paused, or failing): never presented as current.
      const updating = w.inflight.has(symbol);
      const flash = this.flashes?.[symbol];
      const old = quote && !updating && !failed && now - (quote.fetchedAt ?? 0) > 3 * INTERVAL_MS;
      const meta = quote ? [quote.name, stale && `As of ${stale}`,
        quote.delaySeconds ? `Delay ${Math.ceil(quote.delaySeconds / 60)}m` : "",
        old ? `Updated ${stamp(quote.fetchedAt, now)}` : ""].filter(Boolean).join(" · ") : "";
      const color = quote ? this.changeColor(t, quote.changePercent) : t.dim;
      return h_flex().pl(12).pr(10).gap(6).items_center().hover((s) => s.bg(t.hover))
        // The row opens the ticker's day; × sits beside it, not inside it.
        .child(v_flex().id(`quotr-row-${symbol}`).flex_1().min_w(0).py(7).gap(3)
          .when(Boolean(quote) && !reordering, (el) => el.cursor_pointer())
          // In reorder mode a click on the row does nothing, so a missed arrow never opens a dialog.
          .on_click(() => { if (!this.reordering) this.openDetail(symbol); })
          .child(h_flex().gap(10).items_center()
            // The asset's logo (or its initial) beside the ticker; no extra height.
            .child(h_flex().flex_1().min_w(0).gap(8).items_center()
              .child(this.assetIcon(symbol, 31.5, t))
              .child(v_flex().flex_1().min_w(0).gap(1)
                .child(div().font_semibold().truncate().child(symbol))
                .when(Boolean(meta), (el) => el.child(div().text_size(11).text_color(t.dim).truncate().child(meta)))))
            .when(reordering, (el) => el.child(this.moveButtons(symbol, index, symbols.length, t)))
            .when(Boolean(quote) && !reordering, (el) => el.child(this.watchlistChart(quote, color, t, now, { failed: Boolean(failed) })))
            .child(v_flex().flex_none().w(108).gap(1)
              // The last value stays during a refresh; a small pulsing dot marks the update in flight.
              // "Waiting…" only when there has never been a quote for this row.
              .child(h_flex().justify_end().items_center().gap(5)
                .when(updating && Boolean(quote), (el) => el.child(div().flex_none().w(5).h(5).rounded_full().bg(t.working)
                  .loop("opacity", { from: 0.25, to: 0.9, period: 1200 })))
                // ▲/▼ since the previous quote (until the next one), and a tint
                // behind the price that flashes on the change and fades out.
                .when(Boolean(quote) && (flash?.dir === "up" || flash?.dir === "down"), (el) => el.child(
                  div().flex_none().text_size(9).text_color(flash.dir === "up" ? t.ansi2 : t.ansi1)
                    .child(flash.dir === "up" ? "▲" : "▼")))
                .child(div().relative().px(3).rounded(4)
                  .when(Boolean(quote) && (flash?.dir === "up" || flash?.dir === "down"), (el) => el.child(
                    // A new id per tick mounts a fresh tint at full strength; the next redraw targets 0
                    // and the transition fades it natively.
                    div().id(`quotr-flash-${symbol}-${flash.id}`).absolute().top(0).left(0).size_full().rounded(4)
                      .bg(flash.dir === "up" ? t.ansi2 : t.ansi1).opacity(flash.on ? 0.32 : 0)
                      .transition("opacity", { duration: 1600, easing: "ease-out" })))
                  .child(div().relative().text_right().text_color(quote && !failed ? t.foreground : t.dim)
                    .child(quote ? formatPrice(quote) : failed ? "Unavailable" : paused ? "Not fetched" : "Waiting…"))))
              .child(div().text_right().text_size(11).text_color(color)
                .child(quote ? formatChange(quote.changePercent) : "—"))))
          .when(Boolean(failed), (el) => el.child(div().text_size(11).text_color(t.blocked)
            .child(`${quote ? `Stale · last updated ${stamp(quote.fetchedAt, now)} · ` : ""}${failed}`))))
        .child(div().id(`quotr-remove-${symbol}`).flex_none().w(14).text_right().text_color(t.dim).cursor_pointer()
          .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.act(cx, () => this.watch.remove(symbol)))
          .child("×"));
    });

    const list = v_flex().id("quotr-list").flex_1().min_h(0).pt(8).overflow_y_scrollbar()
      .when(!symbols.length, (el) => el.child(div().px(12).py(6).text_color(t.dim)
        .child("Your watchlist is empty. Add a ticker above.")))
      .children(rows);

    const crypto = symbols.some(isCryptoPair);
    // The "Pulse for Mac" promo row is removed; the sources line stays.
    const footer = v_flex().flex_none().px(12).py(10).gap(8).border_t(1).border_color(t.border)
      .child(div().text_size(10.5).text_color(t.dim)
        .child(crypto
          ? "Yahoo Finance · Binance Spot · Stocks: regular session, exchange delays vary · Crypto: 24h change"
          : "Yahoo Finance · Regular-session quotes · Exchange delays vary"))
      .children(this.logoCredits(symbols, t));

    return root.child(header).child(field).child(list).child(footer);
  }
}

// The rest of the view lives in charts.js, logoview.js and dialog.js; their methods join this class.
for (const part of [ChartParts, LogoParts, DialogParts]) {
  for (const name of Object.getOwnPropertyNames(part.prototype)) {
    if (name !== "constructor") Object.defineProperty(Quotr.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name));
  }
}
