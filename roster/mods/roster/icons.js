import { assetName, bounded } from './settings.js';

const MAX = 262144, DIM = 1024;
const u32 = (b, i) => ((b[i] * 0x1000000) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]) >>> 0;
function crc(b, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) { c ^= b[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
function png(b) {
  if (b.length < 57 || ![137,80,78,71,13,10,26,10].every((v, i) => b[i] === v)) return false;
  let p = 8, first = true, data = false, ended = false;
  while (p + 12 <= b.length) {
    const n = u32(b, p); if (n > MAX || p + n + 12 > b.length) return false;
    const type = String.fromCharCode(...b.slice(p + 4, p + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || crc(b, p + 4, p + 8 + n) !== u32(b, p + 8 + n)) return false;
    if (first) {
      if (type !== 'IHDR' || n !== 13 || !u32(b,p+8) || u32(b,p+8) > DIM || !u32(b,p+12) || u32(b,p+12) > DIM) return false;
      const depth = b[p+16], color = b[p+17];
      if (!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color] || []).includes(depth) || b[p+18] || b[p+19] || b[p+20] > 1) return false;
      first = false;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') data = true;
    if (type === 'IEND') { if (n || !data || p + 12 !== b.length) return false; ended = true; break; }
    p += n + 12;
  }
  return ended;
}
// Deliberately small XML subset: no entities, declarations, namespaces other
// than the standard root xmlns, CSS, text, references or event attributes.
function svg(b) {
  let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return false; }
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(s) || /[&!?]/.test(s)) return false;
  const stack = []; let pos = 0, root = false;
  const tag = /<\/?[A-Za-z][^<>]*>/g; let m;
  while ((m = tag.exec(s))) {
    if (s.slice(pos, m.index).trim()) return false; pos = tag.lastIndex;
    const closing = /^<\//.test(m[0]), self = /\/>$/.test(m[0]);
    const t = /^<\/?([A-Za-z]+)([\s\S]*?)\/?\s*>$/.exec(m[0]); if (!t) return false;
    const name = t[1]; if (!['svg','g','path','rect','circle','ellipse','line','polyline','polygon'].includes(name)) return false;
    if (closing) { if (self || t[2].trim() || stack.pop() !== name) return false; continue; }
    if (!root) { if (name !== 'svg') return false; root = true; } else if (!stack.length || name === 'svg') return false;
    let rest = t[2], a; const seen = new Set();
    const attr = /^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*"([^"]*)"/;
    while (rest.length) {
      if (!rest.trim()) break; a = attr.exec(rest); if (!a || seen.has(a[1])) return false; seen.add(a[1]); rest = rest.slice(a[0].length);
      const [key, value] = [a[1], a[2]];
      if (key === 'xmlns') { if (name !== 'svg' || value !== 'http://www.w3.org/2000/svg') return false; continue; }
      if (!['viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','fill-rule','stroke-linecap','stroke-linejoin'].includes(key)) return false;
      if (!/^[A-Za-z0-9#.,+\-\s]*$/.test(value) || /url|javascript|data/i.test(value)) return false;
      if (['x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','stroke-width','opacity','fill-opacity','stroke-opacity'].includes(key) && !/^-?\d+(?:\.\d+)?$/.test(value)) return false;
      if (key === 'viewBox' && !/^-?\d+(?:\.\d+)?(?:[ ,]+-?\d+(?:\.\d+)?){3}$/.test(value)) return false;
      if (key === 'd' && !/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/.test(value)) return false;
      if (key === 'points' && !/^[0-9.,+\-\s]+$/.test(value)) return false;
      if (['fill','stroke'].includes(key) && !/^(?:none|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(value)) return false;
      if (['width','height'].includes(key) && (!/^\d+(?:\.\d+)?$/.test(value) || +value <= 0 || +value > DIM)) return false;
    }
    if (!self) stack.push(name);
  }
  return root && !stack.length && !s.slice(pos).trim();
}
export function validateIcon(bytes, name) {
  if (!assetName(name) || !(bytes instanceof Uint8Array) || bytes.length > MAX) return false;
  return name.endsWith('.png') ? png(bytes) : svg(bytes);
}
export async function iconDescriptor(host, project, config) {
  const name = typeof project?.displayName === 'string' && project.displayName.trim() ? project.displayName : 'Unassigned';
  const fallback = { name, monogram: name.trim().charAt(0).toUpperCase() || '?', size: 18 };
  const mapping = config?.icons?.find(i => i.projectId === project?.id);
  if (!mapping || !assetName(mapping.asset)) return { ...fallback, image: null };
  try {
    // Host reads a single leaf within its private namespace and returns a local
    // renderer path only after enforcing containment and no symlink escape.
    const result = await bounded(host, () => host.readIcon(mapping.asset, MAX));
    if (!result || typeof result.path !== 'string' || !result.path || !validateIcon(result.bytes, mapping.asset)) return { ...fallback, image: null };
    return { ...fallback, image: { path: result.path, format: mapping.asset.slice(-3) } };
  } catch { return { ...fallback, image: null }; }
}
