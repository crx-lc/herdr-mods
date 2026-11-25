// Charts for the panel and the dialog: the line with its previous-close rule, the shaded sessions and
// their legend, the hover readout, and the colors for a change and a session. Methods of the Quotr
// view (main.js joins them to its class), so `this` is the view.
import { div, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, Popup } from "gpui-base";
import { chartGeometry, formatPrice } from "./quotes.js";
import { SPARK_WIDTH, SPARK_HEIGHT, watchlistSparkline } from "./sparkline.js";
import { nearestIndex, readoutAt } from "./readout.js";
import { SESSION_NAMES, sessionHours } from "./extended.js";

// The sparkline's explanation is a card Quotr draws, not the shell's `tooltip`: that label is one
// line that never wraps, so its long text ran past the window's edge. Same rest delay as the shell's.
const SPARK_CARD_DELAY = 500;
const SPARK_CARD_WIDTH = 272; // fits inside the 300px panel with room to spare

export class ChartParts {
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

  // Pre-market and after hours each keep one theme color, in bands, legend and labels.
  sessionColor(t, session) {
    return session === "pre" ? t.ansi4 : session === "post" ? t.ansi5 : t.muted;
  }

  changeColor(t, change) {
    return change === null || change === undefined ? t.dim : change >= 0 ? t.ansi2 : t.ansi1;
  }

  // Compact row only. Separate the observed shape from the headline reference magnitude.
  watchlistChart(quote, color, t, now, options) {
    const g = watchlistSparkline(quote, now, options);
    const symbol = quote.symbol;
    const box = div().id(`quotr-spark-${symbol}`).relative().flex_none()
      .w(SPARK_WIDTH).h(SPARK_HEIGHT).accessibility_label(g.description).opacity(g.stale ? 0.5 : 1)
      .on_hover((inside, cx) => this.sparkHover(symbol, inside, cx))
      // GPUI gives the press to the row too, so its detail still opens; the card must not stay over it.
      .on_mouse_down("left", (_e, cx) => this.sparkHover(symbol, false, cx));
    const layer = (path, paint) => window.paint_path(path.build(), paint)
      .absolute().top(0).left(0).size_full();
    // Established PathBuilder units: percentages local to this exact 56×22 box.
    const xPercent = (x) => `${x / SPARK_WIDTH * 100}%`;
    const yPercent = (y) => `${y / SPARK_HEIGHT * 100}%`;
    const stroke = (x, y, toX, toY, width = 1) => PathBuilder.stroke(width)
      .move_to(xPercent(x), yPercent(y)).line_to(xPercent(toX), yPercent(toY));
    if (g.line.length === 1) {
      const [x, y] = g.line[0];
      box.child(layer(stroke(x - 1, y, x + 1, y, 2), t.muted));
    } else if (g.line.length > 1) {
      let path = PathBuilder.stroke(1.25);
      g.line.forEach(([x, y], i) => { path = i ? path.line_to(xPercent(x), yPercent(y)) : path.move_to(xPercent(x), yPercent(y)); });
      box.child(layer(path, t.muted));
    }
    if (g.move) {
      box.child(layer(stroke(2, 19, 54, 19), t.border))
        .child(layer(stroke(28, 16, 28, 21), t.muted));
      // Paint nonzero cues above the tick so small signed moves stay visible.
      if (g.move.percent !== 0) box.child(layer(stroke(g.move.from, 19, g.move.to, 19, 2.5), color));
      // A zero move has a visible center tick; a capped value has an end stop.
      if (g.move.capped) box.child(layer(stroke(g.move.to, 16, g.move.to, 21), color));
    }
    const open = this.sparkTip?.symbol === symbol && this.sparkTip.open === true;
    return Popup.new(`quotr-spark-tip-${symbol}`, box).flex_none().anchor("top_right")
      .when(open, (el) => el.content(this.sparkCard(g.notes, t)));
  }

  // Resting on a sparkline opens its card after the delay; leaving it or pressing it closes it.
  sparkHover(symbol, inside, cx) {
    const tip = this.sparkTip;
    if (!inside) {
      if (tip?.symbol === symbol) { this.sparkTip = null; cx.notify(); }
      return;
    }
    if (tip?.symbol === symbol) return;
    const seq = (this.sparkSeq ?? 0) + 1;
    this.sparkSeq = seq;
    this.sparkTip = { symbol, seq, open: false };
    cx.timer.after(SPARK_CARD_DELAY, (cx) => {
      if (this.sparkTip?.seq !== seq) return;
      this.sparkTip = { symbol, seq, open: true };
      cx.notify();
    });
  }

  // One wrapped paragraph per note, so the lower-rail part is as readable as the top.
  sparkCard(notes, t) {
    return v_flex().w(SPARK_CARD_WIDTH).gap(4).px(9).py(7).rounded(6).border_1().border_color(t.border)
      .bg(t.popover).whitespace_normal().text_size(11).text_color(t.foreground)
      .children(notes.map((note) => div().w_full().child(note)));
  }

  // The day's line, scaled to its box; the previous close is a dashed rule.
  // `hover` ({ id, points, zone, daily, currency }) adds the readout;
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

  // Pointer tracking for a chart. Redraws only when the nearest point
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
}
