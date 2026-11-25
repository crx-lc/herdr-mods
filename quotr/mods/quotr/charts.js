// Charts for the panel and the dialog: the line with its previous-close rule, the shaded sessions and
// their legend, the hover readout, and the colors for a change and a session. Methods of the Quotr
// view (main.js joins them to its class), so `this` is the view.
import { div, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { chartGeometry, formatPrice } from "./quotes.js";
import { SPARK_WIDTH, SPARK_HEIGHT, watchlistSparkline } from "./sparkline.js";
import { nearestIndex, readoutAt } from "./readout.js";
import { SESSION_NAMES, sessionHours } from "./extended.js";

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

  // The watchlist row's chart, a small 1D chart (sparkline.js): the line in the percentage's color
  // over a faint fill, the dashed reference the percentage is measured against, and a one-line hover.
  watchlistChart(quote, color, t, now, options) {
    const g = watchlistSparkline(quote, now, options);
    const box = div().id(`quotr-spark-${quote.symbol}`).relative().flex_none()
      .w(SPARK_WIDTH).h(SPARK_HEIGHT).opacity(g.stale ? 0.5 : 1)
      .accessibility_label(g.description).tooltip(g.label);
    const layer = (path, paint) => window.paint_path(path.build(), paint).absolute().top(0).left(0).size_full();
    // PathBuilder coordinates are percentages of this 56×22 box.
    const x = (v) => `${v / SPARK_WIDTH * 100}%`;
    const y = (v) => `${v / SPARK_HEIGHT * 100}%`;
    if (g.line.length > 1) {
      let area = PathBuilder.fill().move_to(x(g.line[0][0]), y(SPARK_HEIGHT));
      for (const [px, py] of g.line) area = area.line_to(x(px), y(py));
      box.child(layer(area.line_to(x(g.line.at(-1)[0]), y(SPARK_HEIGHT)).close(), Background.solid(color).opacity(0.16)));
    }
    if (g.reference !== null) {
      box.child(layer(PathBuilder.stroke(1).dash_array([2, 2]).move_to("0%", y(g.reference)).line_to("100%", y(g.reference)), t.muted));
    }
    if (g.line.length === 1) {
      const [px, py] = g.line[0];
      box.child(layer(PathBuilder.stroke(2).move_to(x(Math.max(0, px - 1)), y(py)).line_to(x(Math.min(SPARK_WIDTH, px + 1)), y(py)), color));
    } else if (g.line.length > 1) {
      let path = PathBuilder.stroke(1.25);
      g.line.forEach(([px, py], i) => { path = i ? path.line_to(x(px), y(py)) : path.move_to(x(px), y(py)); });
      box.child(layer(path, color));
    }
    return box;
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
