// Regressions from the native Windows check of the inline panels (PR #31): the remote path
// field never got focus after +, Enter after Esc did not reopen the form, Tab left Roster from
// any control, and the folder form at the bottom machine hid its focused field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView, TAB_ACTIONS, FOLDER } from '../view.js';
import { machineKey } from '../spaces.js';
import { kit, context, fakeHost, terminal, appOf, expanded, flatten, layoutHostUnused } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const settle = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const trigger = 'machine-add:' + machineKey('edge');
const local = 'machine-add:' + machineKey(null);
const spaces = () => Array.from({ length: 8 }, (_, n) => ({ id: 'sp' + n, name: 'Sample ' + n, active: n === 0, tabs: [] }));

function setup() {
  const f = fakeHost([terminal('t1')]); f.values.spaces = spaces();
  f.host.run = (name, args) => f.calls.push([name, args]);
  const c = context(); c.cx.timer.after = () => {};
  const bindings = []; c.cx.bind_keys = list => { bindings.push(...list); return list.length; };
  const traversal = []; const surface = { focus_next: () => traversal.push('next'), focus_prev: () => traversal.push('prev') };
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded, initialView: 'spaces', window: surface });
  const view = new Type(); view.init({}, c.cx);
  let tree = null;
  const render = () => (tree = view.render(c.cx));
  const click = (id, event = { click_count: 1 }) => { const el = byId(render(), id); assert.ok(el, id); el.attributes.on_click[0](event, c.cx); };
  // A pointer press reaches the root before the click, as in GPUI.
  const press = () => byId(render(), 'roster').attributes.on_mouse_down[1]({}, c.cx);
  const key = chord => view.key({ keystroke: chord }, c.cx);
  const action = name => byId(render(), 'roster').actions[name]({ action: name }, c.cx);
  const size = height => byId(tree ?? render(), 'roster-rows').attributes.on_size_change[0]({ width: 300, height }, c.cx);
  // Herdr runs a task started in render inside render until its first await.
  // Pending tasks (the endless command loop) stay pending; only a settled failure counts.
  const rejected = async () => {
    const pending = Symbol('pending');
    const states = await Promise.all(c.tasks.map(t => Promise.race([t.then(() => null, e => String(e?.message ?? e)), Promise.resolve().then(() => pending)])));
    return states.filter(state => state !== null && state !== pending);
  };
  return { ...c, f, view, render, click, press, key, action, size, bindings, traversal, rejected };
}
async function ready() { const s = setup(); s.render(); await settle(); for (const h of [s.view.rowScroll, s.view.panelScroll]) h.requests.length = 0; return s; }
function inputProbe(s) {
  const input = s.view.pathInput; let count = 0;
  input.focus = () => { assert.notEqual(s.cx.phase, 'render', 'focus is requested after render'); count++; };
  return { input, count: () => count };
}

test('F1.2: after a pointer + the post-render task focuses the path field without notifying inside render', async () => {
  const s = await ready(); s.click(trigger); const p = inputProbe(s);
  s.render(); await settle();
  assert.deepEqual(await s.rejected(), [], 'no task throws (cx.notify() during render throws)');
  assert.equal(p.count(), 1, 'the focus request is not lost behind the reveal');
  assert.equal(s.view.inputFocused, false, 'a request is not focus');
  p.input.handlers.focus(); assert.equal(s.view.inputFocused, true);
  assert.deepEqual(s.f.calls, []);
});

test('F1.2: an active-Space reveal inside render no longer throws and still reveals once', async () => {
  const s = await ready();
  s.f.values.spaces.forEach((sp, n) => sp.active = n === 7);
  s.render(); await settle();
  assert.deepEqual(await s.rejected(), []);
  assert.deepEqual(s.view.rowScroll.requests, [8]);
});

for (const chord of ['enter', 'space']) test(`F1.4: ${chord} right after Esc reopens the form once although GPUI also clicks the focused +`, async () => {
  const s = await ready(); s.click(trigger); s.render(); await settle();
  for (let n = 0; n < 3; n++) {
    s.key('escape'); assert.equal(s.view.panel, null);
    assert.equal(s.view.triggerHandles.get(trigger).is_focused(), true, 'Esc focuses the exact +');
    s.render(); await settle();
    s.key(chord); assert.equal(s.view.panel?.kind, 'folder', 'the key opens it');
    const p = inputProbe(s);
    s.click(trigger); // GPUI's keyboard click on the focused trigger, after on_key_down.
    assert.equal(s.view.panel?.kind, 'folder', 'the keyboard click is not a second toggle');
    s.render(); await settle();
    assert.equal(p.count(), 1, 'the reopened field is focused from the focused trigger');
  }
  assert.deepEqual(await s.rejected(), []); assert.deepEqual(s.f.calls, []);
});

test('F1.4: the echo is ignored only once and never swallows a later pointer click', async () => {
  const s = await ready(); s.click(trigger); s.render(); await settle();
  s.key('escape'); s.render(); await settle();
  // The keyboard click never came (focus moved on): the next pointer press clears the echo.
  s.key('enter'); assert.equal(s.view.panel?.kind, 'folder');
  s.press(); s.click(trigger); assert.equal(s.view.panel, null, 'a real click toggles it shut');
  // Any later key clears it too.
  s.render(); s.key('enter'); assert.equal(s.view.panel?.kind, 'folder'); s.key('down');
  s.click(trigger); assert.equal(s.view.panel, null);
  // With the root focused there is no keyboard click, so no echo is kept.
  s.view.handle.focus(); s.view.place(trigger); s.render();
  s.key('enter'); assert.equal(s.view.panel?.kind, 'folder'); assert.equal(s.view.keyEcho, null);
  s.click(trigger); assert.equal(s.view.panel, null);
  assert.deepEqual(s.f.calls, []);
});

test('2.1: Tab and Shift-Tab are Roster actions under its own key context', async () => {
  const s = await ready();
  assert.deepEqual(s.bindings, [{ keystroke: 'tab', action: TAB_ACTIONS.next, context: 'Roster' },
    { keystroke: 'shift-tab', action: TAB_ACTIONS.prev, context: 'Roster' }]);
  const root = byId(s.render(), 'roster');
  assert.deepEqual(root.attributes.key_context, ['Roster']);
  assert.deepEqual(Object.keys(root.actions).sort(), [TAB_ACTIONS.next, TAB_ACTIONS.prev].sort());
});

test('2.1: Tab from an interior control moves one step inside Roster; only the ends leave', async () => {
  const s = await ready();
  // Spaces: no row adds the footer Details control, so the last control stays last.
  s.click('mode:projects'); s.render(); await settle(); s.click('mode:spaces'); s.view.place('mode:projects'); s.render(); await settle();
  const keys = () => s.view.controls.map(c => c.key);
  const stops = s.stats.stop;
  s.action(TAB_ACTIONS.next); assert.equal(s.view.controller.cursor, 'mode:status');
  s.action(TAB_ACTIONS.next); assert.equal(s.view.controller.cursor, 'spaces:new');
  s.action(TAB_ACTIONS.prev); assert.equal(s.view.controller.cursor, 'mode:status');
  assert.ok(s.stats.stop >= stops + 3); assert.deepEqual(s.traversal, []);
  assert.equal(s.view.handle.is_focused(), true, 'Roster keeps the keyboard');
  // The last control: Tab hands on to the window's next tab stop, without wrapping.
  s.render(); const last = keys().at(-1); s.view.place(last); s.render();
  s.action(TAB_ACTIONS.next); assert.deepEqual(s.traversal, ['next']); assert.equal(s.view.controller.cursor, last);
  s.view.place(keys()[0]); s.render();
  s.action(TAB_ACTIONS.prev); assert.deepEqual(s.traversal, ['next', 'prev']); assert.equal(s.view.controller.cursor, keys()[0]);
  // A plain Tab key event (a host without the binding) still leaves the ends to the host.
  s.view.place(last); s.render(); s.key('tab'); assert.deepEqual(s.traversal, ['next', 'prev']);
  assert.deepEqual(s.f.calls, []);
});

test('2.1: Tab from the focused path field moves to the next form control', async () => {
  const s = await ready(); s.click(trigger); const p = inputProbe(s); s.render(); await settle();
  p.input.handlers.focus(); assert.equal(s.view.inputFocused, true);
  s.render(); s.action(TAB_ACTIONS.next);
  assert.equal(s.view.controller.cursor, 'new-space:check');
  assert.equal(s.view.inputFocused, false); assert.equal(s.view.handle.is_focused(), true);
  assert.deepEqual(s.f.calls, []);
});

test('3.4: the folder form fits the measured list under its machine header and reveals the focused field', async () => {
  const s = await ready(); s.render(); s.size(100); s.click(trigger);
  const tree = s.render(); await settle();
  const form = byId(tree, 'roster-new-space');
  // A later machine header: 30px plus the 8px gap above it.
  assert.deepEqual(form.attributes.h, [100 - 38]);
  const path = s.view.controls.find(c => c.key === 'new-space:path'), header = s.view.controls.find(c => c.key === trigger);
  assert.equal(path.rowIndex, header.rowIndex, 'header and form are one direct list child');
  assert.deepEqual(s.view.rowScroll.requests, [path.rowIndex]);
  assert.deepEqual(s.view.panelScroll.requests, [path.panelIndex], 'the focused field, not only Cancel');
  assert.equal(path.panelIndex, 2);
  // The footer appears and the list shrinks: the form shrinks and is revealed again, once.
  const notify = s.stats.notify; s.size(84); assert.equal(s.stats.notify, notify + 1);
  assert.deepEqual(byId(s.render(), 'roster-new-space').attributes.h, [FOLDER.min]); await settle();
  assert.deepEqual(s.view.panelScroll.requests, [2, 2]);
  const settled = s.stats.notify; s.size(84); assert.equal(s.stats.notify, settled, 'an unchanged size does nothing');
  s.render(); await settle(); assert.deepEqual(s.view.panelScroll.requests, [2, 2]);
  // Room enough: the full height.
  s.size(400); assert.deepEqual(byId(s.render(), 'roster-new-space').attributes.h, [FOLDER.height]);
  assert.deepEqual(await s.rejected(), []); assert.deepEqual(s.f.calls, []);
});

test('3.4: a local form under the first header subtracts only the header; before any measure it is full height', async () => {
  const s = await ready(); s.click(local);
  assert.deepEqual(byId(s.render(), 'roster-new-space').attributes.h, [FOLDER.height]);
  await settle(); assert.deepEqual(s.view.panelScroll.requests, [0], 'Cancel is its first control');
  s.size(120); assert.deepEqual(byId(s.render(), 'roster-new-space').attributes.h, [120 - 30]);
  // A list size change with no folder form open requests nothing.
  s.key('escape'); const notify = s.stats.notify; s.size(130); assert.equal(s.stats.notify, notify);
  assert.deepEqual(s.f.calls, []);
});
