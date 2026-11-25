// The project catalog, `herdr-agents/projects` version 1 (crx-lc/herdr-agents#141, slice S5): the read-only side,
// ported from the contract's reference readers (bin/projects-read.mjs and bin/catalog-remote-read.mjs) so the mod
// stays self-contained. Pure: no Herdr imports, no file or process calls. `.tests/catalog-parity.test.mjs` runs the
// contract's reader-cases.json, palette-cases.json, icon-cases.json and remote-read-cases.json against it.
//
//   assessCatalog({ text, lastRevision, sha256 })  one machine's catalog → { status: 'unknown', why } or
//                                                   { status: 'ok', revision, producer, projects, dropped }
//   mergeCatalogs([{ machine, result }])           across machines → { projects: [{ id, primary, displayName, state,
//                                                   flags, presentation, cores }] }
//   remoteCatalogRead({ machine, isReady, read })  D8: read another machine's catalog only while Herdr says it is ready
import { validateIcon } from './icons.js';

export const SCHEMA = 'herdr-agents/projects';
export const VERSION = 1;
export const LABEL = 'herdr.projects';
export const FLAGS = Object.freeze(['duplicate-identity', 'icon-conflict', 'palette-conflict', 'manifest-differs', 'two-watchers']);
// The producer's own limit for one icon; Roster's general icon check allows more.
export const ICON_MAX = 65536;

const NAME = /^[A-Za-z0-9][\w.-]{0,99}$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const WHOLE = value => Number.isSafeInteger(value) && value >= 0;
const LINE = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value);
const OPTIONAL_LINE = (value, max) => value === null || LINE(value, max);
// A string-valued field must be a string before any pattern is tried: never coerced.
const MATCHES = (value, pattern) => typeof value === 'string' && pattern.test(value);
const unknown = why => ({ status: 'unknown', why });
// UTF-8 bytes of a string, without relying on TextEncoder (not promised by Herdr's QuickJS).
export function utf8(text) {
  const out = [];
  for (const c of String(text)) {
    const v = c.codePointAt(0);
    if (v < 0x80) out.push(v);
    else if (v < 0x800) out.push(0xc0 | (v >> 6), 0x80 | (v & 63));
    else if (v < 0x10000) out.push(0xe0 | (v >> 12), 0x80 | ((v >> 6) & 63), 0x80 | (v & 63));
    else out.push(0xf0 | (v >> 18), 0x80 | ((v >> 12) & 63), 0x80 | ((v >> 6) & 63), 0x80 | (v & 63));
  }
  return Uint8Array.from(out);
}
const ascii = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, i + 4096)); return s; };

// SHA-256 of a string's bytes (UTF-8), lowercase hex. Herdr's QuickJS has no SubtleCrypto; catalog icons are ASCII.
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
  0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
export function sha256(text) {
  const data = utf8(text);
  const length = data.length, blocks = Math.ceil((length + 9) / 64), bytes = new Uint8Array(blocks * 64);
  bytes.set(data); bytes[length] = 0x80;
  const bits = length * 8, end = bytes.length;
  bytes[end - 4] = (bits >>> 24) & 255; bytes[end - 3] = (bits >>> 16) & 255; bytes[end - 2] = (bits >>> 8) & 255; bytes[end - 1] = bits & 255;
  bytes[end - 5] = Math.floor(bits / 0x100000000) & 255;
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < end; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[block + i * 4] << 24) | (bytes[block + i * 4 + 1] << 16) | (bytes[block + i * 4 + 2] << 8) | bytes[block + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

// WCAG 2.2 contrast of two #RRGGBB colors.
const channel = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
export function contrast(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
// A palette: exactly light and dark, each exactly a foreground and a background in #RRGGBB, each pair at least 4.5:1,
// and the light background lighter than the dark one. { problem: null } or { problem: { code } }.
export function checkPalette(palette) {
  const fail = code => ({ problem: { code } });
  const pair = value => isObject(value) && Object.keys(value).sort().join() === 'background,foreground'
    && MATCHES(value.foreground, COLOR) && MATCHES(value.background, COLOR);
  if (!isObject(palette) || Object.keys(palette).sort().join() !== 'dark,light' || !pair(palette.light) || !pair(palette.dark)) return fail('palette-invalid');
  if (contrast(palette.light.foreground, palette.light.background) < 4.5 || contrast(palette.dark.foreground, palette.dark.background) < 4.5) return fail('palette-contrast');
  if (luminance(palette.light.background) <= luminance(palette.dark.background)) return fail('palette-swapped');
  return { problem: null };
}

// The catalog's icon subset: Roster's static SVG check plus the producer's own rules (at most 64 KiB, a root with the
// SVG namespace and a viewBox, colors only as none or #RRGGBB). null when valid, else { code: 'icon-invalid' }.
export function catalogIcon(bytes) {
  const invalid = { code: 'icon-invalid' };
  if (!(bytes instanceof Uint8Array) || bytes.length > ICON_MAX || !validateIcon(bytes, 'icon.svg')) return invalid;
  const text = ascii(bytes);
  const root = /^\s*<svg\b([^>]*)>/.exec(text);
  if (!root || !/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(root[1]) || !/\sviewBox="/.test(root[1])) return invalid;
  for (const m of text.matchAll(/\s(?:fill|stroke)="([^"]*)"/g)) if (m[1] !== 'none' && !COLOR.test(m[1])) return invalid;
  return null;
}

function wellFormedEntry(entry, revision) {
  if (!isObject(entry) || !MATCHES(entry.id, NAME) || !MATCHES(entry.token, NAME) || !LINE(entry.displayName, 100)) return false;
  if (!['manifest', 'legacy'].includes(entry.kind) || ![null, 'watcher', 'manual'].includes(entry.mode) || !['ok', 'invalid'].includes(entry.state)) return false;
  if (!Array.isArray(entry.problems) || !entry.problems.every(code => MATCHES(code, CODE))) return false;
  if (!(entry.primary === null || MATCHES(entry.primary, REPOSITORY))) return false;
  if (!(entry.manifest === null || (isObject(entry.manifest) && MATCHES(entry.manifest.commit, COMMIT) && WHOLE(entry.manifest.version)))) return false;
  if (!(entry.board === null || isObject(entry.board))) return false;
  if (!Array.isArray(entry.repositories) || !entry.repositories.every(repo => isObject(repo) && MATCHES(repo.name, REPOSITORY)
    && OPTIONAL_LINE(repo.role, 40) && typeof repo.primary === 'boolean' && ['bound', 'unbound'].includes(repo.checkout))) return false;
  const { space } = entry;
  if (!isObject(space) || !OPTIONAL_LINE(space.name, 64) || !OPTIONAL_LINE(space.id, 128) || !['bound', 'missing'].includes(space.binding)) return false;
  if (!(entry.presentation === null || (isObject(entry.presentation) && isObject(entry.presentation.icon)))) return false;
  return WHOLE(entry.revision) && entry.revision <= revision;
}

// The icon and palette checked again with this reader's own rules. null when they pass, else a problem code.
function presentationProblem({ icon, palette }, hash) {
  if (icon.format !== 'svg' || !(Number.isSafeInteger(icon.version) && icon.version >= 1) || typeof icon.svg !== 'string'
    || !MATCHES(icon.sha256, HEX64) || !WHOLE(icon.bytes)) return 'icon-invalid';
  const bytes = utf8(icon.svg);
  if (bytes.length !== icon.bytes) return 'icon-invalid';
  const invalid = catalogIcon(bytes);
  if (invalid) return invalid.code;
  if (hash && hash(icon.svg) !== icon.sha256) return 'icon-invalid';
  return checkPalette(palette).problem?.code ?? null;
}

function judged(entry, hash) {
  const problems = [...new Set(entry.problems)];
  // A manifest project always has its artwork or a code for why not; one claiming ok with none is not trusted.
  if (entry.kind === 'manifest' && entry.presentation === null && problems.length === 0) problems.push('presentation-missing');
  let presentation = entry.state === 'ok' && problems.length === 0 ? entry.presentation : null;
  if (presentation !== null) {
    const problem = presentationProblem(presentation, hash);
    if (problem) { problems.push(problem); presentation = null; }
  }
  return { ...entry, state: entry.state === 'ok' && problems.length === 0 ? 'ok' : 'invalid', problems, presentation };
}

// The hash defaults to this module's own SHA-256, so the mod always checks it; null skips the check.
export function assessCatalog({ text, lastRevision = null, sha256: hash = sha256 } = {}) {
  if (text === null || text === undefined) return unknown('missing');
  if (typeof text !== 'string') return unknown('unreadable');
  let doc;
  try { doc = JSON.parse(text); } catch { return unknown('unreadable'); }
  if (doc?.schema !== SCHEMA) return unknown('not-a-catalog');
  if (doc.version !== VERSION) return unknown('version-unknown');
  const { producer } = doc;
  if (!isObject(producer) || !OPTIONAL_LINE(producer.core ?? null, 64) || !OPTIONAL_LINE(producer.machine ?? null, 64)
    || !WHOLE(doc.revision) || !Array.isArray(doc.projects)) return unknown('malformed');
  const ids = doc.projects.map(entry => (isObject(entry) && typeof entry.id === 'string' ? entry.id.toLowerCase() : null)).filter(id => id !== null);
  if (new Set(ids).size !== ids.length) return unknown('duplicate-id');
  if (lastRevision !== null && doc.revision < lastRevision) return unknown('revision-backwards');
  const projects = [];
  const dropped = [];
  doc.projects.forEach((entry, index) => {
    if (wellFormedEntry(entry, doc.revision)) projects.push(judged(entry, hash));
    else dropped.push({ index, id: isObject(entry) && typeof entry.id === 'string' ? entry.id : null, why: 'entry-malformed' });
  });
  return { status: 'ok', revision: doc.revision, producer: { core: producer.core ?? null, machine: producer.machine ?? null }, projects, dropped };
}

// A GitHub board as the catalog names it, checked: the provider, a login, the owner type and a number, and a URL that
// is exactly the one those build. Anything else is null (the board is then unknown, never guessed).
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export function githubBoard(board) {
  if (!isObject(board) || board.provider !== 'github-project' || !MATCHES(board.owner, LOGIN)
    || !['organization', 'user'].includes(board.ownerType) || !(Number.isSafeInteger(board.number) && board.number > 0)) return null;
  const url = `https://github.com/${board.ownerType === 'organization' ? 'orgs' : 'users'}/${board.owner}/projects/${board.number}`;
  return board.url === url ? { owner: board.owner, ownerType: board.ownerType, number: board.number, url } : null;
}

const samePalette = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function mergeCatalogs(sources = []) {
  const groups = [];
  for (const { machine = null, result } of sources) {
    if (result?.status !== 'ok') continue;
    for (const entry of result.projects ?? []) {
      if (!isObject(entry) || typeof entry.id !== 'string' || !(entry.primary === null || typeof entry.primary === 'string')) continue;
      const key = `${entry.id.toLowerCase()} ${String(entry.primary).toLowerCase()}`;
      let group = groups.find(listed => listed.key === key);
      if (!group) { group = { key, id: entry.id, primary: entry.primary, entries: [] }; groups.push(group); }
      group.entries.push({ machine, core: result.producer.core, entry });
    }
  }
  return {
    projects: groups.map(group => {
      const flags = [];
      if (groups.some(other => other !== group && other.id.toLowerCase() === group.id.toLowerCase())) flags.push('duplicate-identity');
      const shown = group.entries.map(item => item.entry.presentation).filter(Boolean);
      let presentation = null;
      if (shown.length) {
        const top = Math.max(...shown.map(item => item.icon.version));
        const winners = shown.filter(item => item.icon.version === top);
        const icon = winners.every(item => item.icon.sha256 === winners[0].icon.sha256) ? winners[0].icon : null;
        if (icon === null) flags.push('icon-conflict');
        const palette = winners.every(item => samePalette(item.palette, winners[0].palette)) ? winners[0].palette : null;
        if (palette === null) flags.push('palette-conflict');
        presentation = icon === null && palette === null ? null : { icon, palette };
      }
      const commits = new Set(group.entries.map(item => item.entry.manifest?.commit).filter(Boolean));
      if (commits.size > 1) flags.push('manifest-differs');
      if (group.entries.filter(item => item.entry.mode === 'watcher').length > 1) flags.push('two-watchers');
      const ok = group.entries.every(item => item.entry.state === 'ok') && !flags.includes('duplicate-identity');
      return {
        key: group.key, id: group.id, primary: group.primary, displayName: group.entries[0].entry.displayName, state: ok ? 'ok' : 'invalid', flags, presentation,
        // Roster also keeps each Core's token, board and revision (the reference keeps fewer fields; readers ignore extras).
        cores: group.entries.map(({ machine, core, entry }) => ({ machine, core, kind: entry.kind, mode: entry.mode, state: entry.state,
          problems: entry.problems, space: entry.space, repositories: entry.repositories, token: entry.token, board: entry.board, revision: entry.revision })),
      };
    }),
  };
}

// Owner decision D8: another machine's catalog is read only while Herdr reports that machine ready, checked right
// before the one read and again after it; nothing is retried. This narrows the window, it is not a no-wake guarantee
// (herdrdev/herdr-app#1441).
export const AVAILABLE = 'available';
export const UNAVAILABLE = 'unavailable';
async function readyNow(isReady) {
  try { return (await isReady()) === true; } catch { return false; }
}
export async function remoteCatalogRead({ machine, isReady, read } = {}) {
  if (typeof machine !== 'string' || machine.length === 0) throw new TypeError('remoteCatalogRead needs the machine name.');
  if (typeof isReady !== 'function' || typeof read !== 'function') throw new TypeError('remoteCatalogRead needs isReady and read functions.');
  const unavailable = reason => ({ machine, state: UNAVAILABLE, reason });
  if (!(await readyNow(isReady))) return unavailable('not-ready');
  let text;
  try { text = await read(); } catch { return unavailable('read-failed'); }
  if (typeof text !== 'string') return unavailable('read-failed');
  if (!(await readyNow(isReady))) return unavailable('readiness-lost');
  return { machine, state: AVAILABLE, text };
}

// Where a Core publishes its catalog (contracts/projects/README.md): fixed per platform, under the person's home.
// A remote machine's home is not known to Roster, so its path starts with ~ and Herdr's remote read resolves it.
export const CATALOG_FILE = 'projects.v1.json';
export function catalogPath(platform, home) {
  const base = typeof home === 'string' && home.trim() && !CONTROL.test(home) ? home.replace(/\\/g, '/').replace(/\/+$/, '') : null;
  if (!base) return null;
  if (platform === 'windows') return `${base}/AppData/Local/herdr-agents-data/published/${CATALOG_FILE}`;
  if (platform === 'linux') return `${base}/.local/share/herdr-agents/published/${CATALOG_FILE}`;
  return null;
}
export const REMOTE_CATALOG_PATH = `~/.local/share/herdr-agents/published/${CATALOG_FILE}`;
