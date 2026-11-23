import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

// A tab closing on Windows removed a selected row and Roster threw "cx.notify() is not
// allowed during the `render` phase". The fixture's cx now throws exactly like GPUI.
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const tab = id => ({ machine: null, tabs: [{ id, name: '1', named: false }] });
function desk() {
  const f = fakeHost([terminal('t1', 'working', { name: 'keep-a' }), terminal('t2', 'working', { name: 'closing' }),
    terminal('t3', 'idle', { name: 'keep-b', parent: 't1', created_ms: 200 }), terminal('t4', 'working', { name: 'keep-c' })]);
  f.values.panes = ['t1', 't2', 't3', 't4'].map(t => ({ pane: 'p-' + t, terminal: t, tab: 'tab-' + t }));
  f.values.spaces = ['t1', 't2', 't3', 't4'].map(t => tab('tab-' + t));
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  return f;
}
function setup(f) {
  // Production defaults: Other starts folded, so the test opens it like a person would.
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, initialView: 'projects' });
  const view = new Type(), c = context(); view.init({}, c.cx);
  let tree = view.render(c.cx);
  const other = view.controller.projection.instances.find(i => i.kind === 'section' && i.label === 'Other');
  byId(tree, other.key).attributes.on_click[0]({}, c.cx);
  return { view, ...c, render: () => view.render(c.cx), other };
}
const item = (view, name) => view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.displayLabel === name);
const viewState = view => JSON.stringify({ cursor: view.controller.cursor, state: view.controller.state, reader: view.reader && view.reader.sourceKey,
  page: view.reader?.page, tools: view.toolsOpen, message: view.message, footer: view.footerSourceKey, at: view.cursorAt });
const closeT2 = f => { f.values.terminals = f.values.terminals.filter(t => t.address !== 't2'); f.values.panes = f.values.panes.filter(p => p.terminal !== 't2'); f.values.spaces = f.values.spaces.filter(s => s.tabs[0].id !== 'tab-t2'); };

for (const how of ['selected row', 'its Info', 'its footer Details', 'hovered only', 'details open on it', 'details open on another row']) {
  test(`closing a row that is ${how} redraws without a render-phase update`, () => {
    const f = desk(), s = setup(f); let tree = s.render();
    const target = item(s.view, 'closing'), other = item(s.view, 'keep-a');
    if (how === 'selected row') byId(tree, target.key).attributes.on_click[0]({}, s.cx);
    if (how === 'its Info') s.view.place('info:' + target.key);
    if (how === 'its footer Details') { s.view.place(target.key); s.render(); s.view.key({ keystroke: 'down' }, s.cx); }
    if (how === 'details open on it') byId(tree, 'info:' + target.key).attributes.on_click[0]({}, s.cx);
    if (how === 'details open on another row') byId(tree, 'info:' + other.key).attributes.on_click[0]({}, s.cx);
    f.calls.length = 0; tree = s.render();
    const before = viewState(s.view), notifies = s.stats.notify;
    closeT2(f);
    tree = s.render(); // would throw in GPUI if render notified
    assert.equal(viewState(s.view), before, 'render changed no view state');
    assert.equal(s.stats.notify, notifies, 'render asked for no redraw');
    assert.equal(textOf(tree).includes('could not be re-rendered'), false);
    if (how.startsWith('details open')) {
      assert.ok(byId(tree, 'roster-details'), 'Details stay on their snapshot');
      s.view.key({ keystroke: 'escape' }, s.cx); tree = s.render();
      assert.equal(s.view.controller.cursor, how === 'details open on it' ? 'mode:projects' : 'info:' + other.key);
    }
    // The closed row is gone; unrelated rows, the expanded group and the child fold stay.
    const names = s.view.controller.projection.instances.filter(i => i.kind === 'terminal').map(i => i.row.displayLabel);
    assert.deepEqual(names.sort(), ['keep-a', 'keep-b', 'keep-c']);
    const group = s.view.controller.projection.instances.find(i => i.kind === 'section' && i.label === 'Other');
    assert.equal(group.collapsed, false); assert.equal(group.counts.identities, 3);
    assert.match(textOf(tree), /▾ Other · 3/);
    assert.equal(f.calls.length, 0);
  });
}

test('a pending click or Enter on a closed row never focuses another terminal', () => {
  for (const via of ['click', 'enter']) {
    const f = desk(), s = setup(f); let tree = s.render();
    const target = item(s.view, 'closing'), staleClick = byId(tree, target.key).attributes.on_click[0];
    s.view.place(target.key); f.calls.length = 0;
    closeT2(f);
    // The event arrives before (click) or after (Enter) the next render.
    if (via === 'click') staleClick({}, s.cx);
    else { s.render(); s.view.key({ keystroke: 'enter' }, s.cx); }
    assert.deepEqual(f.calls, [], via);
    tree = s.render();
    if (via === 'click') assert.match(textOf(byId(tree, 'roster-message')), /Not opened|Open unavailable/);
    // Moving on and pressing Enter on a visible row is an explicit choice and still works.
    s.view.key({ keystroke: 'down' }, s.cx); s.render();
    const chosen = s.view.controls.find(c => c.key === s.view.controller.cursor);
    if (chosen?.instance && chosen.key === chosen.instance.key) {
      s.view.key({ keystroke: 'enter' }, s.cx);
      assert.deepEqual(f.calls, [['pane.focus', { pane: 'p-' + chosen.instance.row.address }]]);
    }
  }
});

test('render is pure across views, folds, Options and Details', () => {
  const f = desk(), s = setup(f);
  const steps = [() => {}, () => s.view.controller.change({ type: 'view', view: 'status' }), () => { s.view.toolsOpen = true; },
    () => { s.view.toolsOpen = false; s.view.controller.change({ type: 'view', view: 'projects' }); },
    () => s.view.openDetails({ key: item(s.view, 'keep-a').key, instance: item(s.view, 'keep-a') }, s.cx),
    () => s.view.controller.change({ type: 'view', view: 'status' }), // stale Details: render must not close them
    () => s.view.key({ keystroke: 'down' }, s.cx)];
  for (const step of steps) {
    step(); s.render();
    const before = viewState(s.view), notifies = s.stats.notify;
    s.render(); s.render();
    assert.equal(viewState(s.view), before); assert.equal(s.stats.notify, notifies);
  }
  assert.equal(s.view.reader, null, 'the key event dropped the stale Details');
  assert.equal(f.calls.length, 0);
});
