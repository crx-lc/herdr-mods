import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { machineKey } from '../spaces.js';
import { kit, context, fakeHost, terminal, appOf, expanded, flatten, layoutHostUnused } from './sidebar-fixtures.mjs';
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const settle = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const trigger = 'machine-add:' + machineKey('edge');
const spaces = () => Array.from({ length: 8 }, (_, n) => ({ id: 'sp' + n, name: 'Sample ' + n, active: n === 0, tabs: [] }));
function setup() {
  const f = fakeHost([terminal('t1')]); f.values.spaces = spaces();
  f.host.run = (name, args) => f.calls.push([name, args]);
  const c = context(); c.cx.timer.after = () => {};
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded, initialView: 'spaces' });
  const view = new Type(); view.init({}, c.cx);
  const render = () => view.render(c.cx);
  const click = id => { const el = byId(render(), id); assert.ok(el, id); el.attributes.on_click[0]({}, c.cx); };
  const key = chord => view.key({ keystroke: chord }, c.cx);
  for (const scroll of [view.rowScroll, view.panelScroll, view.pinnedScroll]) {
    const request = scroll.scroll_to_item.bind(scroll);
    scroll.scroll_to_item = at => { assert.notEqual(c.cx.phase, 'render'); request(at); };
  }
  return { ...c, f, view, render, click, key };
}
async function ready() { const s = setup(); s.render(); await settle(); s.view.rowScroll.requests.length = 0; return s; }
function inputProbe(s, actual = false) {
  const input = s.view.pathInput; let count = 0;
  input.focus = () => { assert.notEqual(s.cx.phase, 'render'); count++; if (actual) { s.stats.focused = null; input.handlers.focus(); } };
  return { input, count: () => count };
}
for (const via of ['pointer', 'keyboard']) test(`N1 repeated ${via} reopen after actual input focus and Esc focuses from exact trigger`, async () => {
  const s = await ready(); s.click(trigger);
  let p = inputProbe(s, true); s.render(); await settle(); assert.equal(p.count(), 1); assert.equal(s.view.inputFocused, true);
  for (let n = 0; n < 3; n++) {
    s.key('escape'); assert.equal(s.view.panel, null);
    assert.equal(s.view.handle.is_focused(), false);
    assert.equal(s.view.triggerHandles.get(trigger).is_focused(), true);
    s.render(); await settle();
    if (via === 'pointer') s.click(trigger); else s.key('enter');
    p = inputProbe(s); s.render(); await settle();
    assert.equal(p.count(), 1); assert.equal(s.view.inputFocused, false, 'request is not focus');
    s.stats.focused = null; p.input.handlers.focus(); assert.equal(s.view.inputFocused, true);
  }
  assert.deepEqual(s.f.calls, []);
});
for (const held of ['root', 'owner', 'other-control', 'outside', 'moved-cursor', 'unavailable', 'cancel', 'replace']) test(`N1 deferred focus guard: ${held}`, async () => {
  const s = await ready(); s.click(trigger); const p = inputProbe(s);
  if (held === 'owner') s.view.triggerHandles.get(trigger).focus();
  if (held === 'other-control') s.view.triggerHandles.get('mode:projects').focus();
  if (held === 'outside') s.stats.focused = null;
  if (held === 'moved-cursor') s.view.place('new-space:cancel');
  if (held === 'unavailable') s.f.values.machines[1].layout = 'unavailable';
  s.render();
  if (held === 'cancel') s.key('escape');
  if (held === 'replace') s.view.openNewSpace(null, s.cx, 'spaces:new');
  await settle();
  assert.equal(p.count(), ['root', 'owner'].includes(held) ? 1 : 0);
  assert.equal(s.view.inputFocused, false);
  if (['cancel', 'replace', 'unavailable'].includes(held)) { p.input.handlers.focus(); assert.equal(s.view.inputFocused, false); }
  assert.deepEqual(s.f.calls, []);
});
for (const mode of ['projects', 'status']) for (const changed of [false, true]) test(`N2 return from ${mode}, active changed=${changed}`, async () => {
  const s = await ready(); s.click('mode:' + mode); s.render(); await settle();
  if (changed) s.f.values.spaces.forEach((sp, n) => sp.active = n === 7);
  s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
  s.click('mode:spaces'); s.render(); const cursor = s.view.controller.cursor, focus = s.stats.focus;
  await settle(); assert.deepEqual(s.view.rowScroll.requests, [changed ? 8 : 1]);
  assert.equal(s.view.controller.cursor, cursor); assert.equal(s.stats.focus, focus);
  s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, [changed ? 8 : 1]);
  assert.deepEqual(s.f.calls, []);
});
for (const kind of ['insertion', 'reorder']) test(`N2 same active id changes drawn position by ${kind}`, async () => {
  const s = await ready();
  if (kind === 'insertion') s.f.values.spaces.unshift({ id: 'new', name: 'New', tabs: [] });
  else s.f.values.spaces.push(s.f.values.spaces.shift());
  const cursor = s.view.controller.cursor, focus = s.stats.focus;
  s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, [kind === 'insertion' ? 2 : 8]);
  assert.equal(s.view.controller.cursor, cursor); assert.equal(s.stats.focus, focus);
  const notify = s.stats.notify; s.render(); await settle(); assert.equal(s.stats.notify, notify);
  assert.deepEqual(s.view.pinnedScroll.requests, []); assert.deepEqual(s.f.calls, []);
});
for (const kind of ['refresh', 'fold', 'unrelated-insertion', 'vanish', 'old-index', 'old-render']) test(`N2 no stale or unrelated jump: ${kind}`, async () => {
  const s = await ready();
  if (kind === 'fold') s.click(machineKey(null));
  if (kind === 'unrelated-insertion') s.f.values.spaces.push({ id: 'new', name: 'New', tabs: [] });
  if (['vanish', 'old-index', 'old-render'].includes(kind)) {
    s.f.values.spaces.forEach((sp, n) => sp.active = n === 7); s.render();
    if (kind === 'vanish') s.f.values.spaces.pop();
    else if (kind === 'old-index') s.f.values.spaces.unshift({ id: 'new', name: 'New', tabs: [] });
    else { s.f.values.spaces.forEach((sp, n) => sp.active = n === 0); s.render(); }
    await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
    if (kind === 'old-index') return; // A subsequent fresh render may reveal the new position.
  }
  s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
  assert.deepEqual(s.f.calls, []);
});
for (const panel of ['options', 'folder']) for (const beforeTask of [false, true]) test(`N2 ${panel} consumes active/position changes; close before task=${beforeTask}`, async () => {
  const s = await ready(); s.click(panel === 'options' ? 'tools:toggle' : trigger); s.render(); await settle();
  s.view.rowScroll.requests.length = 0;
  s.f.values.spaces.forEach((sp, n) => sp.active = n === 7);
  s.f.values.spaces.unshift({ id: 'new', name: 'New', tabs: [] });
  s.render(); if (beforeTask) s.key('escape'); await settle();
  assert.deepEqual(s.view.rowScroll.requests, []);
  if (s.view.panel) s.key('escape'); s.render(); await settle();
  const notify = s.stats.notify, focus = s.stats.focus, cursor = s.view.controller.cursor;
  s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
  assert.equal(s.stats.notify, notify); assert.equal(s.stats.focus, focus); assert.equal(s.view.controller.cursor, cursor);
  assert.deepEqual(s.f.calls, []);
});

test('N2 folding a preceding machine changes drawn index without a selection jump', async () => {
  const s = await ready();
  s.f.values.spaces.push({ id: 'edge/active', machine: 'edge', name: 'Active', active: true, tabs: [] });
  s.f.values.spaces[0].active = false; s.render(); await settle(); s.view.rowScroll.requests.length = 0;
  const before = s.view.controls.find(c => c.key === 'space:edge/active').rowIndex;
  s.click(machineKey(null)); s.render(); await settle();
  assert.ok(s.view.controls.find(c => c.key === 'space:edge/active').rowIndex < before);
  assert.deepEqual(s.view.rowScroll.requests, []);
  s.click(machineKey(null)); s.render(); await settle(); assert.deepEqual(s.view.rowScroll.requests, []);
  assert.deepEqual(s.f.calls, []);
});
test('N2 explicit Space activation retains the drawn native id', async () => {
  const s = await ready(); s.click('space:sp7');
  assert.deepEqual(s.f.calls, [['space.select', { id: 'sp7' }]]);
});
