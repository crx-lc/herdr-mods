// Herdr Quotr: stock and crypto quotes beside your agents (based on Pulse by fatwang2, MIT; see
// README.md and LICENSE-PULSE.txt). A watchlist panel with an
// add field and a line per ticker; docked as a short strip (top or bottom), it
// draws one line of quotes. A row opens the ticker's day as a dialog: the same
// mod, given the quote in its props.
import { View, div, image, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, nextCommand, openOverlay, props, setShared, settings, shared, theme } from "herdr";
// Local customization: the Elbstream logo cache.
import { appHome, checking } from "herdr";
import * as fs from "fs/promises";
import { CACHE, LogoCache } from "./logocache.js";
import { nextLogoSource, resolveLogo, sourcesFor } from "./logosource.js";
import { Watchlist, INTERVAL_MS } from "./watchlist.js";
import {
  SESSION_LABELS, chartGeometry, formatBandPrice, formatChange, formatPrice, formatStaleDate, formatTime,
  isCryptoPair, marketSession,
} from "./quotes.js";
// Local customization: 1W / 1M / 1Y history in the detail dialog.
import { HistoryStore, RANGES, RANGE_SPECS, formatDay, sourceName } from "./history.js";
// Local customization: the chart's hover readout.
import { UTC_ZONE, formatPointTime, nearestIndex, readoutAt } from "./readout.js";
// Local customization: pre-market and after-hours for stocks.
import { SESSION_NAMES, sessionBands, sessionHours } from "./extended.js";
// Local customization: bundled asset logos.
import { assetLogo } from "./assetlogo.js";
// Local customization: price tick flashes.
import { createTickMemory, primeTicks, takeTicks } from "./ticks.js";
// Local customization: external links per platform. Herdr's window() is renamed: `window` is GPUI's
// drawing global here (window.paint_path).
import { window as herdrWindow } from "herdr";
import { detectPlatform, openExternal } from "./opener.js";

// The watchlist lives in Herdr's shared state (persisted), so every copy sees one list.
const STORE = "quotr.watchlist.v1";
// Local customization: per-ticker logo choices ({ SYMBOL: source id | "none" }; absent = Auto), and a
// counter bumped when a chosen logo arrives so every copy redraws.
const LOGO_CHOICES = "quotr.logos.v1";
const LOGO_REVISION = "quotr.logos.rev";
// Saved under the Pulse names before the rename (2026-11-17): copied over once, on first start.
const RENAMED_KEYS = [[STORE, "pulse.watchlist.v1"], [LOGO_CHOICES, "pulse.logos.v1"]];
const HEADERS = { "User-Agent": "Herdr-Quotr/1.0", Accept: "application/json" };
// Below this height the panel draws the one-line band.
const BAND_HEIGHT = 72;
const LOGO = "mods/quotr/icon.svg";
// Pulse's blue: the bright one on dark themes, the text-safe one on light.
const brand = () => (settings().dark === false ? "#1066C6" : "#6AB0FF");
// Local customization: fetched 1W / 1M / 1Y periods and the dialogs' Yahoo cooldown.
// Deliberately module scope: module code is shared by every copy, so each dialog
// (a new copy per open) reuses what an earlier one fetched. Plain memory, no host
// calls; a reload of the mod starts it empty. Exported only so a check harness can seed it.
export const HISTORY = new HistoryStore();

// The site, in the system's browser: the one program the mod runs, and only on a click.
// macOS has `open`; on Windows it is missing (exec rejects), so fall back to the
// URL protocol handler, which takes the URL as one argument with no shell (the
// URLs contain `&`, which `cmd /c start` would split).
// Local customization: "13:05" today, "Nov 16 13:05" before; "unknown" without a time.
function stamp(t, now) {
  if (!(t > 0)) return "unknown";
  const day = formatStaleDate(t, now);
  return `${day ? `${day} ` : ""}${formatTime(t)}`;
}

// Local customization: the last quotes, kept in this copy's localStorage so a reload or restart
// shows them (with their own times) instead of "Waiting…" while the first refresh runs.
const SNAPSHOT_KEY = "quotr.quotes.v1";
function loadSnapshot() {
  try { const text = localStorage.getItem(SNAPSHOT_KEY); return text ? JSON.parse(text)?.quotes ?? null : null; } catch { return null; }
}
function saveSnapshot(quotes, symbols) {
  try {
    const kept = {};
    for (const s of symbols) if (quotes[s]) kept[s] = quotes[s];
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), quotes: kept }));
  } catch { /* storage full or unavailable: the next refresh still fills the rows */ }
}

// Local customization: opens a fixed https link (the logo sources' attribution links) in the system's
// browser: macOS `open`, Windows' URL handler, Linux `xdg-open` then `gio open` (opener.js). Never
// through a shell; not awaited, so a missing or slow opener never holds the UI; failures are silent.
function openUrl(url) {
  openExternal(url, detectPlatform(herdrWindow), exec).catch(() => {});
}

// Local customization: Elbstream logos for stocks without a bundled one, cached in a hidden
// folder of this mod (Herdr's image() takes local paths only). Module scope so the panel's
// downloads serve the dialogs too; no host call happens until it is used.
const LOGO_HOST = {
  get dir() { return `${appHome().replace(/\\/g, "/")}/mods/quotr/.cache/logos`; },
  rel: "mods/quotr/.cache/logos",
  readFile: (p) => fs.readFile(p),
  readText: async (p) => ((await fs.exists(p)) ? fs.readFile(p, "utf8") : null),
  writeFile: (p, text) => fs.writeFile(p, text),
  // Byte-for-byte local copy with curl's file:// support (fs.writeFile wrote empty files for binary data).
  copyFile: async (from, to) => {
    const r = await exec("curl", ["-sS", "--proto", "=file", "-o", to, `file:///${from.replace(/^\/+/, "")}`], { timeout: 15_000 });
    if (r.code !== 0) throw new Error(`copy failed (${r.code})`);
  },
  exists: (p) => fs.exists(p),
  mkdir: (p) => fs.mkdir(p, { recursive: true }),
  unlink: (p) => fs.unlink(p),
  // curl (in Windows since 10, macOS and Linux): https only, redirects too, size and time capped.
  download: async (url, to) => {
    const r = await exec("curl", ["-sS", "-L", "--proto", "=https", "--proto-redir", "=https", "--max-time", "20",
      "--max-filesize", String(CACHE.maxBytes), "-A", CACHE.userAgent, "-o", to, "-w", "%{http_code} %{content_type}", url],
      { timeout: 30_000 });
    const [status, ...type] = String(r.stdout ?? "").trim().split(" ");
    return { status: Number(status) || 0, contentType: type.join(" ") };
  },
  now: () => Date.now(),
  preference: (symbol) => { const c = shared(LOGO_CHOICES); return c && typeof c === "object" ? c[symbol] : undefined; },
  // Text lookups a source needs before the image (AllInvestView's symbol search), via the mod's fetch.
  fetchText: async (url) => {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  },
};
export const LOGOS = new LogoCache(LOGO_HOST);

export default class Quotr extends View {
  init(_props, cx) {
    const given = props() ?? {};
    if (given.detail) {
      this.detail = given.detail;
      this.overlay = given.overlay;
      // Local customization: the dialog opens on 1D, the quote's own day, as before.
      this.range = "1D";
      this.hover = null;
      this.pending = new Set();
      this.historyErrors = {};
      // Local customization: extended hours, asked for only where Yahoo says it has them.
      this.extPending = false;
      this.extError = null;
      if (!isCryptoPair(this.detail.symbol) && this.detail.hasPrePost === true) this.loadExtended(cx);
      return;
    }
    this.size = null;
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
    // Local customization: last quotes from before a reload or restart, until fresh ones arrive.
    if (!checking()) this.watch.restore(loadSnapshot());
    // Local customization: tick flashes. The restored prices are the "previous" ones, so the first
    // refresh after a reload already shows which way each price moved.
    this.ticks = createTickMemory();
    primeTicks(this.ticks, this.watch.quotes, this.watch.preferences.symbols);
    this.flashes = {};
    this.flashSeq = 0;
    // The loop owns its own cx for its whole life: sleeping and redrawing go through it.
    cx.spawn(async (cx) => {
      this.watch.host.sleep = (ms) => cx.sleep(ms);
      // Local customization: missing logos start with each round (see the logo note above).
      this.watch.host.beforeRound = (symbols) => { if (!checking()) this.fetchLogos(cx, symbols); };
      // Local customization: on Refresh, each symbol's logo is downloaded again, queued right before its quote.
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
    // Local customization: logos. The cache index is read once; then, at the start of every quote
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

  // Local customization: the dialog's range selector and its history requests.
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
    });
  }

  // Local customization: one extended-hours request for the open stock (cached a minute,
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

    return [
      s.points > 1
        ? this.chart({ series: h.bars.map((b) => b.close), previousClose: s.first }, color, t, {
          width: "full", height: 140, fill: true,
          hover: { id: `quotr-chart-${range}`, points: h.bars, zone: h.timeZone ?? UTC_ZONE, daily: Boolean(h.daily), currency: q.currency },
        })
        : box(`Only one ${name} data point from ${h.source}; no line to draw.`, t.dim),
      h_flex().gap(12)
        .child(v_flex().flex_1().gap(2)
          .child(div().text_size(10.5).text_color(t.dim).child(changeLabel))
          .child(div().font_semibold().text_color(color).child(formatChange(s.change))))
        .child(stat(s.startsLate ? "High shown" : `${range} high`, s.high))
        .child(stat(s.startsLate ? "Low shown" : `${range} low`, s.low)),
      div().text_size(11).text_color(t.dim).child(coverage),
      ...(partial ? [div().text_size(11).text_color(t.blocked).child(`Partial period: ${partial}.`)] : []),
      ...notes,
    ];
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

  // Local customization: an asset's cached logo (logosource.js / logocache.js), drawn over its
  // initial. The initial is always there underneath, so a symbol without a logo, or a logo file that
  // is missing or won't load, shows a neat monogram; nothing here waits on the network.
  // `logos: false` (the one-line band: no room for a 12 pt attribution) shows the monogram only.
  assetIcon(symbol, size, t, { logos = true } = {}) {
    const logo = assetLogo(symbol);
    const path = logos ? LOGOS.pathFor(symbol) : null;
    const round = logo.kind === "crypto";
    const radius = Math.max(3, Math.round(size * 0.22));
    const shape = (el) => (round ? el.rounded_full() : el.rounded(radius));
    const monogram = shape(div().absolute().top(0).left(0).w(size).h(size).flex().items_center().justify_center()
      .bg(t.raised).border_1().border_color(t.border))
      .text_size(Math.max(8, Math.round(size * 0.5))).font_semibold().text_color(t.muted).child(logo.initial);
    // A logo with transparent areas goes on a white backdrop, so nothing behind shows through: a raster
    // icon full size (it has its own padding), a bare vector glyph inset so the mask never clips it.
    const style = path ? LOGOS.logoStyle(symbol) : null;
    if (style === "backdrop") {
      return shape(div().relative().flex_none().w(size).h(size).overflow_hidden().bg("#FFFFFF"))
        .child(shape(image(path).absolute().top(0).left(0).w(size).h(size)));
    }
    if (style === "inset") {
      const inset = Math.round(size * (round ? 0.17 : 0.12));
      return shape(div().relative().flex_none().w(size).h(size).overflow_hidden().bg("#FFFFFF"))
        .child(image(path).absolute().top(inset).left(inset).w(size - 2 * inset).h(size - 2 * inset));
    }
    return shape(div().relative().flex_none().w(size).h(size).overflow_hidden())
      .child(monogram)
      .when(Boolean(path), (el) => el.child(shape(image(path).absolute().top(0).left(0).w(size).h(size))));
  }

  // Local customization: fetches the logos `symbols` still lack (not present, or past their
  // retry wait), one at a time, in its own task: the quote round that called it doesn't wait. One run
  // at a time; a round starting while one runs adds nothing, the next round picks up what's left.
  fetchLogos(cx, symbols) {
    if (this.logoRun) return;
    this.logoRun = true;
    const list = [...symbols];
    cx.spawn(async (cx) => {
      try {
        if (!LOGOS.loaded) await LOGOS.load();
        for (const symbol of list) {
          if (!LOGOS.needs(symbol, Date.now())) continue;
          if (await LOGOS.refresh(symbol)) cx.notify();
        }
      } finally {
        this.logoRun = false;
      }
    });
  }

  // Local customization: Refresh re-downloads logos, one at a time, in the order their quotes go out.
  // The quote never waits; a failed download keeps the current logo; one downloaded in the last minute
  // is skipped, so repeated clicks don't re-download everything.
  queueLogo(cx, symbol) {
    if (!resolveLogo(symbol)) return;
    const last = LOGOS.index[symbol]?.fetchedAt;
    if (last && Date.now() - last < 60_000) return;
    this.logoQueue ??= [];
    if (this.logoQueue.includes(symbol)) return;
    this.logoQueue.push(symbol);
    if (this.logoQueueRunning) return;
    this.logoQueueRunning = true;
    cx.spawn(async (cx) => {
      try {
        if (!LOGOS.loaded) await LOGOS.load();
        while (this.logoQueue.length) {
          const next = this.logoQueue.shift();
          if (await LOGOS.refresh(next)) cx.notify();
        }
      } finally {
        this.logoQueueRunning = false;
      }
    });
  }

  // Local customization: one attribution link per logo source shown among `symbols` (today only
  // Elbstream, whose free tier asks for a visible link of at least 12 pt = 16 px wherever its logos show).
  logoCredits(symbols, t) {
    const counts = new Map();
    for (const s of symbols) {
      const source = LOGOS.sourceFor(s);
      if (source?.attribution) counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    // "11 logos by AllInvestView ↗" in the panel, "Logo by Elbstream ↗" in a ticker's dialog. All at the
    // footer's 10.5 px (the owner's choice, also for Elbstream), in Pulse's blue.
    const single = symbols.length === 1;
    return [...counts].map(([source, n]) => {
      const by = source.attribution.text.replace(/^Logos by /, "");
      const label = single ? `Logo by ${by}` : `${n} ${n === 1 ? "logo" : "logos"} by ${by}`;
      return div().id(`quotr-logo-credit-${source.id}`).flex_none()
        .text_size(source.attribution.minPx ?? 10.5).text_color(brand()).cursor_pointer()
        .hover((s) => s.opacity(0.8)).on_click(() => openUrl(source.attribution.url))
        .child(label);
    });
  }

  // Local customization: the dialog's per-ticker logo choice. Auto (the usual order), any source that
  // can show this ticker, or None (monogram). Saved in shared state; the new logo downloads at once.
  // Local customization: the dialog's logo line: "Logo by … ↗ · Change". Change cycles through the
  // sources that can show this ticker (in source order, wrapping), saving the choice for it.
  logoChoice(symbol, t) {
    const sources = sourcesFor(symbol);
    if (!sources.length) return [];
    // Where the shown logo comes from, first: its source's link (the attribution), or a plain note.
    const shownFrom = LOGOS.sourceFor(symbol);
    const credit = shownFrom?.attribution
      ? this.logoCredits([symbol], t)
      : [div().text_size(10.5).text_color(t.dim).child(shownFrom?.id === "local" ? "Bundled logo" : LOGOS.pathFor(symbol) ? "Logo" : "No logo")];
    return [h_flex().gap(6).items_center().flex_wrap()
      .children(credit)
      .when(sources.length > 1, (el) => el
        .child(div().text_size(10.5).text_color(t.dim).child("·"))
        .child(div().id("quotr-logo-change").h(20).px(7).flex().items_center().rounded(5).border_1().border_color(t.border)
          .text_size(10.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.chooseLogo(symbol, nextLogoSource(symbol, sources, this.logoChoiceOf(symbol)), cx))
          .child("Change")))];
  }

  logoChoiceOf(symbol) {
    const saved = shared(LOGO_CHOICES);
    return (saved && typeof saved === "object" && saved[symbol]) || "auto";
  }


  chooseLogo(symbol, id, cx) {
    const saved = shared(LOGO_CHOICES);
    const choices = saved && typeof saved === "object" ? { ...saved } : {};
    if (id === "auto") delete choices[symbol]; else choices[symbol] = id;
    setShared(LOGO_CHOICES, choices);
    cx.notify();
    if (checking() || !LOGOS.needs(symbol, Date.now())) return;
    cx.spawn(async (cx) => {
      if (!LOGOS.loaded) await LOGOS.load();
      if (await LOGOS.refresh(symbol)) setShared(LOGO_REVISION, Date.now()); // every copy redraws with it
      cx.notify();
    });
  }

  // Under the 1D extended chart: which shading is which, with the hours Yahoo gives for the latest day.
  sessionLegend(ext, t) {
    const key = (session, hours) => h_flex().gap(5).items_center()
      .child(div().w(9).h(9).rounded(2).bg(this.sessionColor(t, session)).opacity(0.5))
      .child(div().text_size(10.5).text_color(t.dim).child(hours ? `${SESSION_NAMES[session]} ${hours}` : SESSION_NAMES[session]));
    return h_flex().gap(12).flex_wrap()
      .child(key("pre", sessionHours(ext.periods.pre.at(-1))))
      .child(key("post", sessionHours(ext.periods.post.at(-1))))
      .child(div().text_size(10.5).text_color(t.dim).child("unshaded: regular"));
  }

  // Local customization: pre-market and after hours each keep one theme color, in bands, legend and labels.
  sessionColor(t, session) {
    return session === "pre" ? t.ansi4 : session === "post" ? t.ansi5 : t.muted;
  }

  changeColor(t, change) {
    return change === null || change === undefined ? t.dim : change >= 0 ? t.ansi2 : t.ansi1;
  }

  // The day's line, scaled to its box; the previous close is a dashed rule.
  // Local customization: `hover` ({ id, points, zone, daily, currency }) adds the readout;
  // `quote.series` must then be `points`' closes, in order, so index i is the point drawn at i.
  // `bands` ([{ session, from, to }] in %) shades pre-market and after hours behind the line.
  chart(quote, color, t, { width, height, fill, hover, bands = [] }) {
    const box = div().relative().flex_none().h(height);
    const sized = width === "full" ? box.w_full() : box.w(width);
    const g = chartGeometry(quote.series, quote.previousClose);
    if (!g) return sized;
    const layer = (path, paint) => window.paint_path(path, paint).absolute().top(0).left(0).size_full();
    let line = PathBuilder.stroke(fill ? 2 : 1.25);
    g.points.forEach(([x, y], i) => { line = i ? line.line_to(`${x}%`, `${y}%`) : line.move_to(`${x}%`, `${y}%`); });
    // Only when every drawn point has its own record: never a readout for a point it can't name.
    const readable = Boolean(hover) && Array.isArray(hover.points) && hover.points.length === g.points.length;
    return (readable ? this.hoverable(sized, hover, g.points.length) : sized)
      .children(bands.map((b) => layer(
        PathBuilder.fill().move_to(`${b.from}%`, "0%").line_to(`${b.to}%`, "0%").line_to(`${b.to}%`, "100%")
          .line_to(`${b.from}%`, "100%").close().build(),
        Background.solid(this.sessionColor(t, b.session)).opacity(0.13))))
      .when(g.reference !== null, (el) => el.child(layer(
        PathBuilder.stroke(1).dash_array([3, 3]).move_to("0%", `${g.reference}%`).line_to("100%", `${g.reference}%`).build(),
        t.border)))
      .when(Boolean(fill), (el) => {
        let area = PathBuilder.fill().move_to("0%", "100%");
        for (const [x, y] of g.points) area = area.line_to(`${x}%`, `${y}%`);
        return el.child(layer(area.line_to("100%", "100%").close().build(),
          Background.solid(color).opacity(0.16)));
      })
      .child(layer(line.build(), color))
      .children(readable ? this.hoverParts(hover, g, color, t) : []);
  }

  // Local customization: pointer tracking for a chart. Redraws only when the nearest point
  // changes (every redraw repaints the window); leaving the chart clears the readout.
  hoverable(el, hover, count) {
    return el.id(hover.id)
      .on_mouse_move((event, cx) => {
        const width = event.bounds?.width;
        const height = event.bounds?.height;
        const index = nearestIndex(event.local_position?.x, width, count);
        const h = this.hover;
        if (index < 0) {
          if (h?.id === hover.id) { this.hover = null; cx.notify(); }
          return;
        }
        if (h?.id === hover.id && h.index === index && h.width === width && h.height === height) return;
        this.hover = { id: hover.id, index, width, height };
        cx.notify();
      })
      .on_hover((inside, cx) => {
        if (!inside && this.hover?.id === hover.id) { this.hover = null; cx.notify(); }
      });
  }

  // The guide line, the marker on the point, and the readout in the corner away from it.
  hoverParts(hover, g, color, t) {
    const h = this.hover;
    if (!h || h.id !== hover.id || !(h.width > 0) || !(h.height > 0)) return [];
    const info = readoutAt(hover.points, h.index, hover.zone, { daily: hover.daily, now: Date.now() });
    const at = g.points[h.index];
    if (!info || !at) return [];
    // Extended-hours 1D points carry their session; history points don't.
    const session = SESSION_NAMES[hover.points[h.index]?.session];
    if (session) info.when = `${info.when} · ${session}`;
    const x = at[0] / 100 * h.width;
    const y = at[1] / 100 * h.height;
    const box = v_flex().absolute().top(4).gap(1).px(7).py(4).rounded(5).border_1().border_color(t.border)
      .bg(t.popover).whitespace_nowrap()
      .child(div().text_size(10.5).text_color(t.muted).child(info.when))
      .child(div().text_size(12).font_semibold().text_color(t.foreground)
        .child(formatPrice({ price: info.price, currency: hover.currency ?? null })));
    return [
      div().absolute().top(0).left(Math.round(x)).w(1).h(h.height).bg(t.muted).opacity(0.6),
      div().absolute().left(Math.round(x - 4)).top(Math.round(y - 4)).w(8).h(8).rounded_full()
        .bg(color).border_1().border_color(t.background),
      // Opposite half from the pointer, so the box never covers the point or leaves the chart.
      x > h.width / 2 ? box.left(6) : box.right(6),
    ];
  }

  // One line: Quotr, then as many quotes as fit.
  band(root, t) {
    const w = this.watch;
    const symbols = w.preferences.symbols;
    return root.px(12).gap(14).items_center().overflow_hidden()
      .child(h_flex().flex_none().gap(6).items_center()
        .child(image(LOGO).w(14).h(14).rounded(3))
        .child(div().text_color(brand()).font_semibold().child("Quotr")))
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

  // Local customization: top, up, down, bottom, in the sparkline's 56px; the ends that can't move are dimmed.
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
        // Local customization: reorder mode (the rows' sparklines become move buttons).
        .when(symbols.length > 1 || this.reordering, (el) => el.child(this.button(t, "quotr-reorder",
          this.reordering ? "Done" : "Reorder", (cx) => { this.reordering = !this.reordering; this.notice = ""; cx.notify(); })))
        .child(this.button(t, "quotr-refresh", "Refresh", (cx) => { this.watch.refreshNow(); cx.notify(); }))
        .child(this.button(t, "quotr-pause", paused ? "Resume" : "Pause", (cx) => this.act(cx, () => this.togglePause()))))
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
      // Local customization: when this row's value was last fetched, if it is older than a few refreshes
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
            // Local customization: the asset's logo (or its initial) beside the ticker; no extra height.
            .child(h_flex().flex_1().min_w(0).gap(8).items_center()
              .child(this.assetIcon(symbol, 31.5, t))
              .child(v_flex().flex_1().min_w(0).gap(1)
                .child(div().font_semibold().truncate().child(symbol))
                .when(Boolean(meta), (el) => el.child(div().text_size(11).text_color(t.dim).truncate().child(meta)))))
            .when(reordering, (el) => el.child(this.moveButtons(symbol, index, symbols.length, t)))
            .when(Boolean(quote) && !reordering, (el) => el.child(this.chart(quote, color, t, { width: 56, height: 22 })))
            .child(v_flex().flex_none().w(108).gap(1)
              // The last value stays during a refresh; a small pulsing dot marks the update in flight.
              // "Waiting…" only when there has never been a quote for this row.
              .child(h_flex().justify_end().items_center().gap(5)
                .when(updating && Boolean(quote), (el) => el.child(div().flex_none().w(5).h(5).rounded_full().bg(t.working)
                  .loop("opacity", { from: 0.25, to: 0.9, period: 1200 })))
                // Local customization: ▲/▼ since the previous quote (until the next one), and a tint
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
    // Local customization: the "Pulse for Mac" promo row is removed; the sources line stays.
    const footer = v_flex().flex_none().px(12).py(10).gap(8).border_t(1).border_color(t.border)
      .child(div().text_size(10.5).text_color(t.dim)
        .child(crypto
          ? "Yahoo Finance · Binance Spot · Stocks: regular session, exchange delays vary · Crypto: 24h change"
          : "Yahoo Finance · Regular-session quotes · Exchange delays vary"))
      .children(this.logoCredits(symbols, t));

    return root.child(header).child(field).child(list).child(footer);
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
    // Local customization: extended hours (stocks where Yahoo has them).
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
          // Local customization: with each point's own time, the line is drawn from those
          // points so the readout names exactly what is drawn. Without times (an older quote,
          // or a source that gave none), the line is drawn as before, with no readout.
          // Local customization: with extended hours, the line runs from the latest regular
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
            : h_flex().gap(12).child(stat("Open", q.open)).child(stat("High", q.high)).child(stat("Low", q.low))
              .child(stat("Prev close", q.previousClose)),
        ]
        : this.periodParts(q, t, stat))
      .child(div().text_size(11).text_color(t.dim).child(asOf))
      // Local customization: the "Pulse for Mac" card is removed from the dialog.
      .when(Boolean(q.error), (el) => el.child(div().text_size(11).text_color(t.blocked).child(`Cached quote · ${q.error}`)))
      // Local customization: "Logo by … ↗ · Source: Auto · …": the credit and the per-ticker choice together.
      .children(this.logoChoice(q.symbol, t));
  }
}
