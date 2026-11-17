// Tests for the logo cache (logocache.js) over the sources in logosource.js.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { CACHE, LogoCache, sniffImage } from "../logocache.js";
import { ELBSTREAM, resolveLogo } from "../logosource.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><rect width="60" height="60" fill="#FA660F"/></svg>');
const HTML = new TextEncoder().encode("<html><body>Service unavailable</body></html>");
const ELB = [ELBSTREAM]; // these tests pin the Elbstream adapter on its own
const url = (s) => resolveLogo(s, ELB)?.url ?? null;

// An in-memory host: files, a fake network keyed by URL, a clock, and a log of downloads.
function host(net = {}) {
  const files = new Map();
  const h = {
    dir: "/home/.config/herdr-app/mods/quotr/.cache/logos",
    rel: "mods/quotr/.cache/logos",
    clock: Date.UTC(2026, 10, 17, 12),
    downloads: [],
    files,
    readFile: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); const v = files.get(p); return typeof v === "string" ? new TextEncoder().encode(v) : v; },
    readText: async (p) => (files.has(p) ? String(files.get(p)) : null),
    writeFile: async (p, v) => { files.set(p, v); },
    copyFile: async (a, b) => { if (!files.has(a)) throw new Error("ENOENT"); files.set(b, files.get(a)); },
    exists: async (p) => files.has(p),
    mkdir: async () => {},
    unlink: async (p) => { files.delete(p); },
    now: () => h.clock,
    download: async (u, to) => {
      h.downloads.push(u);
      const r = net[u];
      if (!r) throw new Error("network down");
      if (r.body) files.set(to, r.body);
      return { status: r.status, contentType: r.type };
    },
  };
  return h;
}
const ok = (body, type = "image/png") => ({ status: 200, type, body });

test("sniffs real images and refuses anything else", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "jpg");
  assert.equal(sniffImage(SVG), "svg");
  assert.equal(sniffImage(HTML), null, "an error page");
  assert.equal(sniffImage(new Uint8Array(0)), null, "an empty file");
  assert.equal(sniffImage(PNG.slice(0, 4)), null, "a truncated download");
  assert.equal(sniffImage(new TextEncoder().encode('<svg viewBox="0 0 1 1"><script>x()</script></svg>')), null, "unsafe SVG");
  assert.equal(sniffImage("not bytes"), null);
});

test("downloads once, records its source, and never fetches a present logo again", async () => {
  const h = host({ [url("INTR")]: ok(PNG) });
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(c.pathFor("INTR"), null);
  assert.equal(c.needs("INTR", h.clock), true);
  assert.equal(await c.refresh("INTR"), true);
  assert.match(c.pathFor("INTR"), /^mods\/quotr\/\.cache\/logos\/INTR-[a-z0-9]+\.png$/);
  assert.equal(c.sourceFor("INTR"), ELBSTREAM, "the attribution follows the file");
  assert.deepEqual(h.files.get(`${h.dir}/${c.index.INTR.file}`), PNG, "byte-for-byte");
  assert.equal(h.files.has(`${h.dir}/.INTR.download`), false, "no temp file left");
  assert.equal(c.needs("INTR", h.clock + 1), false, "present: not fetched");
  assert.equal(c.needs("INTR", h.clock + 365 * 86_400_000), false, "not even a year later");
  assert.equal(h.downloads.length, 1);
  const again = new LogoCache(h, ELB); // a restart reads the index back
  await again.load();
  assert.equal(again.pathFor("INTR"), c.pathFor("INTR"));
  assert.equal(again.needs("INTR", h.clock), false);
});

test("crypto logos are cached per pair, from the coin's Elbstream logo", async () => {
  const h = host({ [url("BTC/USDT")]: ok(SVG, "image/svg+xml") });
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(await c.refresh("BTC/USDT"), true);
  assert.match(c.pathFor("BTC/USDT"), /^mods\/quotr\/\.cache\/logos\/BTC_USDT-[a-z0-9]+\.svg$/);
  assert.deepEqual(h.downloads, ["https://api.elbstream.com/logos/crypto/BTC"]);
});

test("never requests for symbols no rule gives a logo (indices, FX, futures)", async () => {
  const h = host();
  const c = new LogoCache(h, ELB);
  await c.load();
  for (const s of ["^GSPC", "EURUSD=X", "CL=F"]) {
    assert.equal(c.needs(s, h.clock), false, s);
    assert.equal(await c.refresh(s), false, s);
  }
  assert.equal(h.downloads.length, 0);
});

test("a failed request, a 404, an error page or a wrong type keeps the monogram and waits before retrying", async () => {
  for (const [name, response, reason] of [
    ["network down", undefined, /network down/],
    ["404", { status: 404, type: "text/plain" }, /Elbstream has no logo/],
    ["500", { status: 500, type: "text/html", body: HTML }, /HTTP 500/],
    ["html as image", ok(HTML, "image/png"), /not a valid image/],
    ["text type", ok(PNG, "text/html"), /not an image/],
    ["too large", ok(new Uint8Array(CACHE.maxBytes + 1).fill(0x89), "image/png"), /too large/],
  ]) {
    const h = host(response ? { [url("AZUL")]: response } : {});
    const c = new LogoCache(h, ELB);
    await c.load();
    assert.equal(await c.refresh("AZUL"), false, name);
    assert.equal(c.pathFor("AZUL"), null, `${name}: monogram stays`);
    assert.equal(c.sourceFor("AZUL"), null, `${name}: so no attribution is needed for it`);
    assert.match(c.index.AZUL.error, reason, name);
    const wait = name === "network down" ? CACHE.transientRetryMs : CACHE.retryMs; // no answer at all: sooner
    assert.equal(c.needs("AZUL", h.clock + wait - 1), false, `${name}: no retry storm`);
    assert.equal(c.needs("AZUL", h.clock + wait), true);
    assert.equal(h.files.has(`${h.dir}/.AZUL.download`), false, `${name}: temp file removed`);
  }
});

test("a failed explicit refresh keeps the previous good logo, which is still not refetched", async () => {
  const net = { [url("PBR")]: ok(SVG, "image/svg+xml") };
  const h = host(net);
  const c = new LogoCache(h, ELB);
  await c.load();
  await c.refresh("PBR");
  const good = c.pathFor("PBR");
  h.clock += 86_400_000;
  delete net[url("PBR")];
  assert.equal(await c.refresh("PBR"), false);
  assert.equal(c.pathFor("PBR"), good, "the same file as before");
  assert.deepEqual(h.files.get(`${h.dir}/${c.index.PBR.file}`), SVG);
  assert.equal(c.needs("PBR", h.clock + CACHE.retryMs + 1), false, "present: never fetched again");
});

test("a logo removed from the cache folder is fetched again (it's no longer present)", async () => {
  const h = host({ [url("NU")]: ok(SVG, "image/svg+xml") });
  const c = new LogoCache(h, ELB);
  await c.load();
  await c.refresh("NU");
  h.files.delete(`${h.dir}/${c.index.NU.file}`);
  const restarted = new LogoCache(h, ELB);
  await restarted.load();
  assert.equal(restarted.pathFor("NU"), null);
  assert.equal(restarted.needs("NU", h.clock), true);
});

test("a store that writes nothing is caught, not recorded as a logo", async () => {
  const h = host({ [url("MSTR")]: ok(SVG, "image/svg+xml") });
  h.copyFile = async (_a, b) => { h.files.set(b, new Uint8Array(0)); }; // what Herdr's binary writeFile did
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(await c.refresh("MSTR"), false);
  assert.match(c.index.MSTR.error, /could not store/);
  assert.equal(c.pathFor("MSTR"), null);
});

test("a file whose mapping was removed or changed is no longer shown, and a changed one is refetched", async () => {
  const h = host();
  const elb = "https://api.elbstream.com/logos/";
  h.files.set(`${h.dir}/index.json`, JSON.stringify({
    STRC: { file: "STRC.svg", fetchedAt: h.clock, url: `${elb}symbol/STRC`, source: "elbstream" }, // the old, wrong lookup
    "EURUSD=X": { file: "EURUSD_X.svg", fetchedAt: h.clock, url: `${elb}symbol/EURUSD%3DX`, source: "elbstream" }, // no rule now
  }));
  h.files.set(`${h.dir}/STRC.svg`, SVG);
  h.files.set(`${h.dir}/EURUSD_X.svg`, SVG);
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(c.pathFor("STRC"), null, "not the other company's logo");
  assert.equal(c.needs("STRC", h.clock), true, "fetched again from the issuer's lookup");
  assert.equal(c.pathFor("EURUSD=X"), null);
  assert.equal(c.needs("EURUSD=X", h.clock), false);
});

test("entries cached before sources were recorded still count as Elbstream", async () => {
  const h = host();
  h.files.set(`${h.dir}/index.json`, JSON.stringify({ INTR: { file: "INTR.png", fetchedAt: h.clock, url: url("INTR"), kind: "png" } }));
  h.files.set(`${h.dir}/INTR.png`, PNG);
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(c.pathFor("INTR"), "mods/quotr/.cache/logos/INTR.png");
  assert.equal(c.sourceFor("INTR"), ELBSTREAM);
});

test("missing, empty, malformed or tampered cache files are dropped at load and fetched again", async () => {
  const h = host();
  const e = (s, file) => ({ file, fetchedAt: h.clock, url: url(s), source: "elbstream" });
  h.files.set(`${h.dir}/index.json`, JSON.stringify({
    INTR: e("INTR", "INTR.png"),            // empty file (the earlier bug)
    AZUL: e("AZUL", "AZUL.png"),            // missing file
    PBR: e("PBR", "PBR.svg"),               // an error page saved as .svg
    BDORY: e("BDORY", "../../evil.png"),    // a path outside the cache
    MSTR: e("MSTR", "MSTR.svg"),            // good
    STRC: { failedAt: h.clock, failedUrl: url("STRC"), url: url("STRC"), source: "elbstream", error: "HTTP 503" },
    junk: 5,
  }));
  h.files.set(`${h.dir}/INTR.png`, new Uint8Array(0));
  h.files.set(`${h.dir}/PBR.svg`, HTML);
  h.files.set(`${h.dir}/MSTR.svg`, SVG);
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.deepEqual(Object.keys(c.index).sort(), ["MSTR", "STRC"]);
  for (const s of ["INTR", "AZUL", "PBR", "BDORY"]) {
    assert.equal(c.pathFor(s), null, s);
    assert.equal(c.needs(s, h.clock), true, `${s} is fetched again`);
  }
  assert.equal(c.pathFor("MSTR"), "mods/quotr/.cache/logos/MSTR.svg");
  assert.equal(c.needs("STRC", h.clock), false, "a recent failure still waits");
});

test("a corrupt index is an empty cache, not a crash", async () => {
  const h = host();
  h.files.set(`${h.dir}/index.json`, "{not json");
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.deepEqual(c.index, {});
  assert.equal(c.loaded, true);
});

test("no HTTP answer (offline, or cut short by a reload) retries after 10 minutes, a real failure after 6 hours", async () => {
  for (const [name, net, transient] of [
    ["network error", {}, true],
    ["status 0", { [url("NU")]: { status: 0, type: "" } }, true],
    ["404", { [url("NU")]: { status: 404, type: "text/plain" } }, false],
  ]) {
    const h = host(net);
    const c = new LogoCache(h, ELB);
    await c.load();
    await c.refresh("NU");
    assert.equal(c.index.NU.transient, transient, name);
    const wait = transient ? CACHE.transientRetryMs : CACHE.retryMs;
    assert.equal(c.needs("NU", h.clock + wait - 1), false, `${name}: waits`);
    assert.equal(c.needs("NU", h.clock + wait), true, `${name}: then retries`);
  }
  // Entries written before this distinction ("HTTP 0") count as transient too.
  const h = host();
  h.files.set(`${h.dir}/index.json`, JSON.stringify({ NU: { url: url("NU"), source: "elbstream", failedAt: h.clock, failedUrl: url("NU"), error: "HTTP 0" } }));
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(c.needs("NU", h.clock + CACHE.transientRetryMs), true);
});

test("each download gets a new file name and removes the previous file, so the new image shows at once", async () => {
  const h = host({ [url("MSFT")]: ok(SVG, "image/svg+xml") });
  const c = new LogoCache(h, ELB);
  await c.load();
  await c.refresh("MSFT");
  const first = c.index.MSFT.file;
  h.clock += 61_000;
  await c.refresh("MSFT"); // a forced re-download (Refresh)
  const second = c.index.MSFT.file;
  assert.notEqual(second, first);
  assert.match(second, /^MSFT-[a-z0-9]+\.svg$/);
  assert.equal(h.files.has(`${h.dir}/${first}`), false, "old file removed");
  assert.equal(h.files.has(`${h.dir}/${second}`), true);
  assert.equal(c.pathFor("MSFT"), `mods/quotr/.cache/logos/${second}`);
});

test("after no answer, the very next quote round (60 s) tries again", () => {
  assert.ok(CACHE.transientRetryMs < 60_000, "shorter than the round interval");
  assert.ok(CACHE.retryMs >= 3_600_000, "a real error from the server still waits hours");
});

test("a newly added pair is fetched automatically at its first round (XTZ/USDT → crypto/XTZ)", async () => {
  const h = host({ "https://api.elbstream.com/logos/crypto/XTZ": ok(SVG, "image/svg+xml") });
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(c.needs("XTZ/USDT", h.clock), true, "no list to be on: it's due at once");
  assert.equal(await c.refresh("XTZ/USDT"), true);
  assert.deepEqual(h.downloads, ["https://api.elbstream.com/logos/crypto/XTZ"]);
  assert.match(c.pathFor("XTZ/USDT"), /XTZ_USDT-[a-z0-9]+\.svg$/);
});

test("a symbol Elbstream doesn't know (404) keeps its monogram and is not asked again for hours", async () => {
  const h = host({ "https://api.elbstream.com/logos/symbol/ZZZZ": { status: 404, type: "text/plain" } });
  const c = new LogoCache(h, ELB);
  await c.load();
  assert.equal(await c.refresh("ZZZZ"), false);
  assert.equal(c.pathFor("ZZZZ"), null);
  assert.equal(c.needs("ZZZZ", h.clock + 60_000), false);
  assert.equal(c.needs("ZZZZ", h.clock + CACHE.retryMs), true);
});

// --- Transparent vs opaque logos (drawn on a backdrop vs as is) ---
import { isOpaqueImage } from "../logocache.js";
const svg = (s) => new TextEncoder().encode(s);
const pngOf = (colorType, extra = "") => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 100, 0, 0, 0, 100, 8, colorType, 0, 0, 0, 0, 0, 0, 0, ...[...extra].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);

test("Elbstream's tile and coin logos count as opaque", () => {
  assert.equal(isOpaqueImage(svg('<svg width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" fill="#820AD1"/><path d="M1 1"/></svg>'), "svg"), true, "NU-style tile");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 60 60"><defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><g clip-path="url(#c)"><rect width="60" height="60" fill="black"/></g></svg>'), "svg"), true,
    "NFLX-style: the clip path's rect is not drawn, the black background is");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#F7931A"/></svg>'), "svg"), true, "a filled coin");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 100 100"><rect width="100%" height="100%" fill="#fff"/></svg>'), "svg"), true);
  assert.equal(isOpaqueImage(pngOf(2), "png"), true, "RGB PNG (AZUL, BDORY)");
  assert.equal(isOpaqueImage(pngOf(3), "png"), true, "palette PNG without transparency (INTR)");
  assert.equal(isOpaqueImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "jpg"), true);
});

test("bare glyphs, alpha PNGs and see-through backgrounds count as transparent", () => {
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 500 500"><style>.st0{fill:#2C7DF7;}</style><path class="st0" d="M303 500z"/></svg>'), "svg"), false, "XTZ: a bare path");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 500 500"><polygon fill="#2F3030" points="1,1 2,2 3,1"/></svg>'), "svg"), false, "ETH: a bare polygon");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 60 60"><rect width="40" height="40" fill="#000"/></svg>'), "svg"), false, "a rect smaller than the box");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="none"/></svg>'), "svg"), false, "an unfilled rect");
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 60 60"><rect width="60" height="60" fill="#000" opacity="0.5"/></svg>'), "svg"), false);
  assert.equal(isOpaqueImage(svg('<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="20" fill="#000"/></svg>'), "svg"), false, "a small circle");
  assert.equal(isOpaqueImage(pngOf(6), "png"), false, "RGBA PNG");
  assert.equal(isOpaqueImage(pngOf(2, "tRNS"), "png"), false, "RGB PNG with a transparency chunk");
  assert.equal(isOpaqueImage(svg("<svg><path/></svg>"), "svg"), false, "no size: assume transparent");
});

test("the cache records opacity on download and re-derives it at start", async () => {
  const glyph = svg('<svg viewBox="0 0 500 500"><path fill="#2C7DF7" d="M1 1"/></svg>');
  const h = host({ "https://api.elbstream.com/logos/crypto/XTZ": ok(glyph, "image/svg+xml"), [url("NU")]: ok(SVG, "image/svg+xml") });
  const c = new LogoCache(h, ELB);
  await c.load();
  await c.refresh("XTZ/USDT");
  await c.refresh("NU");
  assert.equal(c.isOpaque("XTZ/USDT"), false);
  assert.equal(c.isOpaque("NU"), true);
  delete c.index["XTZ/USDT"].opaque; // an entry written before this rule
  await c.save();
  const again = new LogoCache(h, ELB);
  await again.load();
  assert.equal(again.isOpaque("XTZ/USDT"), false, "worked out again from the file");
  assert.equal(again.isOpaque("NU"), true);
  assert.equal(again.isOpaque("MISSING"), false);
});
