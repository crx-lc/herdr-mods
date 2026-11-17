// Logos in the view: the logo tile over its monogram, starting downloads beside the quote rounds, the
// attribution links, and the dialog's per-ticker source choice. Methods of the Quotr view (main.js
// joins them to its class), so `this` is the view. The cache itself is logocache.js.
import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { setShared, shared, checking } from "herdr";
import { nextLogoSource, resolveLogo, sourcesFor } from "./logosource.js";
import { assetLogo } from "./assetlogo.js";
import { LOGO_CHOICES, LOGO_REVISION, brand, openUrl, LOGOS } from "./context.js";

export class LogoParts {
  // An asset's cached logo (logosource.js / logocache.js), drawn over its
  // initial. The initial is always there underneath, so a symbol without a logo, or a logo file that
  // is missing or won't load, shows a neat monogram; nothing here waits on the network.
  // `logos: false` (the one-line band: no room for the sources' attribution links) shows the monogram only.
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

  // Fetches the logos `symbols` still lack (not present, or past their
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

  // Refresh re-downloads logos, one at a time, in the order their quotes go out.
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

  // One attribution link per logo source shown among `symbols`, each with its
  // count. Both sources ask for a visible link wherever their logos show.
  logoCredits(symbols, t) {
    const counts = new Map();
    for (const s of symbols) {
      const source = LOGOS.sourceFor(s);
      if (source?.attribution) counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    // "11 logos by AllInvestView ↗" in the panel, "Logo by Elbstream ↗" in a ticker's dialog. All at the
    // footer's 10.5 px, in the brand blue.
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

  // The dialog's per-ticker logo choice. Auto (the usual order), any source that
  // can show this ticker, or None (monogram). Saved in shared state; the new logo downloads at once.
  // The dialog's logo line: "Logo by … ↗ · Change". Change cycles through the
  // sources that can show this ticker (in source order, wrapping), saving the choice for it.
  logoChoice(symbol, t) {
    const sources = sourcesFor(symbol);
    if (!sources.length) return [];
    // Where the shown logo comes from, first: its source's link (the attribution), or a plain note.
    const shownFrom = LOGOS.sourceFor(symbol);
    const credit = shownFrom?.attribution
      ? this.logoCredits([symbol], t)
      : [div().text_size(10.5).text_color(t.dim).child(LOGOS.pathFor(symbol) ? "Logo" : "No logo")];
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
}
