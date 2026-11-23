import assert from 'node:assert/strict';
// Behavior tests below predate default-collapsed Unassigned/Unknown groups; they opt out.
export const expanded = { collapseUnassigned: false };
export const run = '11111111-1111-4111-8111-111111111111';
export const terminal = (address, status = 'working', extra = {}) => ({ address, state: 'live', status, created_ms: 100,
  pid: 100, argv: ['codex-auto'], keep: false, parent: null, labels: {}, ...extra });
export function fixture() {
  const producer = terminal('t1', 'idle', { keep: true, labels: { 'herdr.role': 'coordinator', 'herdr.run': run, 'herdr.delegations': '/sample/delegations.json', 'herdr.project': 'sample' } });
  const children = ['t2', 't3', 't4'].map((a, i) => terminal(a, 'working', { parent: 't1', created_ms: 200 + i, pid: 200 + i,
    labels: { 'herdr.role': i === 2 ? 'reviewer' : 'developer', 'herdr.run': run, 'herdr.launch': `assignment-${i}` } }));
  const incarnation = t => ({ address: t.address, created: t.created_ms, pid: t.pid, program: t.argv[0], keep: t.keep, run });
  const doc = { schema: 'herdr-agents/delegations', version: 1, producer: { core: 'core-a', terminal: incarnation(producer) }, revision: 1,
    assignments: children.map((c, i) => ({ id: `assignment-${i}`, role: i === 2 ? 'reviewer' : 'developer', state: 'active', revision: 1, ended: null, child: incarnation(c) })) };
  return { producer, children, doc };
}
export function fakeHost(terminals = [terminal('t1')]) {
  const values = { terminals, machines: [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }], panes: [], spaces: [], agents: [], focused: null };
  const counts = {}, calls = [], host = { now: () => 1000,
    run: (command, args) => { assert.ok(['pane.focus', 'terminal.peek'].includes(command), `prohibited ${command}`); assert.deepEqual(Object.keys(args), ['terminal']); calls.push([command, args]); },
    readTextFile: () => { throw Error('unadmitted file read'); }, deadline: p => p };
  for (const key of Object.keys(values)) host[key] = () => {
    if (key === 'panes') for (const pane of values.panes) assert.ok(!Object.hasOwn(pane ?? {}, 'id'), 'PaneInfo uses pane, never id');
    counts[key] = (counts[key] ?? 0) + 1; return structuredClone(values[key]); };
  return { host, values, counts, calls };
}
export const cores = [{ alias: '', id: 'core-a', verified: true, source: 'independent-fixture' }, { alias: 'edge', id: 'core-b', verified: true, source: 'independent-fixture' }];
export const settings = JSON.stringify({ version: 1, projects: [{ id: 'sample', displayName: 'Sample project' }], projectBindings: [{ coreId: 'core-a', token: 'sample', projectId: 'sample' }], contexts: [], processProviders: [], projectProviders: [], icons: [] });
export function prove(host, extra = {}) {
  const evidence = { cores: structuredClone(cores), routes: [], documents: [], scopes: [], correlations: [], admissions: [], panesComplete: true, ...extra };
  host.evidence = () => structuredClone(evidence);
  return evidence;
}
export const association = (core, address, created = 100) => JSON.stringify([JSON.stringify(['core', core, address]), created]);
export const route = (core, terminalId, address, presentation = 'pane-less', generation = 1) => ({ associationKey: association(core, terminalId),
  coreId: core, address, presentation, generation, verified: true, source: 'independent-current-model' });
export class Element {
  constructor() { this.children = []; this.attributes = {}; }
  child(v) { this.children.push(v); return this; }
}
for (const name of ['flex', 'flex_col', 'flex_row', 'gap', 'p', 'pl', 'w', 'h', 'id', 'text_size', 'bg', 'text_color', 'size_full', 'flex_1', 'overflow_y_scrollbar', 'track_focus', 'on_key_down', 'on_click', 'accessibility_label', 'tooltip', 'items_center', 'min_w', 'min_h', 'max_h', 'max_w', 'px', 'rounded', 'flex_none', 'truncate', 'font_semibold', 'justify_center', 'track_scroll', 'cursor_pointer', 'cursor_default', 'frames', 'hover', 'border', 'border_color', 'py', 'w_full', 'whitespace_normal', 'line_height']) {
  Element.prototype[name] = function (...args) { this.attributes[name] = args; return this; };
}
// Like GPUI: cx.notify() during render throws ("not allowed during the `render` phase").
class GuardedView {
  constructor() {
    const render = this.render;
    if (typeof render === 'function') this.render = function (cx, ...rest) {
      const outer = cx.phase; cx.phase = 'render';
      try { return render.call(this, cx, ...rest); } finally { cx.phase = outer; }
    };
  }
}
export const kit = { View: GuardedView, ScrollHandle: { new: () => ({ requests: [], scroll_to_item(index) { this.requests.push(index); } }) }, div: () => new Element(), h_flex: () => new Element().flex().flex_row(), v_flex: () => new Element().flex().flex_col() };
export function context() {
  const stats = { focus: 0, notify: 0, stop: 0 }, timers = [], tasks = [];
  const cx = { focus_handle: () => ({ focus: () => stats.focus++ }), notify: () => {
    if (cx.phase === 'render') throw Error('cx.notify() is not allowed during the `render` phase; request a re-render from an event handler instead');
    stats.notify++; }, stop_propagation: () => stats.stop++,
    timer: { after: (ms, callback) => { assert.equal(ms, 2000); timers.push(callback); } }, spawn: fn => { tasks.push(Promise.resolve().then(() => fn(cx))); } };
  return { cx, stats, timers, tasks };
}
export const flatten = e => e instanceof Element ? [e, ...e.children.flatMap(flatten)] : [];
export const textOf = e => e instanceof Element ? e.children.map(textOf).join(' ') : String(e ?? '');
export const appOf = host => ({ ...host, theme: () => ({ surface: '#111111', raised: '#222222', foreground: '#eeeeee' }), props: () => ({}), checking: () => false, nextCommand: () => new Promise(() => {}) });
export const layoutHostUnused = new Proxy({}, { get: (_t, p) => () => { throw Error(`unexpected layout ${String(p)}`); } });
