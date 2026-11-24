import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

// Needs you is pinned above the Spaces | Projects | Status tabs, outside their list.
// Neutral sample: one pending session here, one on a remote Core ("edge"), and others.
function desk({ pending = ['t1', 'edge/t2'], extra = 0 } = {}) {
  const more = Array.from({ length: extra }, (_, n) => 't' + (10 + n));
  const all = [...pending, ...more];
  const f = fakeHost([
    ...all.map((address, n) => terminal(address, 'blocked', { created_ms: 100 + n, labels: { 'herdr.role': n % 2 ? 'watcher' : 'developer' } })),
    terminal('t3', 'working', { created_ms: 400, labels: { 'herdr.role': 'reviewer' } }),
    terminal('edge/t4', 'idle', { created_ms: 410, labels: { 'herdr.role': 'planner' } })]);
  const pane = address => address.replace(/t(\w+)$/, 'p$1');
  f.values.panes = [...all, 't3', 'edge/t4'].map(address => ({ pane: pane(address), terminal: address, tab: address.startsWith('edge/') ? 'edge/tab' : 'tab' }));
  f.values.spaces = [{ id: 'sp-local', name: 'Local work', machine: null, tabs: [{ id: 'tab', name: '1', named: false }] },
    { id: 'edge/sp', name: 'Remote work', machine: 'edge', tabs: [{ id: 'edge/tab', name: '1', named: false }] }];
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  return f;
}
function setup(f, initialView = 'spaces') {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, initialView });
  const view = new Type(), c = context(); view.init({}, c.cx);
  return { f, view, ...c, render: () => view.render(c.cx) };
}
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const pinnedRows = view => view.controller.projection.instances.filter(i => i.kind === 'terminal' && i.pinned);
const ids = el => el.children.map(e => e.attributes.id?.[0]);
const tab = (s, tree, view) => { byId(tree, 'mode:' + view).attributes.on_click[0]({}, s.cx); return s.render(); };

test('pinned above the tabs and outside their scrolling list, once per pending session', () => {
  const s = setup(desk()); const tree = s.render();
  assert.deepEqual(ids(tree).slice(0, 2), ['roster-needs-you', 'roster-toolbar'], 'Needs you is the first thing in the sidebar');
  assert.equal(byId(byId(tree, 'roster-rows'), 'roster-needs-you'), undefined, 'not inside the tabs\' list');
  const header = byId(tree, JSON.stringify(['attention']));
  assert.equal(textOf(byId(header, 'group-count:' + JSON.stringify(['attention']))), '2');
  assert.deepEqual(pinnedRows(s.view).map(i => i.row.address).sort(), ['edge/t2', 't1'], 'local and remote, each once');
  assert.equal(byId(tree, 'roster-needs-rows').children.length, 2);
  // Verified agent, Space and machine on the first line; nothing reported, so nothing invented.
  const remote = pinnedRows(s.view).find(i => i.row.address === 'edge/t2');
  assert.equal(textOf(byId(tree, 'row-machine:' + remote.key)), 'Remote work · edge');
  assert.equal(byId(tree, 'alert-summary:' + remote.key), undefined);
  assert.match(textOf(byId(tree, 'alert-missing:' + remote.key)), /^Not reported: project, issue, reason/);
  assert.deepEqual(s.f.calls, []);
});

test('the same section, rows and selection across Spaces, Projects and Status', () => {
  const s = setup(desk()); let tree = s.render();
  const keys = pinnedRows(s.view).map(i => i.key), local = pinnedRows(s.view).find(i => i.row.address === 't1');
  const pinnedText = textOf(byId(tree, 'roster-needs-you'));
  // Select the local row with the keyboard, as a click would without navigating.
  s.view.place(local.key);
  for (const view of ['projects', 'status', 'spaces', 'projects']) {
    tree = tab(s, tree, view);
    assert.equal(s.view.controller.state.view, view);
    assert.deepEqual(pinnedRows(s.view).map(i => i.key), keys, view + ': same keys');
    assert.equal(textOf(byId(tree, 'roster-needs-you')), pinnedText, view + ': same text');
    assert.equal(s.view.controller.cursor === 'mode:' + view || s.view.controller.cursor === local.key, true);
  }
  // Status no longer has its own Needs you group; Projects keeps only the muted echo.
  tree = tab(s, tree, 'status');
  assert.doesNotMatch(textOf(byId(tree, 'roster-rows')), /Needs you/);
  tree = tab(s, tree, 'projects');
  assert.equal((textOf(byId(tree, 'roster-rows')).match(/\bNeeds you\b/g) ?? []).length, 2, 'one "in Needs you" echo per pending session');
  assert.deepEqual(s.f.calls, [], 'switching tabs never navigates');
});

test('a selection on a pinned row survives a tab switch, and keyboard order starts there', () => {
  const s = setup(desk()); let tree = s.render();
  const local = pinnedRows(s.view).find(i => i.row.address === 't1');
  s.view.place(local.key); tree = s.render();
  // The toolbar click puts the cursor on the tab; Down from the last pinned control goes on to the tabs.
  assert.equal(s.view.controls[0].key, JSON.stringify(['attention']), 'pinned controls come first');
  const lastPinned = s.view.controls.filter(c => c.pinned && c.key !== 'details:open').at(-1);
  s.view.place(lastPinned.key); s.view.key({ keystroke: 'down' }, s.cx);
  assert.equal(s.view.controller.cursor, 'mode:spaces');
  s.view.place(local.key); s.view.controller.change({ type: 'view', view: 'status' }); tree = s.render();
  assert.equal(s.view.controller.cursor, local.key);
  assert.equal(byId(tree, local.key).attributes.bg.at(-1), appOf(s.f.host).theme().selected ?? appOf(s.f.host).theme().raised);
});

test('more than three pending sessions scroll inside the pinned section; the tabs\' list keeps its own scroll', () => {
  const s = setup(desk({ extra: 3 }), 'projects'); let tree = s.render();
  const list = byId(tree, 'roster-needs-rows');
  assert.equal(list.children.length, 5);
  assert.equal(list.attributes.h[0], 3 * 44 + 2 * 3, 'three rows shown, the rest scroll');
  assert.ok(list.attributes.overflow_y_scrollbar && list.attributes.track_scroll[0] === s.view.pinnedScroll);
  assert.notEqual(s.view.pinnedScroll, s.view.rowScroll);
  // Down onto the fourth pinned row scrolls the pinned list to it, never the tabs' list.
  const rowControls = s.view.controls.filter(c => c.pinned && c.instance && c.key === c.instance.key);
  const fourth = rowControls[3], before = s.view.controls[s.view.controls.indexOf(fourth) - 1];
  s.view.place(before.key); s.view.key({ keystroke: 'down' }, s.cx);
  assert.equal(s.view.controller.cursor, fourth.key);
  assert.equal(s.view.pinnedScroll.requests.at(-1), 3); assert.deepEqual(s.view.rowScroll.requests, []);
  assert.ok(byId(list.children[fourth.pinnedIndex], fourth.key));
  // Down into the list scrolls the list by its own children, unaffected by the pinned rows.
  tree = s.render();
  const firstListed = s.view.controls.find(c => !c.pinned && c.rowIndex != null);
  s.view.place(s.view.controls[s.view.controls.indexOf(firstListed) - 1].key); s.view.key({ keystroke: 'down' }, s.cx);
  assert.equal(s.view.rowScroll.requests.at(-1), firstListed.rowIndex);
  assert.ok(byId(byId(tree, 'roster-rows').children[firstListed.rowIndex], firstListed.key));
  assert.deepEqual(s.f.calls, []);
});

test('empty state: no section at all while nothing is pending, and it leaves when the last one resolves', () => {
  const s = setup(desk({ pending: [] }));
  for (const view of ['spaces', 'projects', 'status']) {
    s.view.controller.change({ type: 'view', view }); const tree = s.render();
    assert.equal(byId(tree, 'roster-needs-you'), undefined, view);
    assert.equal(ids(tree)[0], 'roster-toolbar', view + ': the tabs are first');
    assert.equal(s.view.controls.some(c => c.pinned), false);
  }
  const t = setup(desk({ pending: ['edge/t2'] }), 'status'); let tree = t.render();
  assert.ok(byId(tree, 'roster-needs-you'));
  t.f.values.terminals = t.f.values.terminals.map(x => x.address === 'edge/t2' ? { ...x, status: 'idle' } : x);
  tree = t.render();
  assert.equal(byId(tree, 'roster-needs-you'), undefined);
  assert.equal(t.stats.notify, 0, 'render asked for no redraw');
});

test('a pinned row opens its exact session, local or remote, from any tab; checked at click time', () => {
  const s = setup(desk()); let tree = s.render();
  const row = address => pinnedRows(s.view).find(i => i.row.address === address);
  byId(tree, row('t1').key).attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls, [['pane.focus', { pane: 'p1' }]], 'local, from Spaces');
  tree = tab(s, tree, 'status');
  byId(tree, row('edge/t2').key).attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls.at(-1), ['pane.focus', { pane: 'edge/p2' }], 'remote, from Status');
  // Nothing moves: no terminal input, no new pane, the session stays in its Space and tab.
  assert.equal(s.f.calls.length, 2);
  // A pane that moved since the row was drawn is not opened.
  tree = tab(s, tree, 'projects');
  s.f.values.panes = s.f.values.panes.map(p => p.terminal === 'edge/t2' ? { ...p, pane: 'edge/p20' } : p);
  byId(tree, row('edge/t2').key).attributes.on_click[0]({}, s.cx);
  assert.equal(s.f.calls.length, 2);
  assert.match(textOf(byId(s.render(), 'roster-message')), /Not opened|changed/);
});
