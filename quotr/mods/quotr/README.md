# Herdr Quotr

A stock and crypto watchlist panel for [Herdr](https://herdr.dev): live quotes with logos and
sparklines, price-tick flashes, and a detail dialog with history, hover readouts and pre/post-market
data for US stocks.

## Install

Open an agent in Herdr and ask it:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/crx-lc/herdr-mods/tree/main/quotr
```

The agent reads the mod's files, tells you what it reaches (see [Data sources and limits](#data-sources-and-limits))
and installs it without touching your other mods. To install by hand, see
[Installing and updating](#installing-and-updating).

## Preview

![Herdr Quotr panel with a New York market clock, stock and crypto quotes, logos and sparklines](https://raw.githubusercontent.com/crx-lc/herdr-mods/main/quotr/preview.png)

An example watchlist from the running mod. Prices and market status are a snapshot, not live data.
The screenshot is illustrative; it does not set the default watchlist.

## Based on Pulse

> **Quotr is based on [Pulse](https://github.com/fatwang2/Pulse) by [fatwang2](https://github.com/fatwang2).**
> It started as a copy of Pulse's Herdr mod,
> [`herdr/pulse`](https://github.com/fatwang2/Pulse/tree/main/herdr/pulse), at commit
> [`99f70b2c`](https://github.com/fatwang2/Pulse/tree/99f70b2c066c6f03657639bf44bf3cecd6e1bb43/herdr/pulse).

Pulse is MIT-licensed. Its copyright notice and license are kept in
[`LICENSE-PULSE.txt`](LICENSE-PULSE.txt) because parts of its code remain, mainly in the view files
(`main.js`, `charts.js`, `dialog.js`), `quotes.js` and `watchlist.js`. Quotr's own changes are under this repository's MIT license.
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
- Each row's 56×22 chart is a small version of the dialog's 1D chart: the line in the color of
  the row's percentage over a faint fill, and a dashed line at the price that percentage is
  measured against: a stock's previous regular close, a pair's price 24 hours ago (Binance's own
  24h open). The reference is part of the vertical scale, so an opening gap reads as the line sitting
  well above or below it even when the session then trades flat; the scale spans at least 1% of the
  reference, so small moves stay small.
- A stock's chart is its latest regular session, placed by time across the session (a
  half-finished day fills part of the width). The price and percentage beside it are the latest
  trade, pre-market and after hours included, with `Pre-market` or `After hours` under the name
  once that price differs from the close (Yahoo's after-hours bars often just repeat it); the dashed line is always the close that percentage is measured against: the
  previous regular close, and from the next day's first pre-market trade on, the session's own
  close (where its line ends), so evenings and weekends keep the last day. Without a previous close
  the row shows the latest trade with `—` for the change and no dashed line. The dialog is
  unchanged: the regular session and its own extended-hours section.
- A pair's chart spans its rolling 24h by time: the first kline's open, every finished kline's
  close at its end, and the quote.
- Only observed prices are drawn, and consecutive ones are joined: a stretch with no trade (a quiet
  stock, a missing kline) is a straight segment from one trade to the next, not a blank. That is the
  owner's choice for the row; thin tickers would otherwise break into dots.
- The displayed quote always ends the line. A bar or kline still forming at the quote's time is
  left out: its close was read at another moment, so it could end the line on the wrong side of
  the dashed reference. Missing reference: no dashed line, the line in `dim`. One price: a dot. A
  stale or failed quote dims the chart.
- Resting on the chart shows one line, for example `Regular 09:30–16:00 EST · vs prev close 354.07 USD`
  or `Last 24h · vs 60,115.22 USDT 24h ago`. Clicking it opens the dialog like the rest of the row.
- A New York market clock under the title (`marketclock.js`, `clockview.js`): New York time, the
  US regular session's state (Open, Pre-market, After-hours, Closed, Weekend, Holiday) and its next
  open or close with a live countdown ("NY Tue Nov 17 15:42 · Open · Closes 16:00 · 18m"), early closes included.
  It runs on its own timer, apart from the quote refresh. Without a current schedule it shows the time
  and "Market schedule unavailable", never a guessed countdown. The one-line band shows it shortened.
- Quotes refresh every 60 seconds while unpaused. The market clock keeps running independently.
- Last values stay visible during a refresh, with a small updating dot per row; quotes are restored
  from local storage after a reload or restart; failures show "Stale · last updated HH:MM".
- Price ticks: a short green/red flash and a ▲/▼ since the previous quote (`ticks.js`).
- Faster refresh: Binance and Yahoo side by side; Yahoo at most two requests at a time, starts 500 ms
  apart (Pulse: one at a time, 1 s apart), with Pulse's rate-limit backoff kept.
- Reorder mode (top / up / down / bottom), saved with the watchlist.
- Asset logos at the start of each row, with a monogram fallback.

**Logos** (`logosource.js`, `logocache.js`)
- Two sources: AllInvestView Ticker Logos is the default for every ticker; Elbstream is the
  alternative, chosen per ticker with **Change** in its dialog. There is no automatic failover: a
  failed download or an empty search result leaves the monogram until you switch the source.
- Automatic rules, no per-ticker setup: stocks by their exact Yahoo symbol, crypto pairs by base asset;
  indices and FX/futures get a monogram and no request. A corrections table handles known mismatches.
- Downloaded once into the mod's `.cache/` (Herdr's `image()` takes local files only), checked before
  use and reused during automatic quote refreshes. Manual Refresh queues re-downloads one at a time,
  skipping logos fetched within the last minute; quotes do not wait for them. A failed download keeps
  the previous good file when available. Transparent logos get a white backdrop.
- The footer credits each source with a count ("11 logos by AllInvestView ↗").

**Other**
- External links open on macOS (`open`), Windows (the system URL handler) and Linux (`xdg-open`,
  then `gio open`), chosen by platform, without a shell and only for https URLs (`opener.js`). If no
  opener works, the link simply doesn't open.
- Watchlist and logo choices saved under `quotr.*` keys; Pulse's saved watchlist is copied over once.

## Installing and updating

With an agent: the prompt under [Install](#install); ask the same again to update. From a clone of this repository: `node scripts/sync.mjs install quotr` (see the [root README](../../../README.md)),
or copy this folder to `~/.config/herdr-app/mods/quotr/`. Then
`herdr-app check ~/.config/herdr-app/mods/quotr` and open it as a panel:
`herdr-app do pane.split '{"direction":"right","mod":"quotr"}'`.

## Configuration

- **First launch:** without saved Quotr or Pulse state, the starter list is AAPL, NVDA, ^GSPC and
  BTC/USDT. A deliberately saved empty list stays empty. Existing Pulse watchlist and logo preferences
  are migrated once when the corresponding Quotr state is absent.
- **Watchlist:** add tickers in the panel (Yahoo symbols such as `AAPL`, `PETR4.SA`, `0700.HK`, or
  Binance pairs such as `BTC/USDT`); remove with ×; Reorder; Pause.
- **Logo source per ticker:** open the asset's detail dialog and click **Change** to cycle through its
  eligible sources. The choice is saved per ticker and shared by panels using the same Herdr state.
  No choice means Auto. The current button cycles sources, not arbitrary image URLs or an Auto/None
  menu. Defaults and corrections live in logosource.js.
- **Storage:** watchlist and logo choices use persisted Herdr shared state (quotr.watchlist.v1,
  quotr.logos.v1); quote snapshots and the market schedule use localStorage. Downloaded logos live
  in the mod's excluded .cache/ directory. Installing the source does not replace that saved state.
- **Keys:** `quotr.refresh` and `quotr.pause` can be bound in Herdr's `keys.json`.

## Data sources and limits

- **Quotes:** Yahoo Finance's chart endpoint (unofficial, may be rate-limited or unavailable in some
  regions; prices with exchange delays, extended hours included for US stocks where Yahoo has
  them) and Binance Spot public market data (24-hour change).
- **Online logo sources:** [AllInvestView Ticker Logos](https://www.allinvestview.com/tools/ticker-logos/)
  and [Elbstream](https://elbstream.com/logos). These are the two online sources currently supported.
  Source adapters make it easy to add others without changing the panel. See the logo selection and per-ticker settings above.
- **Market clock scope:** the Nasdaq schedule represents US market sessions, not the trading hours of
  every symbol in the watchlist. Crypto trades around the clock and other exchanges have their own hours.
- **Market schedule:** Nasdaq's public market-info endpoint (undocumented, the one behind
  nasdaq.com's market status), refreshed on a New York date change and every 3 hours while the panel is
  open. Failed requests retry with backoff; the client can fall back from fetch to curl. Schedules older
  than 24 hours are not trusted. It gives each day's hours and the next trading date; the next day's
  open is taken as 09:30 ET. New York time follows the US daylight-saving rule in force since 2007
  (Herdr's runtime has no time-zone data). "Regular closed" means only the regular session is known
  closed; the official holiday calendar is at [nasdaqtrader.com](https://www.nasdaqtrader.com/trader.aspx?id=Calendar).
- Logos remain their owners' trademarks and are shown only to identify each asset. No price data is
  guaranteed accurate or real-time.

## Requirements and tests

Use Herdr with its mod API. curl must be available for logo downloads and the market-schedule
fallback. External links use the platform's opener (see above). Node.js is needed for this
repository's sync script and tests, not for running the installed mod.

From the repository root, run `npm test`.
From this mod's directory, run `node --test ".tests/*.test.mjs"`. Both need Node 22 or later.

Run `herdr-app check` on the installed copy for a render/load check. Automated tests do not guarantee
that the external quote, schedule or logo services are available.
