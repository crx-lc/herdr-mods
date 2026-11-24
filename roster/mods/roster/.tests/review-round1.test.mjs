import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { rowAnchor } from '../disclosure.js';
import { machineKey } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function setup(mode = 'projects', terms = [terminal('t1'), terminal('edge/t2')]) {
  const f = fakeHost(terms); f.host.nativeNavigation = true;
  f.host.run = (name, args) => f.calls.push([name, args]);
  f.values.spaces = [{ id: 's1', name: 'One', active: true, tabs: [] }, { id: 'edge/s2', name: 'Two', machine: 'edge', tabs: [] }];
  const c = context(); c.cx.timer.after = () => {};
  const every = []; c.cx.timer.every = (_ms, fn) => every.push(fn);
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded, initialView: mode });
  const view = new Type(); view.init({}, c.cx);
  // A request is not layout/focus evidence. Enforce the native render-phase restriction.
  for (const scroll of [view.rowScroll, view.pinnedScroll, view.panelScroll, view.optionsScroll]) {
    const request = scroll.scroll_to_item.bind(scroll);
    scroll.scroll_to_item = at => { assert.notEqual(c.cx.phase, 'render'); request(at); };
  }
  const render = () => view.render(c.cx);
  const click = (tree, id) => { assert.ok(byId(tree, id), id); byId(tree, id).attributes.on_click[0]({}, c.cx); };
  const key = chord => { const stopped = c.stats.stop; view.key({ keystroke: chord }, c.cx); return c.stats.stop !== stopped; };
  const row = (address, pinned = false) => view.controller.projection.instances.find(i => i.row?.address === address && !!i.pinned === pinned);
  render(); return { f, view, ...c, every, render, click, key, row };
}
// These are the seven listed Stale/Unknown occurrences in the independent differential.
const unavailable = [
  ['unknown-lifecycle', 't1', f => { f.values.terminals[0].state = 'exited'; }],
  ['edge-loading', 'edge/t2', f => { f.values.machines[1].layout = 'loading'; }],
  ['loading-local-lifecycle', 't1', f => { f.values.terminals[0].state = 'exited'; f.values.machines[1].layout = 'loading'; }],
  ['edge-disconnected', 'edge/t2', f => { f.values.machines[1].layout = 'unavailable'; }],
  ['disconnected-local-lifecycle', 't1', f => { f.values.terminals[0].state = 'exited'; f.values.machines[1].layout = 'unavailable'; }],
  ['missing-local-machine', 't1', f => { f.values.machines.shift(); }],
  ['missing-local-lifecycle', 't1', f => { f.values.terminals[0].state = 'exited'; f.values.machines.shift(); }],
];
for (const mode of ['projects', 'status']) for (const [name, address, mutate] of unavailable) {
  test(`F1 ${mode} ${name}: Info, D and footer inspect without actions/reads`, async () => {
    const s = setup(mode); mutate(s.f); let tree = s.render(); const i = s.row(address);
    assert.ok(i); assert.equal(i.navigation.enabled, false);
    for (const trigger of ['info', 'd', 'footer']) {
      tree = s.render();
      if (trigger === 'info') s.click(tree, 'info:' + i.key);
      else { s.view.place(i.key); tree = s.render(); if (trigger === 'd') s.key('d'); else s.click(tree, 'details:open'); }
      tree = s.render(); await settle();
      assert.ok(byId(byId(tree, 'inline:' + i.key), 'roster-details'), trigger);
      assert.equal(byId(tree, 'details:go'), undefined);
      assert.match(textOf(byId(tree, 'details:unavailable')), /Open unavailable|Not opened/);
      s.key('escape'); assert.equal(s.view.panel, null);
    }
    assert.deepEqual(s.f.calls, []);
  });
}
for (const mode of ['projects', 'status', 'spaces']) test(`F1 pinned unavailable inspection stays in Needs you in ${mode}`, async () => {
  const s = setup(mode, [terminal('edge/t2', 'blocked')]);
  // A pending listed occurrence is inspectable regardless of navigation admission.
  s.f.values.panes = [{ pane: 'edge/p1', terminal: 'edge/t2', tab: 'edge/missing' }];
  let tree = s.render(); const i = s.row('edge/t2', true); assert.ok(i); assert.equal(i.navigation.enabled, false);
  for (const trigger of ['info', 'd', 'footer']) {
    tree = s.render(); s.view.place(i.key); tree = s.render();
    if (trigger === 'info') s.click(tree, 'info:' + i.key); else if (trigger === 'd') s.key('d'); else s.click(tree, 'details:open');
    tree = s.render(); await settle(); assert.ok(byId(byId(tree, 'roster-needs-you'), 'roster-details'));
    assert.equal(byId(tree, 'details:go'), undefined); s.key('escape');
  }
  assert.deepEqual(s.f.calls, []);
});

test('F1 live disconnect closes; a new inspection of the listed unavailable row opens; replacement still closes', async () => {
  const s = setup(); s.click(s.render(), 'info:' + s.row('edge/t2').key); s.render(); await settle();
  s.f.values.machines[1].layout = 'unavailable'; let tree = s.render(); assert.equal(byId(tree, 'roster-details'), undefined); await settle(); assert.equal(s.view.panel, null);
  s.click(s.render(), 'info:' + s.row('edge/t2').key); tree = s.render(); assert.ok(byId(tree, 'roster-details'));
  s.f.values.terminals[1].pid++; tree = s.render(); assert.equal(byId(tree, 'roster-details'), undefined); await settle(); assert.equal(s.view.panel, null);
  assert.deepEqual(s.f.calls, []);
});

test('F1 PID and run independently change inspection anchors even with a constant projection occurrence', () => {
  const s = setup(); s.render(); const i = s.row('t1'), snapshot = structuredClone(s.view.controller.feed.snapshot);
  const anchor = rowAnchor(i, snapshot);
  for (const change of [t => t.pid++, t => { t.labels['herdr.run'] = 'sample-run'; }]) {
    const next = structuredClone(snapshot); change(next.terminals[0]);
    assert.notEqual(rowAnchor(i, next), anchor);
  }
});

for (const kind of ['none', 'details', 'options', 'folder']) test(`F2 Tab boundaries propagate and inner traversal stays one-way: ${kind}`, async () => {
  const s = setup(kind === 'folder' ? 'spaces' : 'projects'); let tree = s.render();
  if (kind === 'details') s.click(tree, 'info:' + s.row('t1').key);
  if (kind === 'options') s.click(tree, 'tools:toggle');
  if (kind === 'folder') s.click(tree, 'machine-add:' + machineKey('edge'));
  s.render(); await settle();
  // Render again before choosing the current boundaries (footer may be present).
  for (const [side, chord] of [['first', 'shift-tab'], ['last', 'tab']]) {
    const target = side === 'first' ? s.view.controls[0] : s.view.controls.at(-1);
    s.view.place(target.key); const focus = s.stats.focus;
    assert.equal(s.key(chord), false, 'native traversal receives boundary');
    assert.equal(s.view.controller.cursor, target.key); assert.equal(s.stats.focus, focus);
  }
  for (const chord of ['tab', 'shift-tab']) {
    const at = 1, next = chord === 'tab' ? at + 1 : at - 1;
    s.view.place(s.view.controls[at].key); assert.equal(s.key(chord), true);
    assert.equal(s.view.controller.cursor, s.view.controls[next].key);
  }
  if (kind === 'folder') {
    s.view.place('new-space:path'); s.view.pathInput.handlers.focus();
    assert.equal(s.key('up'), false); assert.equal(s.key('enter'), false);
    assert.equal(s.key('tab'), true); assert.equal(s.view.inputFocused, false);
  }
  assert.deepEqual(s.f.calls, []);
});

for (const mode of ['projects', 'status', 'spaces']) test(`F3 bottom pinned Details reveals exact owning child once in ${mode}`, async () => {
  const s = setup(mode, [1, 2, 3, 4].map(n => terminal('t' + n, 'blocked'))); let tree = s.render(); await settle();
  const origin = s.row('t3', true), main = [...s.view.rowScroll.requests], folds = JSON.stringify(s.view.controller.state.folds);
  s.click(tree, 'info:' + origin.key); tree = s.render(); await settle();
  const owner = byId(tree, 'roster-needs-rows').children.findIndex(e => !!byId(e, 'roster-details'));
  assert.equal(owner, 2); assert.deepEqual(s.view.pinnedScroll.requests, [owner]);
  assert.deepEqual(s.view.rowScroll.requests, main); assert.deepEqual(s.view.panelScroll.requests, [0]);
  assert.equal(s.view.controller.cursor, 'details:close');
  s.render(); await settle(); s.key('escape'); s.render(); await settle();
  assert.deepEqual(s.view.pinnedScroll.requests, [owner]); assert.deepEqual(s.view.rowScroll.requests, main);
  assert.equal(JSON.stringify(s.view.controller.state.folds), folds); assert.deepEqual(s.f.calls, []);
});
for (const mode of ['projects', 'status']) test(`F3 bottom main Details reveals exact child and preserves pinned/options offsets in ${mode}`, async () => {
  const s = setup(mode, Array.from({ length: 20 }, (_, n) => terminal('t' + (n + 1)))); let tree = s.render(); await settle();
  const i = s.view.controller.projection.instances.filter(i => i.kind === 'terminal' && !i.pinned).at(-1);
  s.click(tree, 'info:' + i.key); tree = s.render(); await settle();
  const owner = byId(tree, 'roster-rows').children.findIndex(e => !!byId(e, 'roster-details'));
  assert.ok(owner > 10); assert.deepEqual(s.view.rowScroll.requests, [owner]);
  assert.deepEqual(s.view.pinnedScroll.requests, []); assert.deepEqual(s.view.optionsScroll.requests, []);
  s.key('escape'); s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, [owner]);
});
test('F3 bottom machine folder reveals its direct child, with no active-Space or close jump', async () => {
  const s = setup('spaces'); s.f.values.spaces.push(...Array.from({ length: 20 }, (_, n) => ({ id: 'sample-' + n, name: 'Sample', tabs: [] })));
  let tree = s.render(); await settle(); const before = [...s.view.rowScroll.requests];
  s.click(tree, 'machine-add:' + machineKey('edge')); tree = s.render(); await settle();
  const owner = byId(tree, 'roster-rows').children.findIndex(e => !!byId(e, 'roster-new-space'));
  assert.ok(owner > 20); assert.deepEqual(s.view.rowScroll.requests.slice(before.length), [owner]);
  const opened = [...s.view.rowScroll.requests]; s.key('escape'); s.render(); await settle();
  assert.deepEqual(s.view.rowScroll.requests, opened); assert.deepEqual(s.view.pinnedScroll.requests, []);
});

for (const focus of ['absent', 'throws', 'actual']) test(`F4 input focus ${focus}: request after mount, editing only on actual event`, async () => {
  const s = setup('spaces'); s.click(s.render(), 'machine-add:' + machineKey('edge'));
  const input = s.view.pathInput; let requests = 0;
  input.focus = () => { requests++; if (focus === 'throws') throw Error('not mounted'); if (focus === 'actual') input.handlers.focus(); };
  assert.equal(s.view.inputFocused, false); assert.equal(requests, 0);
  s.render(); await settle(); assert.equal(requests, 1); assert.equal(s.view.inputFocused, focus === 'actual');
  if (focus !== 'actual') {
    assert.equal(s.key('enter'), true); assert.equal(s.key('space'), true);
    assert.equal(s.view.inputFocused, false);
  }
  const before = s.view.controller.cursor;
  assert.equal(s.key('up'), focus !== 'actual');
  if (focus === 'actual') assert.equal(s.view.controller.cursor, before); else assert.notEqual(s.view.controller.cursor, before);
  assert.deepEqual(s.f.calls, []); s.key('escape'); assert.equal(s.view.panel, null);
});
test('F4 cancelled, replaced, blurred and late input events cannot steal keyboard ownership', async () => {
  const s = setup('spaces'); s.click(s.render(), 'machine-add:' + machineKey('edge'));
  const old = s.view.pathInput; let requested = 0; old.focus = () => requested++;
  s.render(); s.key('escape'); await settle(); assert.equal(requested, 0); old.handlers.focus(); assert.equal(s.view.inputFocused, false);
  s.click(s.render(), 'machine-add:' + machineKey('edge')); s.render(); const current = s.view.pathInput;
  old.handlers.focus(); assert.equal(s.view.inputFocused, false);
  current.handlers.focus(); assert.equal(s.view.inputFocused, true);
  current.handlers.blur(); assert.equal(s.view.inputFocused, false);
  s.key('tab'); old.handlers.focus(); assert.equal(s.view.inputFocused, false);
  s.stats.focused = null; const count = s.stats.focus; s.f.values.machines[1].layout = 'unavailable'; s.render(); await settle();
  assert.equal(s.stats.focus, count); assert.equal(s.view.panel, null); assert.deepEqual(s.f.calls, []);
});

for (const when of ['normal', 'open-close', 'close-before-task', 'disappear', 'tab-change', 'refresh']) test(`F5 selection reveal is fresh and never replayed after inspection: ${when}`, async () => {
  const s = setup('spaces'); s.render(); await settle(); s.view.rowScroll.requests.length = 0;
  if (when !== 'normal' && when !== 'refresh') { s.click(s.render(), 'tools:toggle'); s.render(); await settle(); }
  s.f.values.spaces[0].active = false; s.f.values.spaces[1].active = true;
  s.render();
  if (when === 'close-before-task') s.key('escape');
  if (when === 'disappear') { s.f.values.spaces.pop(); s.render(); }
  if (when === 'tab-change') { s.click(s.render(), 'mode:status'); s.render(); }
  await settle();
  if (when === 'normal' || when === 'refresh') {
    const target = s.view.controls.find(c => c.key === 'space:edge/s2');
    assert.deepEqual(s.view.rowScroll.requests, [target.rowIndex], 'no 1s timer needed');
  } else {
    assert.deepEqual(s.view.rowScroll.requests, []);
    if (s.view.panel) s.key('escape'); s.render(); await settle();
    assert.deepEqual(s.view.rowScroll.requests, []);
  }
  const requests = [...s.view.rowScroll.requests];
  s.view.controller.observe(true); s.render(); await settle();
  for (const fn of s.every) fn(s.cx); await settle();
  assert.deepEqual(s.view.rowScroll.requests, requests, 'refresh/timer cannot replay old selection');
  assert.deepEqual(s.f.calls, []);
});


test('F5 stale queued selection cannot scroll after the target disappears before another render', async () => {
  const s = setup('spaces'); s.render(); await settle(); s.view.rowScroll.requests.length = 0;
  s.f.values.spaces[0].active = false; s.f.values.spaces[1].active = true; s.render();
  s.f.values.spaces.pop(); await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
  s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
});


test('F4 actual pointer focus on the mounted field resumes editing after sidebar traversal', async () => {
  const s = setup('spaces'); s.click(s.render(), 'machine-add:' + machineKey('edge')); s.render(); await settle();
  s.key('tab'); assert.notEqual(s.view.controller.cursor, 'new-space:path');
  s.view.pathInput.handlers.focus(); assert.equal(s.view.inputFocused, true); assert.equal(s.view.controller.cursor, 'new-space:path');
  assert.equal(s.key('up'), false); s.view.pathInput.handlers.blur(); assert.equal(s.view.inputFocused, false);
});
