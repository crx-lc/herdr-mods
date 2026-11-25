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

function setup({ zoom = null } = {}) {
  const f = fakeHost([terminal('t1')]); f.values.spaces = spaces();
  f.host.run = (name, args) => f.calls.push([name, args]);
  const c = context(); c.cx.timer.after = () => {};
  const bindings = []; c.cx.bind_keys = list => { bindings.push(...list); return list.length; };
  const traversal = []; const surface = { focus_next: () => traversal.push('next'), focus_prev: () => traversal.push('prev') };
  const app = appOf(f.host); if (zoom) app.settings = () => ({ zoom });
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, ...expanded, initialView: 'spaces', window: surface });
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
async function ready(options) { const s = setup(options); s.render(); await settle(); for (const h of [s.view.rowScroll, s.view.panelScroll]) h.requests.length = 0; return s; }
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
  const notify = s.stats.notify; s.size(38 + FOLDER.min); assert.equal(s.stats.notify, notify + 1);
  assert.deepEqual(byId(s.render(), 'roster-new-space').attributes.h, [FOLDER.min]); await settle();
  assert.deepEqual(s.view.panelScroll.requests, [2, 2]);
  const settled = s.stats.notify; s.size(38 + FOLDER.min); assert.equal(s.stats.notify, settled, 'an unchanged size does nothing');
  s.render(); await settle(); assert.deepEqual(s.view.panelScroll.requests, [2, 2]);
  // Room enough: the full height.
  s.size(400); assert.deepEqual(byId(s.render(), 'roster-new-space').attributes.h, [FOLDER.height]);
  assert.deepEqual(await s.rejected(), []); assert.deepEqual(s.f.calls, []);
});

// Review of b78ec55 at zoom 1.1: under three pinned rows the list is about 77px. Header and
// gap (38) plus the least form (60) did not fit, the block showed from its top and the
// focused path field, the form's third row, stayed below the list.
function apartForm(s, height) {
  const tree = s.render(), rows = byId(tree, 'roster-rows'), form = byId(tree, 'roster-new-space');
  const block = byId(tree, 'machine-block:' + machineKey('edge'));
  const path = s.view.controls.find(c => c.key === 'new-space:path'), header = s.view.controls.find(c => c.key === trigger);
  assert.deepEqual(form.attributes.h, [height], 'the form is at most the list high');
  assert.equal(byId(block, 'roster-new-space'), undefined, 'not inside the header block');
  assert.equal(rows.children.indexOf(form), rows.children.indexOf(block) + 1, 'the next direct list child');
  assert.equal(path.rowIndex, rows.children.indexOf(form)); assert.equal(header.rowIndex, rows.children.indexOf(block));
  return { path, header };
}

test('3.4 zoom 1.1: in a 77px list the form is a row of its own that fits, and its focused field is revealed', async () => {
  const s = await ready(); s.size(77); s.click(trigger);
  const { path } = apartForm(s, 77); await settle();
  assert.deepEqual(s.view.rowScroll.requests, [path.rowIndex], 'the form row, not the header block');
  assert.deepEqual(s.view.panelScroll.requests, [path.panelIndex]); assert.equal(path.panelIndex, 2);
  const p = inputProbe(s); s.render(); await settle(); assert.equal(p.count(), 0, 'one focus request per opening');
  // Esc returns to the exact +; Enter reopens the form as its own row and reveals it again.
  s.view.rowScroll.requests.length = 0; s.view.panelScroll.requests.length = 0;
  s.key('escape'); s.render(); assert.equal(s.view.controller.cursor, trigger); assert.equal(s.view.panel, null);
  s.key('enter'); const again = apartForm(s, 77).path; await settle();
  assert.equal(s.view.panel?.kind, 'folder'); assert.equal(s.view.controller.cursor, 'new-space:path');
  assert.deepEqual(s.view.rowScroll.requests, [again.rowIndex]); assert.deepEqual(s.view.panelScroll.requests, [2]);
  // Up from the field reaches the header block again.
  s.key('up'); assert.equal(s.view.controller.cursor, 'new-space:cancel'); s.key('up');
  assert.equal(s.view.controller.cursor, trigger); assert.equal(s.view.rowScroll.requests.at(-1), again.rowIndex - 1);
  assert.deepEqual(await s.rejected(), []); assert.deepEqual(s.f.calls, []);
});

test('3.4: the list size arrives in window px and is divided by the zoom; room again rejoins the header', async () => {
  const s = await ready({ zoom: 1.1 }); s.size(85); s.click(trigger);
  apartForm(s, 77); await settle();
  // One px short of header and least form apart; at exactly that it joins the header.
  s.size(Math.ceil((38 + FOLDER.min - 1) * 1.1)); apartForm(s, 38 + FOLDER.min - 1);
  s.size((38 + FOLDER.min) * 1.1); s.render(); await settle();
  const block = byId(s.render(), 'machine-block:' + machineKey('edge'));
  assert.deepEqual(byId(block, 'roster-new-space').attributes.h, [FOLDER.min]);
  const path = s.view.controls.find(c => c.key === 'new-space:path'), header = s.view.controls.find(c => c.key === trigger);
  assert.equal(path.rowIndex, header.rowIndex); assert.equal(s.view.rowScroll.requests.at(-1), path.rowIndex);
  // A list shorter than the field itself still gets a form tall enough for it.
  s.size(20); apartForm(s, FOLDER.least);
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
