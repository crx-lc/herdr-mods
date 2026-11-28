// How Quotr's content fits the panel's width (issue #24). No Herdr imports, so tests run it under Node.
//
// The owner's three widths, in logical pixels at zoom 1, measured from his live panel:
//   350  minimum: every row keeps today's look (logo, symbol, chart, price and change), long
//        crypto prices included; only a pair with a tiny or nine-digit price (0.00001234 USDT,
//        134,567,890.00 KRW) needs a few px more for its chart.
//   410  default: what mod.json asks for the first time Quotr is docked. Never applied to a layout
//        the person already has.
//   460  maximum useful: the content stops growing; a wider panel leaves the extra width empty.
// The host doesn't enforce any of them: a person can drag the pane narrower or wider. When a row
// doesn't fit, it gives way in a fixed order instead of clipping: the chart first, then the logo,
// then the price and change move under the symbol. The symbol, the price and the change are never
// cut or split; only the second line (the company name, "As of …") shortens.
export const WIDTHS = { minimum: 350, default: 410, maximum: 460 };

// Before the panel has been measured (the first frame, `herdr-app check`), it is drawn at the default.
export const ASSUMED_WIDTH = WIDTHS.default;

// The row's fixed parts (main.js draws them with these numbers).
export const ROW = {
  // padding left 12 and right 10, the gap 6 and the 14 px remove button beside the row
  chrome: 42,
  // between the chart and the values; the symbol keeps at least `clear` from the chart
  gap: 10,
  clear: 5,
  logo: 31.5,
  logoGap: 8,
  chart: 56, // sparkline.js SPARK_WIDTH; in reorder mode the move buttons take the same slot
  // The values column is 108 wide when everything fits (today's row); narrower only when needed.
  values: 108,
  // One 12 px slot left of the price: the ▲/▼ of the last tick or, during a refresh, the update dot.
  marker: 12,
  // The pre-market / after-hours icon (11 px and its 5 px gap), on rows that show one.
  session: 16,
  // The price's tint box (px 3 on each side).
  tint: 6,
  stackGap: 4,
};

// Text sizes the panel uses.
export const SIZES = { symbol: 12.5, price: 12.5, change: 11, button: 11, title: 13.5, clock: 11.5 };

// Advance widths in em for Herdr's default UI font (Geist), set from what it draws at zoom 1 on
// Windows (issue #24's calibration: eleven symbols and prices measured from the running panel) and
// rounded up: "222.22 USD" draws 69 px at 12.5 px and is estimated at 72. The estimate is meant to
// be a little wide, never narrow, so a row gives way a pixel or two early rather than touch its
// neighbour. The table is for semibold text (the symbols); regular text (prices, changes, labels)
// draws about 4% narrower. Characters not listed count as a full em.
const UPPER = { W: 1.06, M: 0.9, I: 0.34, O: 0.8, Q: 0.8, G: 0.8, C: 0.8, D: 0.76, E: 0.64, F: 0.64, L: 0.64, T: 0.66, Z: 0.66, J: 0.6 };
const DIGIT = { 0: 0.68, 1: 0.42 };
const OTHER = { " ": 0.3, ".": 0.3, ",": 0.3, ":": 0.3, ";": 0.3, "'": 0.3, "|": 0.3, "!": 0.3, "·": 0.3,
  "-": 0.46, "–": 0.6, "_": 0.6, "+": 0.62, "=": 0.62, "<": 0.62, ">": 0.62, "~": 0.62, "^": 0.52, "−": 0.62,
  "/": 0.46, "\\": 0.46, "%": 0.88, "(": 0.4, ")": 0.4, "[": 0.4, "]": 0.4, "…": 0.92, "▲": 0.8, "▼": 0.8 };

function em(ch) {
  if (ch in OTHER) return OTHER[ch];
  if (/[0-9]/.test(ch)) return DIGIT[ch] ?? 0.62;
  if (/[A-Z]/.test(ch)) return UPPER[ch] ?? 0.75;
  if (/[mw]/.test(ch)) return 0.88;
  if (/[ijlrtf]/.test(ch)) return 0.38;
  if (/[a-z]/.test(ch)) return 0.58;
  return 1;
}

const REGULAR = 0.96;

/** The estimated width of `text` in px at `size`, semibold unless `regular`. */
export function textWidth(text, size, { regular = false } = {}) {
  let total = 0;
  for (const ch of String(text ?? "")) total += em(ch);
  return Math.ceil(total * size * (regular ? REGULAR : 1) * 100) / 100;
}

/**
 * The panel's width in the px the mod writes (zoom 1), from Herdr's on_size_change, which reports
 * window px. null for anything that isn't a usable size.
 */
export function designWidth(size, zoom) {
  const width = Number(size?.width);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Number.isFinite(width) && width > 0 ? width / scale : null;
}

/** The width the content lays out in: the panel's, up to the maximum useful width. */
export function contentWidth(panel) {
  const width = Number.isFinite(panel) && panel > 0 ? panel : ASSUMED_WIDTH;
  return Math.min(width, WIDTHS.maximum);
}

/** What a row's values column needs: its price line (marker slot, session icon, tinted price) or its change. */
export function valuesWidth({ price, change, session = false }) {
  const line = ROW.marker + (session ? ROW.session : 0) + ROW.tint + textWidth(price, SIZES.price, { regular: true });
  return Math.max(line, textWidth(change, SIZES.change, { regular: true }));
}

/**
 * Each row's layout at panel width `width`. `rows`: [{ symbol, price, change, session?, chart? }]
 * (`chart`: the row has a sparkline to show). Returns `{ column, rows: [{ logo, chart, stacked,
 * values, slotBelow?, split? }] }`: `values` is the width of the row's values column. Rows whose
 * price fits share `column` (108, today's row, or narrower when the panel is tight), so their charts
 * line up; a row with a longer price takes a wider column of its own, its chart a little to the left.
 *
 * Order of giving way, row by row: the chart, then the logo, then the values move under the
 * symbol. While reordering, the move buttons take the chart's slot in every row and never give
 * way: the logo goes first, then the values move under the symbol and the buttons (`slotBelow`:
 * under the symbol too, when the panel is narrower than the symbol and the buttons).
 */
export function layoutRows(width, rows, { reordering = false } = {}) {
  const room = contentWidth(width) - ROW.chrome;
  const logo = ROW.logo + ROW.logoGap;
  const slot = ROW.clear + ROW.chart + ROW.gap;
  const items = rows.map((r) => {
    const symbol = textWidth(r.symbol, SIZES.symbol);
    const values = valuesWidth(r);
    // The widest values column this row could have with its logo and chart.
    const allowance = room - logo - symbol - slot;
    return { symbol, values, allowance, charted: (Boolean(r.chart) || reordering) && values <= allowance };
  });
  // Stacked, and the values still wider than the row: the price's number and currency take a line each.
  const split = (it) => (it.values > room ? { split: true } : {});
  const allowances = items.filter((it) => it.charted).map((it) => it.allowance);
  const column = Math.min(ROW.values, ...allowances);
  const laid = items.map((it) => {
    if (it.charted) return { logo: true, chart: true, stacked: false, values: Math.max(column, it.values) };
    if (reordering) {
      if (it.symbol + slot + it.values <= room) return { logo: false, chart: true, stacked: false, values: it.values };
      // The buttons stay beside the symbol; only where even that pair doesn't fit, they go under it.
      const below = it.symbol + ROW.clear + ROW.chart > room;
      return { logo: false, chart: true, stacked: true, values: it.values, ...(below ? { slotBelow: true } : {}), ...split(it) };
    }
    if (logo + it.symbol + ROW.gap + it.values <= room) return { logo: true, chart: false, stacked: false, values: it.values };
    if (it.symbol + ROW.gap + it.values <= room) return { logo: false, chart: false, stacked: false, values: it.values };
    return { logo: false, chart: false, stacked: true, values: it.values, ...split(it) };
  });
  return { column, rows: laid };
}

// The header's line: the logo, "Quotr", the ticker count (it shortens), then the buttons.
const HEADER = { padding: 24, logo: 18, gap: 7, compactGap: 4, buttonPad: 16, compactButtonPad: 10, border: 2 };

/**
 * The header at panel content width `width`, with the button labels it shows. Today's header when it
 * fits; else tighter buttons; else without the "Quotr" word (the logo stays). Below that (`wrap`) the
 * buttons wrap to a second line rather than run off the edge.
 */
export function layoutHeader(width, labels) {
  const room = contentWidth(width) - HEADER.padding;
  const need = (compact, title) => {
    const gap = compact ? HEADER.compactGap : HEADER.gap;
    const buttons = labels.reduce((sum, label) => sum + textWidth(label, SIZES.button, { regular: true })
      + (compact ? HEADER.compactButtonPad : HEADER.buttonPad) + HEADER.border, 0);
    // The logo, the title, the count (it can shorten to nothing) and each button, with a gap before each.
    return HEADER.logo + (title ? gap + textWidth("Quotr", SIZES.title) : 0) + gap + buttons + labels.length * gap;
  };
  if (need(false, true) <= room) return { compact: false, title: true, wrap: false };
  if (need(true, true) <= room) return { compact: true, title: true, wrap: false };
  return { compact: true, title: false, wrap: need(true, false) > room };
}

// The clock line: "NY", the New York date, the time, the phase, then the event ("Opens Mon 09:30 ·",
// it shortens) and the countdown.
// The event keeps at least 30 px ("Op… ·").
const CLOCK = { gap: 6, inner: 4, event: 30 };

/**
 * The clock at clock width `width` (its own, the panel's less the padding). Today's line when it
 * fits (the event's time may shorten); else without the date (it stays in the tooltip); else two
 * lines (`wrap`): the time and the phase, then the event and the countdown.
 */
export function layoutClock(width, text) {
  if (!Number.isFinite(width) || width <= 0) return { day: true, wrap: false };
  const w = (s) => textWidth(s, SIZES.clock, { regular: true });
  const time = textWidth("NY", SIZES.clock) + CLOCK.inner + textWidth(text.time ?? "", SIZES.clock);
  const tail = CLOCK.gap + w(text.phase ?? "") + (text.countdown ? CLOCK.gap + CLOCK.event + CLOCK.gap + w(text.countdown) : 0);
  if (time + CLOCK.inner + w(text.day ?? "") + tail <= width) return { day: true, wrap: false };
  if (time + tail <= width) return { day: false, wrap: false };
  return { day: false, wrap: true };
}

/**
 * A price split where it may break: only at its spaces, so a number and its currency each stay
 * whole ("59,565.52", "USDT"). Used only when the values sit under the symbol and even they
 * don't fit on one line (`split`).
 */
export function priceAtoms(text) {
  return String(text ?? "").split(" ").filter(Boolean);
}
