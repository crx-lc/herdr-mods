// Local customization tests for the AllInvestView logo adapter (logosource.js) through the cache.
// Fixtures follow live search responses read on 2026-11-17.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { ALLINVESTVIEW, LOGO_SOURCES, domainOf, resolveLogo } from "../logosource.js";
import { CACHE, LogoCache } from "../logocache.js";

const SEARCH = "https://www.allinvestview.com/api/logo-search/?q=";
const CDN = "https://cdn.tickerlogos.com/";
const rows = {
  PBR: [{ symbol: "PBR", exchange: "NYQ", website: "http://petrobras.com.br/pt", name: "Petroleo Brasileiro" },
    { symbol: "PBR-A", exchange: "NYQ", website: "http://petrobras.com.br/pt" }],
  INTR: [{ symbol: "INTR", exchange: null, website: "https://inter.co", name: "Inter & Co, Inc." },
    { symbol: "INTR.TA", exchange: "TLV", website: "http://www.intergamma.co.il" }],
  "AZUL4.SA": [{ symbol: "AZUL", website: "http://www.voeazul.com.br" }, { symbol: "AZUL4.SA", exchange: "SAO", website: "http://www.voeazul.com.br" }],
  "ETH-USD": [{ symbol: "ETH-USD", exchange: null, website: "https://ethereum.org/", name: "Ethereum USD" },
    { symbol: "WBETH-USD", website: "https://www.binance.com/en/wbeth" }],
  "XTZ-USD": [{ symbol: "XTZ-EUR", website: "https://tezos.com/" }, { symbol: "XTZ-USD", website: "https://tezos.com/" }],
  NOSITE: [{ symbol: "NOSITE", website: "nan" }],
  ETH: [{ symbol: "ETH", exchange: "NYQ", website: "http://www.ethanallen.com" }],
};
const host = (extra = {}) => ({
  searches: [],
  async fetchText(url) {
    this.searches.push(url);
    const q = decodeURIComponent(url.slice(SEARCH.length));
    if (extra.fail) throw new Error("network down");
    return JSON.stringify(rows[q] ?? []);
  },
});

test("AllInvestView, then Elbstream for what AllInvestView declines; AIV link has no minimum size", () => {
  assert.deepEqual(LOGO_SOURCES.map((s) => s.id), ["allinvestview", "elbstream"]);
  assert.deepEqual(ALLINVESTVIEW.attribution, {
    text: "Logos by AllInvestView ↗", url: "https://www.allinvestview.com/tools/ticker-logos/", minPx: null,
  });
});

test("which symbols it handles: listings and pairs, not indices or FX/futures", () => {
  for (const s of ["PBR", "AZUL4.SA", "BRK-B", "0700.HK", "XTZ/USDT"]) assert.equal(resolveLogo(s)?.key, `allinvestview:${s}`, s);
  for (const s of ["^GSPC", "EURUSD=X", "CL=F", "", undefined, "nu"]) assert.equal(resolveLogo(s), null, String(s));
});

test("stocks: the search row with exactly the symbol, its website domain, the CDN", async () => {
  assert.equal(await ALLINVESTVIEW.imageUrl("PBR", host()), `${CDN}petrobras.com.br`);
  assert.equal(await ALLINVESTVIEW.imageUrl("INTR", host()), `${CDN}inter.co`, "not Inter Gamma (INTR.TA)");
  assert.equal(await ALLINVESTVIEW.imageUrl("AZUL4.SA", host()), `${CDN}voeazul.com.br`, "a B3 listing by its own symbol");
});

test("crypto: BASE-USD's row, never a same-named stock", async () => {
  const h = host();
  assert.equal(await ALLINVESTVIEW.imageUrl("ETH/USDT", h), `${CDN}ethereum.org`, "not Ethan Allen (ETH)");
  assert.equal(await ALLINVESTVIEW.imageUrl("XTZ/USDT", h), `${CDN}tezos.com`);
  assert.deepEqual(h.searches, [`${SEARCH}ETH-USD`, `${SEARCH}XTZ-USD`]);
});

test("corrections: GOOG/GOOGL → google.com without a search; MSTR/STRC declined, so Elbstream's ₿ square", async () => {
  const h = host();
  assert.equal(ALLINVESTVIEW.lookup("MSTR"), null);
  assert.equal(ALLINVESTVIEW.lookup("STRC"), null);
  assert.equal(resolveLogo("MSTR").source.id, "elbstream");
  assert.equal(resolveLogo("MSTR").url, "https://api.elbstream.com/logos/symbol/MSTR");
  assert.equal(resolveLogo("STRC").url, "https://api.elbstream.com/logos/symbol/MSTR", "the issuer's icon");
  assert.equal(resolveLogo("MSFT").source.id, "allinvestview", "Elbstream only where AllInvestView declines");
  assert.equal(await ALLINVESTVIEW.imageUrl("GOOG", h), `${CDN}google.com`);
  assert.equal(await ALLINVESTVIEW.imageUrl("GOOGL", h), `${CDN}google.com`);
  assert.deepEqual(h.searches, []);
});

test("no exact row, or no usable website: no logo (monogram), never a neighbour's", async () => {
  assert.equal(await ALLINVESTVIEW.imageUrl("NOSITE", host()), null, "website 'nan'");
  assert.equal(await ALLINVESTVIEW.imageUrl("ZZZZ", host()), null, "nothing found");
  assert.equal(await ALLINVESTVIEW.imageUrl("PBR-B", host()), null, "PBR-A is not PBR-B");
});

test("domains are cleaned and checked", () => {
  assert.equal(domainOf("http://www.bb.com.br"), "bb.com.br");
  assert.equal(domainOf("https://ethereum.org/"), "ethereum.org");
  assert.equal(domainOf("http://petrobras.com.br/pt"), "petrobras.com.br");
  assert.equal(domainOf("HTTPS://WWW.Microsoft.com:443/x"), "microsoft.com");
  for (const bad of ["nan", "", null, "ftp://x.com", "http://localhost", "http://a b.com", "javascript:alert(1)"]) assert.equal(domainOf(bad), null, String(bad));
});

// Through the cache: search, then the CDN image, stored and attributed to AllInvestView.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 128, 0, 0, 0, 128, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
function cacheHost(images = {}, search = host()) {
  const files = new Map();
  const h = {
    dir: "/c", rel: "mods/quotr/.cache/logos", clock: 1_800_000_000_000, downloads: [], files,
    fetchText: (u) => search.fetchText(u),
    readFile: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
    readText: async (p) => (files.has(p) ? String(files.get(p)) : null),
    writeFile: async (p, v) => { files.set(p, v); },
    copyFile: async (a, b) => { files.set(b, files.get(a)); },
    exists: async (p) => files.has(p), mkdir: async () => {}, unlink: async (p) => { files.delete(p); },
    now: () => h.clock,
    download: async (u, to) => { h.downloads.push(u); const body = images[u]; if (!body) return { status: 404, contentType: "text/plain" }; files.set(to, body); return { status: 200, contentType: "image/png" }; },
  };
  return h;
}

test("cache: search → CDN → stored file, attributed to AllInvestView, drawn on a backdrop (alpha PNG)", async () => {
  const h = cacheHost({ [`${CDN}petrobras.com.br`]: PNG });
  const c = new LogoCache(h);
  await c.load();
  assert.equal(c.needs("PBR", h.clock), true);
  assert.equal(await c.refresh("PBR"), true);
  assert.deepEqual(h.downloads, [`${CDN}petrobras.com.br`]);
  assert.match(c.pathFor("PBR"), /PBR-[a-z0-9]+\.png$/);
  assert.equal(c.sourceFor("PBR"), ALLINVESTVIEW);
  assert.equal(c.isOpaque("PBR"), false, "RGBA: shown on the white backdrop");
  assert.equal(c.needs("PBR", h.clock + 365 * 86_400_000), false, "present: never fetched again");
});

test("cache: a symbol without a logo waits hours; a failed search is transient", async () => {
  const none = cacheHost();
  const c = new LogoCache(none);
  await c.load();
  assert.equal(await c.refresh("ZZZZ"), false);
  assert.match(c.index.ZZZZ.error, /AllInvestView has no logo/);
  assert.equal(c.needs("ZZZZ", none.clock + 60_000), false);
  assert.equal(c.needs("ZZZZ", none.clock + CACHE.retryMs), true);
  const down = cacheHost({}, host({ fail: true }));
  const d = new LogoCache(down);
  await d.load();
  assert.equal(await d.refresh("PBR"), false);
  assert.equal(d.index.PBR.transient, true);
  assert.equal(d.needs("PBR", down.clock + CACHE.transientRetryMs), true, "tried again with the next round");
  assert.deepEqual(down.downloads, [], "no image request without a domain");
});

test("cache: switching sources replaces old Elbstream entries with AllInvestView ones", async () => {
  const h = cacheHost({ [`${CDN}inter.co`]: PNG });
  h.files.set("/c/index.json", JSON.stringify({ INTR: { file: "INTR.png", url: "https://api.elbstream.com/logos/symbol/INTR", source: "elbstream" } }));
  h.files.set("/c/INTR.png", PNG);
  const c = new LogoCache(h);
  await c.load();
  assert.equal(c.pathFor("INTR"), null, "an Elbstream file isn't shown while AllInvestView is active");
  assert.equal(c.needs("INTR", h.clock), true);
  await c.refresh("INTR");
  assert.equal(c.sourceFor("INTR"), ALLINVESTVIEW);
  assert.equal(h.files.has("/c/INTR.png"), false, "the old file is removed");
});

test("drawing style: raster with alpha full size on a backdrop, transparent SVG glyph inset, opaque as is", async () => {
  const h = cacheHost({ [`${CDN}inter.co`]: PNG });
  const c = new LogoCache(h);
  await c.load();
  await c.refresh("INTR");
  assert.equal(c.logoStyle("INTR"), "backdrop", "an RGBA PNG tile: full size, white behind");
  c.index.INTR.opaque = true;
  assert.equal(c.logoStyle("INTR"), "full");
  c.index.INTR.opaque = false;
  c.index.INTR.file = "INTR-abc.svg";
  assert.equal(c.logoStyle("INTR"), "inset", "a bare vector glyph");
  assert.equal(c.logoStyle("NOPE"), null);
});

// --- Bitcoin: from the two online sources, like any other coin ---
test("BTC pairs come from AllInvestView in Auto, with Elbstream's crypto/BTC as the alternative", () => {
  for (const s of ["BTC/USDT", "BTC/BRL"]) assert.equal(resolveLogo(s).source, ALLINVESTVIEW, s);
  assert.equal(resolveLogo("BTC/USDT", LOGO_SOURCES, "elbstream").url, "https://api.elbstream.com/logos/crypto/BTC");
  assert.equal(LOGO_SOURCES.some((s) => s.localPath), false, "no files shipped with the mod");
});
