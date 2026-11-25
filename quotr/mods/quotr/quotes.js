// Symbols, the two quote sources and number formatting. No Herdr imports, so
// tests run it under Node. Ported from Pulse CC (plugins/claude-code/hooks).
// `points` (each close with its own source timestamp) and `timeZone`
// on quotes, plus decodeKlinePoints, for the detail chart's hover readout.
import { UTC_ZONE, timedPoints, yahooTimeZone } from "./readout.js";

// The quote sources. Every host the mod contacts is listed in README.md, "Data sources and limits".
/** Sent with every request the mod makes. */
export const USER_AGENT = "Herdr-Quotr/1.0";
export const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
export const BINANCE_TICKERS = "https://data-api.binance.vision/api/v3/ticker/24hr";
export const BINANCE_KLINES = "https://data-api.binance.vision/api/v3/klines";
// Shown until the person saves a watchlist of their own.
export const STARTER_SYMBOLS = ["AAPL", "NVDA", "^GSPC", "BTC/USDT"];
export const BINANCE_BATCH = 100;

export class QuoteError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.retryAfterMs = options.retryAfterMs;
    this.invalidSymbol = options.invalidSymbol === true;
  }
}

/** A Binance Spot pair is written BASE/QUOTE (BTC/USDT); a dash stays a Yahoo symbol (BTC-USD). */
export function isCryptoPair(symbol) {
  return /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol);
}

/** Yahoo tickers or Binance pairs, never company names or URLs. Throws a message for people. */
export function normalizeSymbol(input) {
  let symbol = String(input ?? "").trim().toUpperCase();
  if (isCryptoPair(symbol)) return symbol;
  if (!/^[A-Z0-9^][A-Z0-9.^=\-]{0,31}$/.test(symbol)) {
    throw new QuoteError("Enter a ticker, such as AAPL, 0700.HK or ^GSPC, or a pair, such as BTC/USDT.");
  }
  if (/^\d{6}\.SH$/.test(symbol)) symbol = symbol.replace(/\.SH$/, ".SS");
  const hk = /^(\d{1,5})\.HK$/.exec(symbol);
  if (hk) symbol = String(Number(hk[1])).padStart(4, "0") + ".HK";
  return symbol;
}

const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

const cleanText = (value) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 100) || null
  : null;

/**
 * Two days of 5-minute bars, extended hours included: the quote metadata, the latest regular
 * session's line (the dialog) and every trade since the last regular close (the row) in one request.
 */
export function yahooUrl(symbol) {
  return YAHOO_CHART + encodeURIComponent(normalizeSymbol(symbol)) + "?interval=5m&range=2d&includePrePost=true";
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const MAX_POINTS = 400;

/** Finite closes in order; gaps (null bars) are dropped. */
function cleanSeries(values) {
  if (!Array.isArray(values)) return [];
  const series = values.filter((value) => positive(value));
  return series.length > MAX_POINTS ? series.slice(series.length - MAX_POINTS) : series;
}

const period = (value) => finite(value?.start) && finite(value?.end) && value.end > value.start
  ? [value.start * 1000, value.end * 1000] : null;

/** Yahoo's `tradingPeriods` as { pre, regular, post } lists of [start, end] in ms, oldest first. */
function tradingPeriods(meta) {
  const out = { pre: [], regular: [], post: [] };
  const take = (value, into) => {
    if (Array.isArray(value)) { value.forEach((v) => take(v, into)); return; }
    const p = period(value);
    if (p) into.push(p);
  };
  const tp = meta?.tradingPeriods;
  if (Array.isArray(tp)) take(tp, out.regular);
  else if (tp && typeof tp === "object") { take(tp.pre, out.pre); take(tp.regular, out.regular); take(tp.post, out.post); }
  for (const list of Object.values(out)) list.sort((x, y) => x[0] - y[0]);
  return out;
}

const SLACK_MS = 300_000; // one bar: a closing print can sit just past a session's end
const within = (t, p, slack = 0) => t >= p[0] && t <= p[1] + slack;

/**
 * A bar's session by its start time; each session holds its start, not its end (Yahoo's bar at
 * 16:00 is the first after-hours bar). null outside all of them.
 */
function sessionOf(t, periods) {
  const inside = (p) => t >= p[0] && t < p[1];
  if (periods.regular.some(inside)) return "regular";
  if (periods.pre.some(inside)) return "pre";
  if (periods.post.some(inside)) return "post";
  return null;
}

// Bar lengths: Yahoo's 5-minute bars, Binance's 15-minute klines.
export const STOCK_BAR_MS = 300_000;
export const CRYPTO_BAR_MS = 900_000;
/**
 * Whether two consecutive points of a line with bars of `bar` ms have a hole between them: more
 * than one and a half bars apart, so a single missing bar is a hole while a quote a few seconds
 * past a bar's end is not.
 */
export const isHole = (from, to, bar) => to - from > bar * 1.5;

/** Trading time (inside any session) between `from` and `to`, in ms: closed hours count zero. */
function tradingTime(from, to, periods) {
  const all = [...periods.pre, ...periods.regular, ...periods.post].sort((x, y) => x[0] - y[0]);
  let total = 0, reached = from;
  for (const [a, b] of all) {
    const lo = Math.max(a, reached), hi = Math.min(b, to);
    if (hi > lo) { total += hi - lo; reached = hi; }
  }
  return total;
}

/**
 * Every trade since the last regular close, for the watchlist row (issue #37).
 * The close is the previous regular close (`reference`, as decoded for the quote); once the next
 * trading day's first pre-market trade arrives, it is the latest regular session's own close
 * (`regularMarketPrice`, final by then). The line starts with that close at its time when both
 * are known, then every bar after it in its session. Each point's `slot` is the trading time since
 * the start, so closed hours take no room and missing bars leave room; `gap` marks a point after
 * a hole (isHole: any missing bar). The row's price is the latest trade, whether or not a reference is
 * known (`changePercent` is then null). null without a regular session.
 */
export function yahooTrail(meta, bars, regular, now, reference = null) {
  const periods = tradingPeriods(meta);
  if (!regular || !periods.regular.length) return null;
  const before = [...periods.regular].reverse().find((p) => p[1] <= regular[0]) ?? null;
  const rolled = now >= regular[1] && bars.some((b) => b.t >= regular[1] && sessionOf(b.t, periods) === "pre");
  const ref = rolled ? (positive(meta.regularMarketPrice) ? meta.regularMarketPrice : null) : positive(reference) ? reference : null;
  const closeAt = rolled ? regular[1] : before?.[1] ?? null;
  // Without the close's time, the latest session's own day: its pre-market, else its open.
  const start = closeAt ?? periods.pre.find((p) => p[1] === regular[0])?.[0] ?? regular[0];
  const points = ref !== null && closeAt !== null ? [{ t: closeAt, close: ref, session: "close" }] : [];
  for (const b of bars) {
    if (b.t < start) continue;
    const session = sessionOf(b.t, periods);
    if (session) points.push({ t: b.t, close: b.close, session });
  }
  const regularTime = meta.regularMarketTime * 1000;
  const last = points.at(-1);
  const extended = (last?.session === "pre" || last?.session === "post") && last.t > regularTime;
  const shown = extended
    ? { price: last.close, t: last.t, session: last.session }
    : { price: meta.regularMarketPrice, t: regularTime, session: "regular" };
  // The regular quote is the latest trade: it ends the line (replacing a bar at the same time).
  if (!extended && regularTime >= start && (!last || regularTime >= last.t)) {
    const end = { t: regularTime, close: meta.regularMarketPrice, session: "regular" };
    if (last && last.t === regularTime && last.session !== "close") points[points.length - 1] = end; else points.push(end);
  }
  points.forEach((p, i) => {
    p.slot = tradingTime(start, p.t, periods);
    p.gap = i > 0 && isHole(points[i - 1].slot, p.slot, STOCK_BAR_MS);
  });
  return { reference: ref, closeAt, start, points, ...shown,
    changePercent: ref !== null ? (shown.price - ref) / ref * 100 : null };
}

/**
 * What the watchlist row shows for a quote: with a stock's trail, its latest trade (pre-market,
 * regular or after hours) and the change against the trail's reference; otherwise the quote as is.
 * The dialog keeps the quote itself (the regular session).
 */
export function shownQuote(quote) {
  const tr = quote?.trail;
  if (!tr || !positive(tr.price) || !positive(tr.t)) return quote;
  // A trail cached before points carried their trading time can't show its holes: unused until
  // the next refresh replaces it.
  if (!Array.isArray(tr.points) || !tr.points.length || !tr.points.every((p) => Number.isFinite(p?.slot))) return quote;
  // No reference: the latest trade still shows, with no change rather than a wrong one.
  const known = positive(tr.reference) && Number.isFinite(tr.changePercent);
  return { ...quote, price: tr.price, changePercent: known ? tr.changePercent : null,
    previousClose: known ? tr.reference : null, timestamp: tr.t, shownSession: tr.session };
}

/** `response` is `{ status, ok, text }` with the body already read. */
export function decodeYahoo(symbol, response, now) {
  // Herdr's fetch does not expose headers, so Retry-After is unknown: wait at least a minute.
  if (response.status === 429) throw new QuoteError("Yahoo rate limited requests.", { retryAfterMs: 60_000 });
  if (response.status === 404) throw new QuoteError("Ticker not found on Yahoo Finance.");
  if (!response.ok) throw new QuoteError(`Yahoo returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Yahoo returned an unreadable response."); }
  const meta = body?.chart?.result?.[0]?.meta;
  if (body?.chart?.error || !meta) throw new QuoteError("No quote available for this ticker.");
  // Never show another instrument's response under the requested ticker.
  let returned = null;
  try { returned = typeof meta.symbol === "string" ? normalizeSymbol(meta.symbol) : null; } catch { /* checked below */ }
  if (returned !== symbol) throw new QuoteError("Yahoo returned a different ticker.");
  if (!positive(meta.regularMarketPrice) || !positive(meta.regularMarketTime)) {
    throw new QuoteError("Yahoo returned an incomplete quote.");
  }
  const delay = meta.exchangeDataDelayedBy;
  const ohlc = body.chart.result[0].indicators?.quote?.[0] ?? {};
  const times = Array.isArray(body.chart.result[0].timestamp) ? body.chart.result[0].timestamp : [];
  const column = (name, i) => (Array.isArray(ohlc[name]) ? ohlc[name][i] : null);
  // Every bar with a time, oldest first. Each column is checked on its own: a bar without a close
  // can still carry a valid open, high or low.
  const rows = [];
  times.forEach((s, i) => {
    if (positive(s)) rows.push({ t: s * 1000, close: column("close", i), open: column("open", i), high: column("high", i), low: column("low", i) });
  });
  rows.sort((a, b) => a.t - b.t);
  const all = rows.filter((b) => positive(b.close));
  // The latest regular session (the one holding regularMarketTime): the dialog's day and the
  // quote's own open, high and low. The rest of the response is extended hours and the day before.
  const regularTime = meta.regularMarketTime * 1000;
  const regulars = tradingPeriods(meta).regular;
  const regular = regulars.find((p) => within(regularTime, p, SLACK_MS))
    ?? [...regulars].reverse().find((p) => p[0] <= regularTime) ?? null;
  const day = regular ? rows.filter((b) => b.t >= regular[0] && b.t < regular[1]) : rows;
  // `chartPreviousClose` is the close before the whole answer: the previous close only when the
  // answer holds one regular session.
  const close = positive(meta.previousClose) ? meta.previousClose : regulars.length <= 1 ? meta.chartPreviousClose : null;
  // Without bar times (an older or partial answer) the columns are taken as they come, untimed.
  const columnOf = (name) => (times.length ? day.map((b) => b[name]) : ohlc[name]);
  const series = cleanSeries(columnOf("close"));
  const opens = cleanSeries(columnOf("open"));
  const highs = cleanSeries(columnOf("high"));
  const lows = cleanSeries(columnOf("low"));
  const periods = meta.currentTradingPeriod ?? {};
  return {
    symbol,
    name: cleanText(meta.longName) ?? cleanText(meta.shortName) ?? symbol,
    price: meta.regularMarketPrice,
    changePercent: positive(close) ? (meta.regularMarketPrice - close) / close * 100 : null,
    currency: typeof meta.currency === "string" && /^[A-Z]{3}$/.test(meta.currency) ? meta.currency : null,
    timestamp: meta.regularMarketTime * 1000,
    fetchedAt: now,
    delaySeconds: typeof delay === "number" && Number.isFinite(delay) && delay >= 0 ? delay : null,
    series,
    // The same line with Yahoo's own bar times, and the exchange clock.
    points: timedPoints(day.map((b) => b.t / 1000), day.map((b) => (positive(b.close) ? b.close : null))),
    // The watchlist line: the session those bars belong to, and the first bar's open.
    session: regular,
    // Only the session's first bar's own open: never a later bar's in its place.
    firstOpen: regular && day.length && positive(day[0].open) ? { t: day[0].t, price: day[0].open } : null,
    // Every trade since the last regular close: the row's line, price and change.
    trail: yahooTrail(meta, all, regular, now, positive(close) ? close : null),
    timeZone: yahooTimeZone(meta),
    // Whether Yahoo has pre-market / after-hours data for this market: the dialog asks for it only then.
    hasPrePost: meta.hasPrePostMarketData === true,
    open: opens[0] ?? null,
    high: positive(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : highs.length ? Math.max(...highs) : null,
    low: positive(meta.regularMarketDayLow) ? meta.regularMarketDayLow : lows.length ? Math.min(...lows) : null,
    previousClose: positive(close) ? close : null,
    periods: { pre: period(periods.pre), regular: period(periods.regular), post: period(periods.post) },
  };
}

/** One request for up to BINANCE_BATCH pairs: `?symbols=["BTCUSDT","ETHUSDT"]`. */
export function binanceUrl(pairs) {
  return `${BINANCE_TICKERS}?symbols=${encodeURIComponent(JSON.stringify(pairs.map((pair) => pair.replace("/", ""))))}`;
}

/** Quotes by requested pair; a pair Binance did not return is absent. */
export function decodeBinance(pairs, response, now) {
  // -1121 Invalid symbol: one unknown or delisted pair fails the whole batch.
  if (response.status === 400) throw new QuoteError("Binance has no Spot pair with this name.", { invalidSymbol: true });
  if (response.status === 429 || response.status === 418) throw new QuoteError("Binance rate limited requests.");
  if (!response.ok) throw new QuoteError(`Binance returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Binance returned an unreadable response."); }
  const wanted = new Map(pairs.map((pair) => [pair.replace("/", ""), pair]));
  const quotes = {};
  for (const ticker of Array.isArray(body) ? body : [body]) {
    const pair = typeof ticker?.symbol === "string" ? wanted.get(ticker.symbol) : undefined;
    if (!pair) continue;
    const price = Number(ticker.lastPrice);
    // The rolling window's first price, which Binance's own 24h change is measured against.
    const close = Number(ticker.openPrice);
    const time = Number(ticker.closeTime);
    const start = Number(ticker.openTime);
    if (!positive(price) || !positive(time)) continue;
    quotes[pair] = {
      symbol: pair,
      name: "Binance Spot",
      price,
      // Against the price 24 hours before the last trade.
      changePercent: positive(close) ? (price - close) / close * 100 : null,
      currency: pair.split("/")[1],
      timestamp: time,
      windowStart: positive(start) && start < time ? start : null,
      fetchedAt: now,
      delaySeconds: 0,
      series: [],
      points: [],
      timeZone: UTC_ZONE,
      open: positive(Number(ticker.openPrice)) ? Number(ticker.openPrice) : null,
      high: positive(Number(ticker.highPrice)) ? Number(ticker.highPrice) : null,
      low: positive(Number(ticker.lowPrice)) ? Number(ticker.lowPrice) : null,
      previousClose: positive(close) ? close : null,
      periods: null,
    };
  }
  return quotes;
}

/** The last 24 hours of one pair in 15-minute bars. */
export function binanceKlinesUrl(pair) {
  return `${BINANCE_KLINES}?symbol=${encodeURIComponent(pair.replace("/", ""))}&interval=15m&limit=96`;
}

/** Closing prices, oldest first; throws when Binance answers with anything else. */
export function decodeKlines(response) {
  if (!response.ok) throw new QuoteError(`Binance returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Binance returned an unreadable response."); }
  if (!Array.isArray(body)) throw new QuoteError("Binance returned an unreadable response.");
  return cleanSeries(body.map((bar) => Array.isArray(bar) ? Number(bar[4]) : NaN));
}

/** The 24-hour line and its first kline's open: `{ points, firstOpen }` (see decodeKlinePoints). */
export function decodeKlineWindow(response) {
  const points = decodeKlinePoints(response);
  const body = JSON.parse(response.text).filter(Array.isArray);
  const first = body.find((bar) => Number(bar[0]) === (points[0]?.t ?? NaN));
  const open = first ? Number(first[1]) : NaN;
  return { points, firstOpen: points.length && positive(open) ? { t: points[0].t, price: open } : null };
}

/**
 * The same 24-hour line as decodeKlines, each close with its kline's
 * open time (UTC milliseconds). A kline without a valid open time is skipped.
 */
export function decodeKlinePoints(response) {
  if (!response.ok) throw new QuoteError(`Binance returned HTTP ${response.status}.`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new QuoteError("Binance returned an unreadable response."); }
  if (!Array.isArray(body)) throw new QuoteError("Binance returned an unreadable response.");
  const bars = body.filter(Array.isArray);
  return timedPoints(bars.map((bar) => Number(bar[0]) / 1000), bars.map((bar) => Number(bar[4])));
}

/** Where a stock's market is now: "pre", "open", "post" or "closed"; a pair trades around the clock. */
export function marketSession(quote, now) {
  if (!quote.periods) return "24h";
  const within = (range) => range && now >= range[0] && now < range[1];
  if (within(quote.periods.regular)) return "open";
  if (within(quote.periods.pre)) return "pre";
  if (within(quote.periods.post)) return "post";
  return "closed";
}

export const SESSION_LABELS = {
  open: "Market open", pre: "Pre-market", post: "After hours", closed: "Market closed", "24h": "Trades 24h",
};

/**
 * The line through `series`, scaled into its box as [x%, y%] points, and where
 * the reference price (the previous close) falls, or null when it is outside.
 * Fewer than two points draw nothing.
 */
export function chartGeometry(series, reference) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const values = positive(reference) ? [...series, reference] : series;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < max * 1e-9) { min -= 1; max += 1; }
  // 8% headroom keeps the stroke inside the box.
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const y = (value) => Math.round((1 - (value - min) / (max - min)) * 10000) / 100;
  const last = series.length - 1;
  return {
    points: series.map((value, index) => [Math.round(index / last * 10000) / 100, y(value)]),
    reference: positive(reference) ? y(reference) : null,
  };
}

// Herdr's QuickJS runtime has no Intl, so numbers and dates are formatted by hand.
const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function significant(price) {
  // Below 1, keep 2 to 4 significant digits: 0.00000441 must not round to 0.000004.
  const places = Math.min(20, 3 - Math.floor(Math.log10(price)));
  let text = price.toFixed(places);
  const count = (s) => s.replace(".", "").replace(/^0+/, "").length;
  while (text.endsWith("0") && count(text) > 2) text = text.slice(0, -1);
  return text;
}

export function formatPrice(quote) {
  const [whole, fraction] = (quote.price < 1 ? significant(quote.price) : quote.price.toFixed(2)).split(".");
  const price = group(whole) + (fraction === undefined ? "" : "." + fraction);
  return quote.currency ? `${price} ${quote.currency}` : price;
}

/** The compact band leaves out USD and a pair's own quote currency. */
export function formatBandPrice(quote) {
  const named = quote.currency === "USD" || quote.symbol.endsWith(`/${quote.currency}`);
  return formatPrice(named ? { ...quote, currency: null } : quote);
}

export function formatChange(value) {
  return value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A quote from an earlier local day gets its date, so a closed market never reads as today's. */
export function formatStaleDate(timestamp, now) {
  const quoted = new Date(timestamp);
  const today = new Date(now);
  if (quoted.getFullYear() === today.getFullYear() && quoted.getMonth() === today.getMonth()
    && quoted.getDate() === today.getDate()) return "";
  return `${MONTHS[quoted.getMonth()]} ${quoted.getDate()}`;
}

/** Local wall-clock time, 24-hour: "15:04". */
export function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
