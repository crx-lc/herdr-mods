// Local customization (not part of upstream Pulse): where asset logos come from. No Herdr imports,
// so `node --test` runs it.
//
// A logo source is an adapter:
//   {
//     id:          short stable name, stored with each cached file,
//     name:        shown to people,
//     attribution: { text, url, minPx } | null   // shown wherever one of its logos is visible,
//     lookup(symbol) → key | null                 // sync: does this source handle the symbol? (stable key)
//     imageUrl?(symbol, host) → https URL | null  // async, optional: when the image URL needs a lookup
//                                                 // first (host.fetchText); without it the key IS the URL
//   }
// LOGO_SOURCES is tried in order; the first source with a key wins. To attach another source, write
// one more adapter and put it in the list: the cache, the fallback monogram and the attribution
// follow it without other changes.

const own = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
const PAIR = /^([A-Z0-9]{1,20})\/[A-Z0-9]{1,20}$/;
// Stocks, ADRs, ETFs, exchange-suffixed listings; not indices (^) or FX/futures (=): no logo for those.
const LISTING = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/;

/**
 * AllInvestView Ticker Logos (https://www.allinvestview.com/tools/ticker-logos/): the active source,
 * chosen by the owner on 2026-11-17. Read on that date:
 *   - "Ticker Logos requires no API key, no signup, and no registration." Free for personal use.
 *   - FAQ: "You may cache or proxy logos on your own servers for performance. A visible dofollow
 *     attribution link to AllInvestView is still required when using cached logos."
 *   - Terms (https://www.allinvestview.com/tools/ticker-logos/terms/, Feb 2026): a "visible attribution
 *     link" to the Ticker Logos page wherever its logos show (no minimum size stated); "Do not modify,
 *     distort, or alter logos"; "Do not ... bulk-download logos". Logos are fetched one per symbol, on
 *     demand, and stored unmodified.
 *   - Limits: CDN 20,000 requests a day per IP; search 60 a minute per IP.
 * How it resolves: the CDN is keyed by company website domain (cdn.tickerlogos.com/{domain}); the
 * search API maps a symbol to that domain. Its symbols are Yahoo-style (AZUL4.SA, MSFT34.SA), so:
 *   - Yahoo symbol            → search the symbol, take the row with exactly that symbol
 *   - Binance pair BASE/QUOTE → search "BASE-USD", take that exact row (ETH-USD → ethereum.org)
 *   - indices and FX/futures  → no request, monogram
 *   - no exact row, or no website on it → no logo (monogram; asked again hours later)
 */
// The only list to edit for AllInvestView: a symbol → the domain to use instead (or null for the
// monogram) when its automatic choice is wrong. Each was looked at on 2026-11-17.
const AIV_CORRECTIONS = {
  // Strategy: microstrategy.com is a promo banner and strategy.com a wide wordmark, both tiny in a tile;
  // the owner chose Elbstream's square ₿ icon (2026-11-17), so AllInvestView declines these two.
  MSTR: null,
  STRC: null, // Strategy's preferred: its issuer's logo
  GOOG: "google.com",   // abc.xyz is the "Alphabet" wordmark, unreadable at icon size
  GOOGL: "google.com",
};

/** The bare domain of a website URL ("http://www.bb.com.br/" → "bb.com.br"), or null. */
export function domainOf(website) {
  const m = /^https?:\/\/([^/:?#\s]+)/i.exec(String(website ?? "").trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

export const ALLINVESTVIEW = {
  id: "allinvestview",
  name: "AllInvestView",
  search: "https://www.allinvestview.com/api/logo-search/?q=",
  cdn: "https://cdn.tickerlogos.com/",
  attribution: { text: "Logos by AllInvestView ↗", url: "https://www.allinvestview.com/tools/ticker-logos/", minPx: null },
  corrections: AIV_CORRECTIONS,
  lookup(symbol, { explicit = false } = {}) {
    const s = String(symbol ?? "");
    // A correction of null declines the symbol in Auto; chosen explicitly, it is looked up normally.
    if (own(AIV_CORRECTIONS, s) && AIV_CORRECTIONS[s] === null && !explicit) return null;
    return PAIR.test(s) || LISTING.test(s) ? `allinvestview:${s}` : null;
  },
  /** The CDN URL for `symbol`, via the search API (host.fetchText) unless corrected; null = no logo. */
  async imageUrl(symbol, host) {
    const s = String(symbol ?? "");
    if (own(AIV_CORRECTIONS, s) && AIV_CORRECTIONS[s]) return ALLINVESTVIEW.cdn + AIV_CORRECTIONS[s];
    const pair = PAIR.exec(s);
    const want = pair ? `${pair[1]}-USD` : s;
    const text = await host.fetchText(ALLINVESTVIEW.search + encodeURIComponent(want));
    let rows;
    try { const body = JSON.parse(text); rows = Array.isArray(body) ? body : body?.results ?? body?.data ?? []; } catch { rows = []; }
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => r && String(r.symbol ?? "").toUpperCase() === want);
    const domain = domainOf(row?.website);
    return domain ? ALLINVESTVIEW.cdn + domain : null;
  },
};

/**
 * Elbstream (https://elbstream.com/logos): kept, not active (owner, 2026-11-17: its required 12 pt
 * attribution link looked bad). Put it back in LOGO_SOURCES to use it again.
 * Terms (https://elbstream.com/terms, 2025-06-09): "intended for business customers only"; Logo API
 * "free to use with proper attribution"; "you must link back to Elbstream on any page where a logo is
 * shown", "minimum font size of 12 points"; own caching is listed under its Enterprise tier.
 * Rules: pair BASE/QUOTE → crypto/BASE; Yahoo symbol → symbol/SYMBOL; indices and FX/futures: none.
 * Known limit: the bare-ticker lookup can return another company that once used a ticker
 * (symbol/STRC is a different company's blue "S"); CORRECTIONS fixes such cases.
 */
const CORRECTIONS = {
  // Strategy's Variable Rate Series A Perpetual Stretch Preferred: its issuer's logo (checked 2026-11-17).
  STRC: "symbol/MSTR",
};

// Elbstream lookups checked by looking at the image on 2026-11-17.
export const CHECKED = ["crypto/BTC", "symbol/INTR", "symbol/AZUL", "symbol/PBR", "symbol/BDORY", "symbol/MSTR",
  "symbol/NU", "symbol/NVDA", "symbol/MSFT", "symbol/NFLX"];

/** The Elbstream lookup path for a normalized watchlist symbol, or null for a monogram. */
export function elbstreamLookup(symbol) {
  const s = String(symbol ?? "");
  if (own(CORRECTIONS, s)) return CORRECTIONS[s];
  const pair = PAIR.exec(s);
  if (pair) return `crypto/${pair[1]}`;
  if (LISTING.test(s)) return `symbol/${encodeURIComponent(s)}`;
  return null;
}

export const ELBSTREAM = {
  id: "elbstream",
  name: "Elbstream",
  api: "https://api.elbstream.com/logos/",
  // Elbstream asks for at least 12 pt; the owner chose the small footer size anyway (2026-11-17).
  attribution: { text: "Logos by Elbstream ↗", url: "https://elbstream.com", minPx: null, termsMinPx: 16 },
  corrections: CORRECTIONS,
  lookup(symbol) {
    const path = elbstreamLookup(symbol);
    return path ? ELBSTREAM.api + path : null;
  },
};

/**
 * Local: icon files shipped with the mod (mods/quotr/logos-local/), used before any download source.
 * Only for assets whose online logo is a wide wordmark that is unreadable at icon size.
 *   - Bitcoin (any BTC/… pair): btc.svg from cryptocurrency-icons 0.18.1 (npm), CC0-1.0, unmodified,
 *     sha256 5a8131ecdf855b12cb56080aeeeefea266976529c45b2d58c284a13b7519f4ca (see logos-local/SOURCES.md).
 * No requests, no attribution (public domain).
 */
const LOCAL_FILES = {
  "crypto:BTC": { path: "mods/quotr/logos-local/btc.svg", style: "full" },
};

function localKey(symbol) {
  const s = String(symbol ?? "");
  const pair = PAIR.exec(s);
  const key = pair ? `crypto:${pair[1]}` : `stock:${s}`;
  return own(LOCAL_FILES, key) ? key : null;
}

export const LOCAL = {
  id: "local",
  name: "Bundled",
  attribution: null,
  files: LOCAL_FILES,
  lookup(symbol) {
    const key = localKey(symbol);
    return key ? `local:${key}` : null;
  },
  /** The shipped file for `symbol` (relative to the Herdr home), or null. */
  localPath(symbol) {
    const key = localKey(symbol);
    return key ? LOCAL_FILES[key].path : null;
  },
  styleFor(symbol) {
    const key = localKey(symbol);
    return key ? LOCAL_FILES[key].style : null;
  },
};

// Active sources, in order: shipped files, then AllInvestView, then Elbstream only for what AllInvestView
// declines (its corrections set to null: MSTR, STRC). Elbstream's 16 px link shows only while one of its
// logos is on screen.
export const LOGO_SOURCES = [LOCAL, ALLINVESTVIEW, ELBSTREAM];
export const ALL_SOURCES = [LOCAL, ALLINVESTVIEW, ELBSTREAM];

/**
 * { source, key, url } from the first source that handles this symbol, or null (the monogram).
 * `key` identifies what is cached; `url` is the image URL when known without a lookup (else the key).
 */
export function resolveLogo(symbol, sources = LOGO_SOURCES, choice) {
  // A per-ticker choice (owner's, from the dialog): "none" = monogram; a source id = that source only,
  // asked explicitly; "auto", unset, or a source that can't handle the ticker = the usual order.
  if (choice === "none") return null;
  if (choice && choice !== "auto") {
    const chosen = ALL_SOURCES.find((s) => s.id === choice);
    const key = chosen?.lookup(symbol, { explicit: true });
    if (typeof key === "string" && key && !(/^https?:/i.test(key) && !key.startsWith("https://"))) {
      return { source: chosen, key, url: key, chosen: true };
    }
  }
  for (const source of sources) {
    const key = source.lookup(symbol);
    if (typeof key !== "string" || !key) continue;
    if (/^https?:/i.test(key) && !key.startsWith("https://")) continue; // a plain-http URL: refused
    return { source, key, url: key };
  }
  return null;
}

/** The sources a ticker can be shown from, for the dialog's choice (explicit lookups). */
export function sourcesFor(symbol) {
  return ALL_SOURCES.filter((s) => {
    const key = s.lookup(symbol, { explicit: true });
    return typeof key === "string" && key.length > 0;
  });
}

export function sourceById(id, sources = ALL_SOURCES) {
  return sources.find((s) => s.id === id) ?? null;
}

/**
 * Local customization: the source "Change" switches a ticker to: the one after the source it would be
 * shown from now (its choice, or Auto's pick), among `sources` (those that can show it), wrapping round.
 */
export function nextLogoSource(symbol, sources = sourcesFor(symbol), choice) {
  if (!sources.length) return "auto";
  const now = resolveLogo(symbol, LOGO_SOURCES, choice)?.source.id;
  const i = sources.findIndex((s) => s.id === now);
  return sources[(i + 1) % sources.length].id;
}
