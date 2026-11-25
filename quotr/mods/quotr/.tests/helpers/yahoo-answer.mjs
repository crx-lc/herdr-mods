// Yahoo's two-day chart answer with extended hours, built for tests. Neutral sample data.
import { decodeYahoo } from "../../quotes.js";

export const H = 3_600_000, M = 60_000, BAR = 5 * M;
export const TUE = Date.UTC(2026, 10, 24), WED = TUE + 24 * H, THU = WED + 24 * H;
// US sessions in UTC (EST): pre 04:00–09:30, regular 09:30–16:00, post 16:00–20:00.
export const sessions = (d) => ({ pre: [d + 9 * H, d + 14.5 * H], regular: [d + 14.5 * H, d + 21 * H], post: [d + 21 * H, d + 25 * H] });
const sec = (ms) => ms / 1000;

/**
 * Yahoo's chart answer for `days` (two trading days), bars every 5 minutes up to `now`, priced by
 * `price(day, session, t)`. `extended: false` is a market with only regular hours (an index).
 * `drop(t)` leaves bars out (missing data); `periodDays` limits the trading periods Yahoo lists.
 */
export function answer({ days, now, price, previousClose = 100, extended = true, regularClose, drop = () => false, periodDays = days }) {
  const timestamp = [], close = [], open = [];
  for (const d of days) {
    const s = sessions(d);
    for (const name of extended ? ["pre", "regular", "post"] : ["regular"]) {
      for (let t = s[name][0]; t < s[name][1] && t <= now; t += BAR) {
        if (drop(t)) continue;
        timestamp.push(sec(t)); close.push(price(d, name, t)); open.push(price(d, name, t));
      }
    }
  }
  const regulars = days.map((d) => sessions(d).regular).filter((r) => r[0] <= now);
  const latest = regulars.at(-1);
  const regularBars = timestamp.map((s, i) => [s * 1000, close[i]]).filter(([t]) => t >= latest[0] && t < latest[1]);
  const regularMarketPrice = now >= latest[1] && regularClose ? regularClose : regularBars.at(-1)[1];
  const period = ([start, end]) => [{ timezone: "EST", start: sec(start), end: sec(end), gmtoffset: -18_000 }];
  const tradingPeriods = extended
    ? { pre: periodDays.map((d) => period(sessions(d).pre)), regular: periodDays.map((d) => period(sessions(d).regular)), post: periodDays.map((d) => period(sessions(d).post)) }
    : periodDays.map((d) => period(sessions(d).regular));
  const meta = { symbol: "SAMPLE", currency: "USD", regularMarketPrice, regularMarketTime: sec(Math.min(now, latest[1])),
    previousClose, chartPreviousClose: 77, hasPrePostMarketData: extended, gmtoffset: -18_000, timezone: "EST", tradingPeriods,
    currentTradingPeriod: { regular: { start: sec(sessions(days.at(-1)).regular[0]), end: sec(sessions(days.at(-1)).regular[1]) } } };
  return decodeYahoo("SAMPLE", { status: 200, ok: true, text: JSON.stringify({ chart: { result: [{ meta, timestamp, indicators: { quote: [{ close, open }] } }] } }) }, now);
}

