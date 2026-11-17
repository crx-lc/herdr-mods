// Local customization (not part of upstream Pulse): a local cache for logos from the sources in
// logosource.js. No Herdr imports (the host is passed in), so `node --test` runs it.
//
// Why a local cache: Herdr's image() takes only local paths (no URLs), and a mod's fetch()
// reads text only, so each logo is downloaded with curl into a hidden folder of this mod
// (hidden, so writes there don't reload the mod), checked, then shown from there.
// Each cached file records its source, so the right attribution is shown wherever it appears.
//
// Requests: one GET per verified symbol to its source, only while its logo is not present (or once per 6 hours
// after a failure), never during quote refreshes. The source sees the symbol and this machine's
// IP; nothing else about the watchlist is sent.
import { svgProblem } from "./svgcheck.js";
import { ELBSTREAM, LOGO_SOURCES, resolveLogo, sourceById } from "./logosource.js";

export { ELBSTREAM };

export const CACHE = {
  retryMs: 6 * 3_600_000,
  // No HTTP answer at all (offline, or the download cut short by a mod reload): try again with the
  // next quote round. Offline, curl fails locally, so this sends nothing to the source.
  transientRetryMs: 55_000,
  maxBytes: 300_000,
  userAgent: "Herdr-Quotr/1.0",
};

/** "png" | "jpg" | "svg" from the bytes themselves, or null for anything else (an error page, garbage). */
export function sniffImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  let text = "";
  for (let i = 0; i < Math.min(bytes.length, CACHE.maxBytes); i++) text += String.fromCharCode(bytes[i]);
  return svgProblem(text) === null ? "svg" : null;
}

/**
 * Whether an image covers its whole box by itself (drawn as is) or has transparent areas (drawn
 * inset on a backdrop, so nothing underneath shows through and a full-bleed glyph isn't clipped).
 * PNG: no alpha channel and no tRNS chunk. JPEG: always. SVG: its first drawn shape (ignoring
 * <defs>, <clipPath>, <mask>) is a filled rectangle covering the viewBox, or a filled circle
 * filling it (crypto coins; the round mask hides the corners). Anything else counts as transparent.
 */
export function isOpaqueImage(bytes, kind) {
  if (!(bytes instanceof Uint8Array)) return false;
  if (kind === "jpg") return true;
  if (kind === "png") {
    if (bytes.length < 26) return false;
    let trns = false;
    for (let i = 33; i + 4 <= bytes.length && !trns; i++) {
      trns = bytes[i] === 0x74 && bytes[i + 1] === 0x52 && bytes[i + 2] === 0x4e && bytes[i + 3] === 0x53; // "tRNS"
    }
    return (bytes[25] === 0 || bytes[25] === 2 || bytes[25] === 3) && !trns;
  }
  if (kind !== "svg") return false;
  let text = "";
  for (let i = 0; i < Math.min(bytes.length, CACHE.maxBytes); i++) text += String.fromCharCode(bytes[i]);
  text = text.replace(/<defs[\s\S]*?<\/defs>/g, "").replace(/<clipPath[\s\S]*?<\/clipPath>/g, "").replace(/<mask[\s\S]*?<\/mask>/g, "");
  const svg = /<svg\b([^>]*)>/.exec(text);
  if (!svg) return false;
  const attr = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs)?.[1];
  const num = (v) => (v === undefined ? NaN : Number.parseFloat(v));
  const vb = (attr(svg[1], "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const w = vb.length === 4 ? vb[2] : num(attr(svg[1], "width"));
  const h = vb.length === 4 ? vb[3] : num(attr(svg[1], "height"));
  if (!(w > 0) || !(h > 0)) return false;
  const first = /<(rect|circle|ellipse|path|polygon|polyline|line|image|use|text)\b([^>]*)>/.exec(text.slice(svg.index + svg[0].length));
  if (!first) return false;
  const [, tag, attrs] = first;
  const fill = (attr(attrs, "fill") ?? "").trim().toLowerCase();
  if (fill === "none" || fill === "transparent" || /\bopacity\s*=\s*["']0?\.\d/.test(attrs)) return false;
  const size = (v, whole) => (typeof v === "string" && v.trim().endsWith("%") ? num(v) / 100 * whole : num(v));
  if (tag === "rect") {
    const x = num(attr(attrs, "x") ?? "0");
    const y = num(attr(attrs, "y") ?? "0");
    return Math.abs(x - (vb[0] || 0)) < w * 0.02 && Math.abs(y - (vb[1] || 0)) < h * 0.02
      && size(attr(attrs, "width"), w) >= w * 0.98 && size(attr(attrs, "height"), h) >= h * 0.98;
  }
  if (tag === "circle") return num(attr(attrs, "r")) >= Math.min(w, h) * 0.49;
  return false;
}

const fileKey = (symbol) => symbol.replace(/[^A-Z0-9]/g, "_");
// What an entry was cached for: its source key (older Elbstream entries: their URL, which was the key).
const keyOf = (e) => e?.key ?? e?.url;
// SYMBOL.ext (older entries) or SYMBOL-version.ext: a new name per download, so Herdr shows the new
// image at once instead of a copy it already loaded for the old name.
const FILE = /^[A-Z0-9_]{1,40}(-[a-z0-9]{1,12})?\.(png|jpg|svg)$/;

/**
 * host: {
 *   dir: absolute cache folder, rel: the same folder relative to the Herdr home (what image() takes),
 *   readFile(path) → Uint8Array | throws, readText(path) → string | null, writeFile(path, string) (index only),
 *   copyFile(from, to) (byte-for-byte),
 *   exists(path), mkdir(path), unlink(path),
 *   download(url, toPath) → Promise<{ status, contentType }>   // curl in Herdr, a fake in tests
 *   now() → ms, preference?(symbol) → "auto" | "none" | source id   // the owner's per-ticker choice
 * }
 */
export class LogoCache {
  constructor(host, sources = LOGO_SOURCES) {
    this.host = host;
    this.sources = sources;
    this.index = {};
    this.loaded = false;
    this.busy = new Set();
  }

  /**
   * Reads the index, then drops every entry whose file is missing, empty, oversized or not a real
   * image (a damaged, truncated or hand-edited cache), so it is fetched again instead of shown.
   */
  async load() {
    let index = {};
    try {
      const text = await this.host.readText(`${this.host.dir}/index.json`);
      const parsed = text ? JSON.parse(text) : {};
      index = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { index = {}; }
    for (const [symbol, e] of Object.entries(index)) {
      if (!e || typeof e !== "object") { delete index[symbol]; continue; }
      // Entries cached before sources were recorded came from Elbstream.
      if (!e.source && typeof e.url === "string" && e.url.startsWith(ELBSTREAM.api)) e.source = ELBSTREAM.id;
      if (!e.file) continue; // a remembered failure: keep it for the retry wait
      let ok = false;
      try {
        if (FILE.test(e.file) && await this.host.exists(`${this.host.dir}/${e.file}`)) {
          const bytes = await this.host.readFile(`${this.host.dir}/${e.file}`);
          const kind = bytes.length > 0 && bytes.length <= CACHE.maxBytes ? sniffImage(bytes) : null;
          ok = kind !== null;
          // Re-derived from the file every start, so older entries (and changed rules) get it too.
          if (ok) e.opaque = isOpaqueImage(bytes, kind);
        }
      } catch { ok = false; }
      if (!ok) delete index[symbol];
    }
    this.index = index;
    this.loaded = true;
  }

  /**
   * The cached file to show, or null. Only while the symbol's current mapping still points at what
   * was cached (a mapping removed or changed stops showing the old file). Never touches the network.
   */
  pathFor(symbol) {
    const now = resolveLogo(symbol, this.sources, this.choice(symbol));
    // A file shipped with the mod: shown as is, nothing cached or downloaded.
    if (now?.source.localPath) return now.source.localPath(symbol);
    const e = this.index[symbol];
    if (!e || !e.file || !FILE.test(e.file)) return null;
    if (!now || now.key !== keyOf(e) || now.source.id !== e.source) return null;
    return `${this.host.rel}/${e.file}`;
  }

  /**
   * How to draw the shown logo: "full" (it covers its box), "backdrop" (a raster image with
   * transparency: full size on a white backdrop, since raster icons carry their own padding), or
   * "inset" (a transparent vector glyph that runs to its edges: smaller, on a white backdrop, so the
   * round mask never clips it). null when no logo is shown.
   */
  logoStyle(symbol) {
    if (!this.pathFor(symbol)) return null;
    const local = resolveLogo(symbol, this.sources, this.choice(symbol))?.source;
    if (local?.localPath) return local.styleFor?.(symbol) ?? "full";
    const e = this.index[symbol];
    if (e.opaque === true) return "full";
    return /\.svg$/.test(e.file) ? "inset" : "backdrop";
  }

  /** Whether the shown logo covers its whole box (false: draw it on a backdrop). */
  isOpaque(symbol) {
    return this.logoStyle(symbol) === "full";
  }

  /** The source whose logo is shown for `symbol` (for its attribution), or null. */
  sourceFor(symbol) {
    if (!this.pathFor(symbol)) return null;
    const want = resolveLogo(symbol, this.sources, this.choice(symbol));
    return want?.source.localPath ? want.source : sourceById(this.index[symbol].source, this.sources);
  }

  /** Whether `symbol` should be fetched now: mapped, and its logo not present (missing, dropped as damaged, or for another mapping); not recently failed. A present logo is never fetched again. */
  needs(symbol, now) {
    const want = resolveLogo(symbol, this.sources, this.choice(symbol));
    if (!want || want.source.localPath) return false;
    const e = this.index[symbol];
    if (!e) return true;
    const wait = e.transient || e.error === "HTTP 0" ? CACHE.transientRetryMs : CACHE.retryMs;
    if (e.failedAt && (e.failedKey ?? e.failedUrl ?? keyOf(e)) === want.key && now - e.failedAt < wait) return false;
    if (keyOf(e) !== want.key || e.source !== want.source.id) return true;
    return !e.file;
  }

  /** The owner's logo choice for `symbol` (host.preference: a source id, "none" or "auto"), if any. */
  choice(symbol) {
    try { return this.host.preference?.(symbol); } catch { return undefined; }
  }

  async save() {
    await this.host.writeFile(`${this.host.dir}/index.json`, JSON.stringify(this.index, null, 1));
  }

  /**
   * One download, checked before it replaces anything: HTTP 200, an image content type, the
   * bytes really an image, under the size cap. Any failure keeps the previous file (if any)
   * and is remembered so the next try waits CACHE.retryMs. Returns true when a new file is in place.
   */
  async refresh(symbol) {
    const want = resolveLogo(symbol, this.sources, this.choice(symbol));
    if (!want || want.source.localPath || this.busy.has(symbol)) return false;
    const { source, key } = want;
    let url = key;
    this.busy.add(symbol);
    const tmp = `${this.host.dir}/.${fileKey(symbol)}.download`;
    const prev = this.index[symbol] ?? {};
    let transient = false;
    try {
      await this.host.mkdir(this.host.dir);
      // A source that needs a lookup first (AllInvestView: symbol → company domain → CDN image).
      if (source.imageUrl) {
        try { url = await source.imageUrl(symbol, this.host); } catch (cause) { transient = true; throw cause; }
        if (!url) throw new Error(`${source.name} has no logo for it`);
        if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("not an https image URL");
      }
      let r;
      try { r = await this.host.download(url, tmp); } catch (cause) { transient = true; throw cause; }
      if (!r || !r.status) { transient = true; throw new Error("no answer"); }
      if (r.status !== 200) throw new Error(r.status === 404 ? `${source.name} has no logo for it` : `HTTP ${r.status}`);
      if (!/^image\/(png|jpeg|svg\+xml)\b/.test(r.contentType ?? "")) throw new Error(`not an image (${r.contentType || "no type"})`);
      const bytes = await this.host.readFile(tmp);
      if (bytes.length > CACHE.maxBytes) throw new Error("too large");
      const kind = sniffImage(bytes);
      if (!kind) throw new Error("not a valid image");
      const file = `${fileKey(symbol)}-${Math.floor(this.host.now()).toString(36)}.${kind}`;
      // Copied, not rewritten from bytes: Herdr's fs.writeFile wrote empty files for binary data.
      await this.host.copyFile(tmp, `${this.host.dir}/${file}`);
      const written = await this.host.readFile(`${this.host.dir}/${file}`);
      if (written.length !== bytes.length || sniffImage(written) !== kind) throw new Error("could not store the image");
      if (prev.file && prev.file !== file) { try { await this.host.unlink(`${this.host.dir}/${prev.file}`); } catch { /* gone */ } }
      this.index[symbol] = { file, fetchedAt: this.host.now(), key, url, source: source.id, kind, // clears any failure
        opaque: isOpaqueImage(bytes, kind) };
      await this.save();
      return true;
    } catch (cause) {
      // The previous good file (if any) stays as it was; the failure is remembered against this URL.
      this.index[symbol] = { ...prev, key: prev.file ? keyOf(prev) : key, url: prev.file ? prev.url : url,
        source: prev.file ? prev.source : source.id, failedAt: this.host.now(), failedKey: key, transient, error: String(cause?.message ?? cause).slice(0, 120) };
      try { await this.save(); } catch { /* the cache stays usable in memory */ }
      return false;
    } finally {
      try { if (await this.host.exists(tmp)) await this.host.unlink(tmp); } catch { /* best effort */ }
      this.busy.delete(symbol);
    }
  }
}
