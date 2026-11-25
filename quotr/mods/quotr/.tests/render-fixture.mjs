// Execute the production module graph with recording builders. This is NOT GPUI.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Recording builders expose structure only, not native text metrics or layout.
function builder(kind) {
  const e = { kind, attrs: {}, kids: [], ops: [] };
  const proxy = new Proxy(e, { get(target, name) {
    if (name in target) return target[name];
    if (name === 'then') return undefined;
    if (name === 'child') return value => { if (value != null) e.kids.push(value); return proxy; };
    if (name === 'children') return values => { e.kids.push(...values); return proxy; };
    if (name === 'when') return (cond, fn) => cond ? fn(proxy) : proxy;
    return (...args) => { e.ops.push([name, args]); e.attrs[name] = args; return proxy; };
  } });
  return proxy;
}
export const flatten = tree => tree && typeof tree === 'object' && tree.kids ? [tree, ...tree.kids.flatMap(flatten)] : [];
export const byId = (tree, id) => flatten(tree).find(e => e.attrs.id?.[0] === id);
export const textOf = tree => tree?.kids ? tree.kids.map(textOf).join('') : String(tree ?? '');
const url = text => `data:text/javascript,${encodeURIComponent(text)}`;
const key = '__quotr_render_fixture';
const calls = [];
let storageText = null;
let isChecking = true;
globalThis.localStorage = { getItem: () => storageText, setItem: () => { throw Error('Unadmitted storage write'); } };
const input = { new: () => ({ handlers: {}, value: () => '', set_value() {}, on(name, fn) { this.handlers[name] = fn; } }) };
const colors = { chrome: '#10141c', foreground: '#e4e8ef', dim: '#8f9cad', muted: '#a5b1c1', border: '#354055', input: '#4b5970', background: '#171d29', ansi1: '#ef8989', ansi2: '#80dca5', blocked: '#efc078', done: '#80dca5', working: '#8bbcff', hover: '#222d40' };
const forbidden = name => () => { throw Error(`Unadmitted host call: ${name}`); };
const api = {
  View: class {}, div: () => builder('div'), image: path => builder('image').source(path),
  h_flex: () => builder('h'), v_flex: () => builder('v'),
  InputState: input, Input: { new: state => builder('input').placeholder(state.placeholder ?? 'Add a ticker') },
  // The sparkline card (charts.js); drawn only after a hover rest, which these fixtures never do.
  Popup: { new: (id, trigger) => builder('popup').popup(id).child(trigger) },
  PathBuilder: { stroke: () => builder('path'), fill: () => builder('path') }, Background: { solid: () => builder('paint') },
  checking: () => isChecking, props: () => ({}), theme: () => colors, settings: () => ({ dark: true }),
  shared: () => null, setShared: forbidden('setShared'), nextCommand: () => new Promise(() => {}),
  openOverlay: options => { calls.push(['overlay', options]); }, closeOverlay: forbidden('closeOverlay'),
  exec: forbidden('exec'), run: forbidden('run'), appHome: forbidden('appHome'), window: () => null,
  readFile: forbidden('readFile'), writeFile: forbidden('writeFile'), exists: forbidden('exists'),
  mkdir: forbidden('mkdir'), unlink: forbidden('unlink'),
};
globalThis[key] = api;
globalThis.window = { paint_path: (path, paint) => builder("path-layer").child(path).paint(paint) };
const exportsFor = names => url(names.map(name => `export const ${name} = globalThis.${key}.${name};`).join('\n'));
const bare = {
  'gpui-kit': exportsFor(['View', 'div', 'image', 'PathBuilder', 'Background']),
  'gpui-base': exportsFor(['h_flex', 'v_flex', 'InputState', 'Input', 'Popup']),
  herdr: exportsFor(['nextCommand', 'openOverlay', 'closeOverlay', 'props', 'shared', 'setShared', 'theme', 'checking', 'exec', 'settings', 'appHome', 'window', 'run']),
  'fs/promises': exportsFor(['readFile', 'writeFile', 'exists', 'mkdir', 'unlink']),
};
const cache = new Map();
export async function production(path) {
  path = resolve(path);
  if (cache.has(path)) return cache.get(path);
  let source = await readFile(path, 'utf8');
  const matches = [...source.matchAll(/from\s+(["'])([^"']+)\1/g)];
  for (const match of matches) {
    const specifier = match[2];
    const target = bare[specifier] ?? (specifier.startsWith('.') ? await production(resolve(dirname(path), specifier)) : null);
    if (!target) throw Error(`Unknown production import ${specifier}`);
    source = source.replace(match[0], `from ${JSON.stringify(target)}`);
  }
  const result = url(source); cache.set(path, result); return result;
}
export const modRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { default: Quotr } = await import(await production(resolve(modRoot, 'main.js')));
export const { MarketClock } = await import(await production(resolve(modRoot, 'clockview.js')));
export const symbols = ['Q', 'LONGSYMBOL1234567890123456789012', 'LOW/USDT', 'STALE', 'MISSING'];
export function fixture({ checking = true } = {}) {
  isChecking = checking;
  const stats = { notifications: 0, phase: 'event' }, pending = [];
  const cx = { notify: () => { if (stats.phase === 'render') throw Error('render notify'); stats.notifications++; },
    spawn: fn => pending.push(fn), new: (Type, props) => { const view = new Type(); view.init(props, cx); return view; } };
  const view = new Quotr(); view.init({}, cx);
  const now = Date.now();
  let saved = { version: 1, paused: false, symbols: [...symbols] };
  const edits = [];
  view.watch.host.load = () => structuredClone(saved);
  view.watch.host.save = preferences => { saved = structuredClone(preferences); edits.push(saved); };
  view.watch.preferences = structuredClone(saved);
  const quote = (symbol, price, changePercent) => ({ symbol, price, changePercent, currency: 'USD', name: 'Neutral sample instrument with a long name', timestamp: now, fetchedAt: now, series: [price * 0.98, price * 1.01, price], previousClose: price * 0.99 });
  view.watch.quotes = { Q: quote('Q', 9876543.21, 12.34), [symbols[1]]: quote(symbols[1], 123.45, -98.76),
    'LOW/USDT': quote('LOW/USDT', 0.000012345, -0.12), STALE: { ...quote('STALE', 500.5, null), fetchedAt: now - 600000 } };
  view.watch.errors = { STALE: 'Source unavailable', MISSING: 'No quote returned' };
  view.watch.inflight = new Set(['Q']); view.flashes = { Q: { dir: 'up', id: 1, on: true } };
  // No downloads are run; monograms and charts use production drawing descriptions.
  const render = () => { stats.phase = 'render'; try { return view.render(); } finally { stats.phase = 'event'; } };
  const resize = (width, height = 640) => { const tree = render(); byId(tree, 'quotr').attrs.on_size_change[0]({ width, height }, cx); return render(); };
  return { view, cx, stats, calls, render, resize, pending, edits };
}

let clockSerial = 0;
export async function clockFixture(schedule = null) {
  storageText = schedule ? JSON.stringify(schedule) : null;
  const { MarketClock: Type } = await import((await production(resolve(modRoot, 'clockview.js'))) + `#${++clockSerial}`);
  const stats = { notifications: 0 };
  const cx = { notify: () => stats.notifications++ };
  const clock = new Type(); clock.init({ band: false }, cx);
  const resize = width => { const tree = clock.render(); byId(tree, 'quotr-clock').attrs.on_size_change[0]({ width, height: 42 }, cx); return clock.render(); };
  return { clock, cx, stats, resize };
}
