# Herdr Quotr

A stock and crypto watchlist panel for [Herdr](https://herdr.dev): live quotes with logos and
sparklines, price-tick flashes, and a detail dialog with history, hover readouts and pre/post-market
data for US stocks.

## Based on Pulse

> **Quotr is based on [Pulse](https://github.com/fatwang2/Pulse) by [fatwang2](https://github.com/fatwang2).**
> It started as a copy of Pulse's Herdr mod,
> [`herdr/pulse`](https://github.com/fatwang2/Pulse/tree/main/herdr/pulse), at commit
> [`99f70b2c`](https://github.com/fatwang2/Pulse/tree/99f70b2c066c6f03657639bf44bf3cecd6e1bb43/herdr/pulse).

Pulse is MIT-licensed. Its copyright notice and license are kept in
[`LICENSE-PULSE.txt`](LICENSE-PULSE.txt) because parts of its code remain, mainly in `main.js`,
`quotes.js` and `watchlist.js`. Quotr's own changes are under this repository's MIT license.
Not taken from Pulse: its name, its icon (Quotr has its own `icon.svg`) and its "Pulse for Mac"
promotion, which was removed.

## What Quotr changes

Compared with Pulse at `99f70b2c`:

**Detail dialog**
- 1D · 1W · 1M · 1Y ranges (`history.js`): period change from the first to the last point, period
  high and low, trading-session count, and notes when a period is partial or ends early.
- Hover readout on every chart (`readout.js`): the nearest real point's date, time and timezone (the
  exchange's own offsets from Yahoo; UTC for Binance), price and session.
- Pre-market and after-hours for US stocks (`extended.js`): latest extended price, its time and change
  against the regular close, shaded sessions on the 1D chart, and clear notes when data is stale,
  missing or inconsistent. Markets without extended data are labeled as such.
- A logo line, "Logo by … ↗ · Change": the source's attribution link, and a button that cycles the
  ticker through the logo sources that can show it.

**Panel and refresh**
- Last values stay visible during a refresh, with a small updating dot per row; quotes are restored
  from local storage after a reload or restart; failures show "Stale · last updated HH:MM".
- Price ticks: a short green/red flash and a ▲/▼ since the previous quote (`ticks.js`).
- Faster refresh: Binance and Yahoo side by side; Yahoo at most two requests at a time, starts 500 ms
  apart (Pulse: one at a time, 1 s apart), with Pulse's rate-limit backoff kept.
- Reorder mode (top / up / down / bottom), saved with the watchlist.
- Asset logos at the start of each row, with a monogram fallback.

**Logos** (`logosource.js`, `logocache.js`)
- Source adapters, tried in order: files shipped with the mod (`logos-local/`, today the Bitcoin
  coin), then AllInvestView Ticker Logos, then Elbstream where AllInvestView declines a symbol.
- Automatic rules, no per-ticker setup: stocks by their exact Yahoo symbol, crypto pairs by base asset;
  indices and FX/futures get a monogram and no request. A corrections table handles known mismatches.
- Downloaded once into the mod's `.cache/` (Herdr's `image()` takes local files only), checked before
  use, never fetched again while present; Refresh re-downloads them one at a time. Transparent logos
  get a white backdrop.
- The footer credits each source with a count ("11 logos by AllInvestView ↗").

**Other**
- Links open on Windows through the system URL handler when `open` is missing.
- Watchlist and logo choices saved under `quotr.*` keys; Pulse's saved watchlist is copied over once.

## Installing and updating

From this repository: `node scripts/sync.mjs install quotr` (see the [root README](../../../README.md)),
or copy this folder to `~/.config/herdr-app/mods/quotr/`. Then
`herdr-app check ~/.config/herdr-app/mods/quotr` and open it as a panel:
`herdr-app do pane.split '{"direction":"right","mod":"quotr"}'`.

## Configuration

- **Watchlist:** add tickers in the panel (Yahoo symbols such as `AAPL`, `PETR4.SA`, `0700.HK`, or
  Binance pairs such as `BTC/USDT`); remove with ×; Reorder; Pause.
- **Logo source per ticker:** Change in the ticker's dialog. Defaults and corrections live in
  `logosource.js` (`LOGO_SOURCES`, `AIV_CORRECTIONS`, `CORRECTIONS`, `LOCAL_FILES`).
- **Keys:** `quotr.refresh` and `quotr.pause` can be bound in Herdr's `keys.json`.

## Data sources and limits

- **Quotes:** Yahoo Finance's chart endpoint (unofficial, may be rate-limited or unavailable in some
  regions; regular-session prices with exchange delays, plus extended hours for US stocks where Yahoo
  has them) and Binance Spot public market data (24-hour change).
- **Logos:** AllInvestView Ticker Logos (attribution link required; caching allowed by its FAQ; logos
  must not be modified) and Elbstream (its terms describe the API as for business customers, ask for a
  12 pt attribution link and list own caching under its Enterprise tier; this mod shows a smaller link
  and caches locally, by its author's choice). Check each source's current terms before relying on it.
- **Shipped logo:** `logos-local/btc.svg`, CC0-1.0 (see `logos-local/SOURCES.md`).
- Logos remain their owners' trademarks and are shown only to identify each asset. No price data is
  guaranteed accurate or real-time.

## Tests

`node --test .tests` in this folder, plus `herdr-app check` on the installed copy.
