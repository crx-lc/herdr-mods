import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

// Neutral sample: verified tasks come only from herdr.issue / herdr.pr labels.
const THEME = { surface: '#16181c', raised: '#24272d', foreground: '#e8e8e8', muted: '#9aa0a6', dim: '#6b7076', working: '#e0a040', blocked: '#e06c75', done: '#5fb878', idle: '#8a9099', unknown: '#777777' };
function desk(extra = []) {
  const f = fakeHost([
    terminal('t1', 'working', { created_ms: 100, labels: { 'herdr.role': 'developer', 'herdr.issue': 'sample/agents#141' } }),
    terminal('t2', 'working', { created_ms: 110, labels: { 'herdr.role': 'developer', 'herdr.project': 'sample-mods' } }),
    terminal('edge/t3', 'done', { created_ms: 120, labels: { 'herdr.role': 'planner', 'herdr.pr': 'https://github.com/sample/mods/pull/9' } }),
    terminal('edge/t4', 'done', { created_ms: 130, labels: { 'herdr.role': 'reviewer' } }),
    terminal('t5', 'idle', { created_ms: 140, labels: { 'herdr.role': 'watcher' } }),
    terminal('t6', 'nonsense', { created_ms: 150 }), ...extra]);
  f.values.panes = ['t1', 't2', 'edge/t3', 'edge/t4', 't5', 't6'].map(a => ({ pane: a.replace(/t(\w+)$/, 'p$1'), terminal: a, tab: a.startsWith('edge/') ? 'edge/tab' : 'tab' }));
  f.values.spaces = [{ id: 's1', name: 'Local work', machine: null, tabs: [{ id: 'tab', name: '1', named: false }] },
    { id: 'edge/s1', name: 'Remote work', machine: 'edge', tabs: [{ id: 'edge/tab', name: '1', named: false }] }];
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  return f;
}
function setup(f, { view = 'status', cx: custom } = {}) {
  const app = { ...appOf(f.host), theme: () => THEME, settings: () => null };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, initialView: view, collapseUnassigned: false, storage: null });
  const v = new Type(), c = custom ?? context(); v.init({}, c.cx);
  return { f, view: v, ...c, render: () => v.render(c.cx) };
}
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const sections = s => s.view.controller.projection.instances.filter(i => i.kind === 'section');
const row = (s, address) => s.view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === address && !i.pinned);
const unfoldAll = s => { s.render(); for (const x of sections(s).filter(x => x.collapsed)) s.view.controller.change({ type: 'fold', key: x.key, collapsed: false }); return s.render(); };

test('headers read as sections: distinct icons, 13px bold, clear space above all but the first', () => {
  const s = setup(desk([terminal('t9', 'blocked', { created_ms: 90 })])); const tree = unfoldAll(s);
  const heads = sections(s).filter(x => !x.pinned).map(x => byId(tree, x.key));
  assert.deepEqual(sections(s).filter(x => !x.pinned).map(x => x.label), ['Working', 'Done', 'Idle', 'Unknown']);
  const icons = [byId(tree, 'group-icon:' + JSON.stringify(['attention'])).children[0], ...heads.map(h => h.children[0])].map(e => e.attributes.svg[0]);
  assert.equal(new Set(icons).size, icons.length, 'one icon per group: ' + icons.join(', '));
  for (const h of heads) {
    const title = h.children.find(e => /^group-label:/.test(e.attributes.id?.[0] ?? ''));
    assert.equal(title.attributes.text_size[0], 13); assert.ok(title.attributes.font_bold);
  }
  assert.deepEqual(heads.map(h => h.attributes.mt[0]), [0, 8, 8, 8], 'the first header sits at the top; the rest get space above');
  // Rows stay compact and their names are not bold.
  for (const i of s.view.controller.projection.instances.filter(i => i.kind === 'terminal')) {
    assert.equal(byId(tree, i.key).attributes.h[0], 24);
    const name = byId(tree, 'row-name:' + i.key);
    assert.equal(name.attributes.font_semibold ?? name.attributes.font_bold, undefined, i.row.address);
  }
});

test('Working and Done show the verified task, or say Task not reported; a Done session is not a closed issue', () => {
  const s = setup(desk()); const tree = unfoldAll(s);
  const line = address => textOf(byId(tree, row(s, address).key)).replace(/\s+/g, ' ').trim();
  assert.match(line('t1'), /^Developer · agents #141/, 'name, then the task');
  assert.match(line('t2'), /^Developer · Task not reported/, 'direct work without a label');
  assert.match(line('edge/t3'), /^Planner · mods PR #9/);
  assert.match(line('edge/t4'), /^Reviewer · Task not reported/);
  assert.doesNotMatch(line('t5'), /Task/, 'Idle: no placeholder');
  // The task stands out: full contrast and semibold; the placeholder is dim.
  const task = byId(tree, 'row-task:' + row(s, 't1').key), none = byId(tree, 'row-task:' + row(s, 't2').key);
  assert.ok(task.attributes.font_semibold); assert.equal(task.attributes.text_color[0], THEME.foreground);
  assert.equal(none.attributes.text_color[0], THEME.dim); assert.equal(none.attributes.font_semibold, undefined);
  assert.match(byId(tree, 'row-task:' + row(s, 'edge/t3').key).attributes.accessibility_label[0], /^GitHub pull request PR #9 in sample\/mods; the session is done, the pull request state is not checked$/);
  assert.doesNotMatch(textOf(tree), /closed|merged|resolved/i);
  // Projects shows a task where there is one, and no placeholder.
  s.view.controller.change({ type: 'view', view: 'projects' }); const p = unfoldAll(s);
  assert.match(textOf(byId(p, row(s, 't1').key)), /agents #141/);
  assert.doesNotMatch(textOf(byId(p, 'roster-rows')), /Task not reported/);
  assert.deepEqual(s.f.calls, []);
});

test('the bell pulses for the first item when the section appears, and for each new one; never replayed', () => {
  let clock = 1000;
  const f = desk(); f.host.now = () => clock;
  const c = context(), every = [], after = [];
  c.cx.timer.every = (ms, fn) => every.push({ ms, fn }); c.cx.timer.after = (ms, fn) => after.push({ ms, fn });
  const s = setup(f, { cx: c }); const tick = () => every[0].fn(s.cx);
  const bell = () => byId(s.render(), 'group-icon:' + JSON.stringify(['attention']));
  // A tick before anything is drawn sets no baseline.
  tick(); assert.equal(s.stats.notify, 0);
  s.render(); tick(); assert.equal(s.stats.notify, 0, 'nothing pending: nothing to pulse');
  assert.equal(byId(s.render(), 'roster-needs-you'), undefined);
  // The first item: the section appears and its bell pulses, on a box around the icon.
  f.values.terminals = f.values.terminals.map(t => t.address === 't5' ? { ...t, status: 'blocked' } : t);
  s.render(); tick();
  assert.equal(s.stats.notify, 1);
  assert.deepEqual(bell().attributes.loop, ['opacity', { from: 0.3, to: 1, period: 650 }]);
  assert.equal(bell().children[0].attributes.svg[0], 'mods/roster/icons/bell.svg');
  // Refreshes during and after the pulse never replay it.
  for (let n = 0; n < 3; n++) { s.render(); tick(); }
  assert.equal(s.stats.notify, 1); assert.equal(after.length, 1);
  clock += 2000; after[0].fn(s.cx);
  for (let n = 0; n < 3; n++) { s.render(); tick(); assert.equal(bell().attributes.loop, undefined); }
  assert.equal(s.stats.notify, 2, 'one redraw to start, one to stop');
  // A second arrival pulses again.
  f.values.terminals = f.values.terminals.map(t => t.address === 't6' ? { ...t, status: 'blocked' } : t);
  s.render(); tick();
  assert.equal(s.stats.notify, 3); assert.ok(bell().attributes.loop);
});

test('sessions already pending when Roster starts never pulse, even if the first look comes before the first draw', () => {
  const f = desk([terminal('t9', 'blocked', { created_ms: 90 })]);
  const c = context(), every = [];
  c.cx.timer.every = (ms, fn) => every.push({ ms, fn }); c.cx.timer.after = () => {};
  const s = setup(f, { cx: c });
  every[0].fn(s.cx); s.render(); every[0].fn(s.cx); s.render(); every[0].fn(s.cx);
  assert.equal(s.stats.notify, 0);
  assert.equal(byId(s.render(), 'group-icon:' + JSON.stringify(['attention'])).attributes.loop, undefined);
});

test('every status group has its own icon, and each one ships with Roster', async () => {
  const { STATUS_ICONS } = await import('../view.js');
  const { SHIPPING } = await import('../../../../scripts/roster-package.mjs');
  const names = Object.values(STATUS_ICONS);
  assert.equal(new Set(names).size, names.length, names.join(', '));
  for (const name of names) assert.ok(SHIPPING.includes('icons/' + name + '.svg'), name);
});
