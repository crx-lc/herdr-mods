import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { machineAnchor, rowAnchor, folderActionAllowed, panelText } from '../disclosure.js';
import { machineKey } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function setup(mode = 'projects', extra = {}) {
  const f = fakeHost([terminal('t1', 'working', { name: 'Sample' }), terminal('t2', 'working', { name: 'Sample' }), terminal('edge/t1', 'blocked', { name: 'Sample' })]);
  f.values.spaces = [{ id: 's1', machine: null, active: true, tabs: [{ id: 'tab1' }] }, { id: 'edge/s2', machine: 'edge', tabs: [{ id: 'edge/tab2' }] }];
  f.values.panes = [{ pane: 'p1', terminal: 't1', tab: 'tab1', cwd: '/sample/repo' }, { pane: 'edge/p1', terminal: 'edge/t1', tab: 'edge/tab2', cwd: '/srv/repo' }];
  f.host.nativeNavigation = true; f.host.run = (cmd, args) => f.calls.push([cmd, args]);
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded, initialView: mode, ...extra });
  const view = new Type(), c = context(); c.cx.timer.after = () => {};
  view.init({}, c.cx);
  const render = () => view.render(c.cx);
  const click = (tree, id) => { const node = byId(tree, id); assert.ok(node, id); node.attributes.on_click[0]({}, c.cx); };
  const row = (address, pinned = false) => view.controller.projection.instances.find(i => i.row?.address === address && !!i.pinned === pinned);
  const key = chord => view.key({ keystroke: chord }, c.cx);
  render(); return { f, view, ...c, render, click, row, key };
}

for (const mode of ['projects', 'status', 'spaces']) test(`one panel across Details, Options and folder; exact toggle without native actions in ${mode}`, () => {
  const s = setup(mode); let tree = s.render();
  // Global pending row is available in every tab, outside the scrolling list.
  const i = s.row('edge/t1', true), trigger = 'info:' + i.key;
  s.click(tree, trigger); tree = s.render();
  assert.equal(s.view.panel.kind, 'details');
  assert.ok(byId(byId(tree, 'roster-needs-you'), 'roster-details'));
  assert.equal(byId(byId(tree, 'roster-rows'), 'roster-details'), undefined);
  s.click(tree, trigger); tree = s.render(); assert.equal(s.view.panel, null);
  s.click(tree, trigger); tree = s.render(); s.click(tree, 'tools:toggle'); tree = s.render();
  assert.equal(s.view.reader, null); assert.equal(s.view.panel.kind, 'options');
  assert.equal(tree.children.indexOf(byId(tree, 'roster-options')), tree.children.indexOf(byId(tree, 'roster-toolbar')) + 1);
  s.key('escape'); tree = s.render(); assert.equal(s.view.controller.cursor, 'tools:toggle');
  s.click(tree, 'mode:spaces'); tree = s.render(); s.click(tree, 'machine-add:' + machineKey('edge')); tree = s.render();
  assert.equal(s.view.toolsOpen, false); assert.equal(s.view.reader, null);
  const block = byId(tree, 'machine-block:' + machineKey('edge'));
  assert.deepEqual(block.children.map(e => e.attributes.id[0]), [machineKey('edge'), 'roster-new-space']);
  assert.equal(byId(tree, 'roster-new-space').attributes.absolute, undefined);
  s.click(tree, 'machine-add:' + machineKey('edge')); assert.equal(s.view.panel, null);
  assert.deepEqual(s.f.calls, []);
});

for (const change of ['disappear', 'pid', 'created', 'run', 'disconnect', 'duplicate']) test('Details cannot migrate after target change: ' + change, async () => {
  const s = setup(); let tree = s.render(); const origin = s.row('t1');
  s.click(tree, 'info:' + origin.key); tree = s.render();
  const stale = byId(tree, 'details:go').attributes.on_click[0];
  if (change === 'disappear') s.f.values.terminals.shift();
  if (change === 'pid') s.f.values.terminals[0].pid++;
  if (change === 'created') s.f.values.terminals[0].created_ms++;
  if (change === 'run') s.f.values.terminals[0].labels['herdr.run'] = 'new-run';
  if (change === 'disconnect') s.f.values.machines[0].layout = 'unavailable';
  if (change === 'duplicate') s.f.values.terminals.push(terminal('t1'));
  const notify = s.stats.notify; tree = s.render();
  assert.equal(byId(tree, 'roster-details'), undefined); assert.equal(s.stats.notify, notify);
  stale({}, s.cx); await tick(); assert.equal(s.view.panel, null); assert.deepEqual(s.f.calls, []);
  // An identical display name remains, without inheriting the old panel.
  assert.ok(s.view.controller.projection.instances.some(i => i.row?.displayLabel === 'Sample'));
});

test('exact duplicate-name instances remain isolated; focus returns to a real trigger handle', () => {
  const s = setup(); let tree = s.render(); const a = s.row('t1'), b = s.row('t2');
  s.click(tree, 'info:' + a.key); tree = s.render();
  const handle = s.view.triggerHandles.get('info:' + a.key);
  assert.equal(byId(tree, 'info:' + a.key).attributes.track_focus[0], handle);
  s.key('escape'); assert.equal(s.view.controller.cursor, 'info:' + a.key); assert.equal(handle.is_focused(), true);
  tree = s.render(); s.click(tree, 'info:' + b.key); tree = s.render();
  assert.ok(byId(byId(tree, 'inline:' + b.key), 'roster-details'));
  assert.equal(byId(byId(tree, 'inline:' + a.key), 'roster-details'), undefined);
  s.key('escape'); assert.equal(s.view.triggerHandles.get('info:' + b.key).is_focused(), true);
  assert.deepEqual(s.f.calls, []);
});

test('automatic removal returns actual sidebar focus nearby; it does not steal focus from a terminal', async () => {
  for (const sidebarFocus of [false, true]) {
    const s = setup(); let tree = s.render(); s.click(tree, 'info:' + s.row('t1').key); s.render();
    if (!sidebarFocus) s.stats.focused = null; // native focus is elsewhere, independently of cursor
    const count = s.stats.focus;
    s.f.values.terminals.shift(); s.render(); await tick();
    assert.equal(s.view.panel, null); assert.equal(s.view.controller.cursor, 'mode:projects');
    assert.equal(s.stats.focus, count + (sidebarFocus ? 1 : 0));
    if (sidebarFocus) assert.equal(s.view.triggerHandles.get('mode:projects').is_focused(), true);
  }
});

test('view, filter and fold changes dismiss Details; refresh alone keeps the same exact instance', () => {
  for (const event of [{ type: 'view', view: 'status' }, { type: 'filters', coreIds: [] }, { type: 'fold', key: 'sample', collapsed: true }]) {
    const s = setup(); let tree = s.render(); s.click(tree, 'info:' + s.row('t1').key); tree = s.render();
    const original = s.view.reader;
    s.view.controller.observe(true); s.render(); assert.equal(s.view.reader, original); assert.ok(s.view.activeReader());
    s.view.controller.change(event); s.render(); s.view.reconcilePanel(s.cx); assert.equal(s.view.reader, null);
    assert.deepEqual(s.f.calls, []);
  }
});

test('folder panel preserves stable list children, folds and scroll requests; cancel returns exact machine trigger', () => {
  const s = setup('spaces'); let tree = s.render();
  const before = byId(tree, 'roster-rows').children.map(e => e.attributes.id[0]);
  const state = JSON.stringify(s.view.controller.state), scrolls = [...s.view.rowScroll.requests];
  const trigger = 'machine-add:' + machineKey('edge'); s.click(tree, trigger); tree = s.render();
  assert.deepEqual(byId(tree, 'roster-rows').children.map(e => e.attributes.id[0]), before);
  s.click(tree, 'new-space:cancel'); tree = s.render();
  assert.equal(s.view.controller.cursor, trigger); assert.equal(s.view.triggerHandles.get(trigger).is_focused(), true);
  assert.deepEqual(byId(tree, 'roster-rows').children.map(e => e.attributes.id[0]), before);
  assert.equal(JSON.stringify(s.view.controller.state), state); assert.deepEqual(s.view.rowScroll.requests, scrolls); assert.deepEqual(s.f.calls, []);
});

test('folder final callbacks reject changed path, pending check, cancellation and disconnect even before redraw', () => {
  for (const change of ['path', 'checking', 'cancel', 'disconnect']) {
    const s = setup('spaces'); s.view.openNewSpace('edge', s.cx); const ns = s.view.newSpace;
    s.view.pathInput.set_value('/srv/repo'); ns.folder = '/srv/repo'; ns.check = { status: 'repo', top: '/srv/repo' };
    const tree = s.render(), stale = byId(tree, 'new-space:create').attributes.on_click[0];
    if (change === 'path') ns.folder = '/srv/replaced';
    if (change === 'checking') ns.check = { status: 'checking' };
    if (change === 'cancel') s.key('escape');
    if (change === 'disconnect') s.f.values.machines[1].layout = 'unavailable';
    stale({}, s.cx); assert.deepEqual(s.f.calls, [], change);
  }
});

test('late native picker answer cannot enter another panel, and disconnect hides folder form', async () => {
  let resolve;
  const s = setup('spaces', { pickFolder: () => new Promise(r => { resolve = r; }) });
  s.view.openNewSpace(null, s.cx); const pending = s.view.chooseLocalFolder(s.cx);
  s.key('escape'); s.view.openNewSpace('edge', s.cx); resolve('/sample/old'); await pending;
  assert.equal(s.view.newSpace.folder, null); assert.deepEqual(s.f.calls, []);
  s.f.values.machines[1].layout = 'unavailable'; const notify = s.stats.notify; const tree = s.render();
  assert.equal(byId(tree, 'roster-new-space'), undefined); assert.equal(s.stats.notify, notify);
  await tick(); assert.equal(s.view.newSpace, null);
});

test('machine identity never confuses this computer with a remote literally named local, nor duplicate machine records', () => {
  assert.notEqual(machineKey(null), machineKey('local')); assert.notEqual(machineKey('local'), machineKey('%6cocal'));
  const machines = [{ name: null, layout: 'ready' }, { name: 'local', layout: 'ready' }];
  assert.notEqual(machineAnchor(null, machines), machineAnchor('local', machines));
  assert.equal(machineAnchor('local', [...machines, machines[1]]), null);
  assert.equal(machineAnchor('missing', machines), null);
  const s = setup('spaces'); s.f.values.machines = machines;
  let tree = s.render(); s.click(tree, 'machine-add:' + machineKey('local')); tree = s.render();
  assert.equal(s.view.newSpace.machine, 'local');
  assert.ok(byId(byId(tree, 'machine-block:' + machineKey('local')), 'roster-new-space'));
  assert.equal(byId(byId(tree, 'machine-block:' + machineKey(null)), 'roster-new-space'), undefined);
});

test('compact panel reading uses bounded vertical scroll and keyboard reachability for long facts; source and action values stay intact', () => {
  const text = 'x'.repeat(150) + ' 中文 👩‍💻';
  assert.equal(panelText(text).replaceAll('\u200b', ''), text);
  assert.ok(panelText(text).split('\u200b').every(part => Array.from(part).length <= 24));
  const s = setup(); s.f.values.terminals[0].name = text;
  let tree = s.render(); const i = s.row('t1'); s.click(tree, 'info:' + i.key); tree = s.render();
  const panel = byId(tree, 'roster-details');
  assert.equal(panel.attributes.h[0], 112); assert.ok(panel.attributes.overflow_y_scrollbar);
  const name = byId(tree, 'detail:name').children[1];
  assert.equal(name.attributes.truncate, undefined); assert.ok(name.attributes.whitespace_normal); assert.equal(textOf(name).replaceAll('\u200b', ''), text);
  s.key('end'); assert.equal(s.view.panelScroll.requests.at(-1), panel.children.length - 1);
  s.key('home'); assert.equal(s.view.panelScroll.requests.at(-1), 0);
  s.key('pagedown'); assert.equal(s.view.panelScroll.requests.at(-1), 1);
  s.view.place('details:technical'); s.key('enter'); tree = s.render(); s.key('end');
  assert.equal(s.view.panelScroll.requests.at(-1), byId(tree, 'roster-details').children.length - 1);
  assert.deepEqual(s.f.calls, []);
});

test('pure folder admission requires a current machine, exact path and explicit unverified confirmation', () => {
  const ns = { anchor: 'machine', folder: '/srv/repo', check: { status: 'none' }, confirmUnverified: true };
  assert.equal(folderActionAllowed(ns, 'machine', '/srv/repo'), false);
  assert.equal(folderActionAllowed(ns, 'machine', '/srv/repo', true), true);
  assert.equal(folderActionAllowed(ns, null, '/srv/repo', true), false);
  assert.equal(folderActionAllowed(ns, 'other-machine', '/srv/repo', true), false);
  assert.equal(folderActionAllowed(ns, 'machine', '/srv/other', true), false);
  assert.equal(rowAnchor(null), null);
});

test('existing-Space final action recaptures machine, tabs and place instead of trusting its drawn match', () => {
  for (const change of ['removed', 'folder', 'machine']) {
    const s = setup('spaces');
    s.view.git = { lookup: () => ({ status: 'repo', top: '/srv/repo' }) };
    s.view.openNewSpace('edge', s.cx); const ns = s.view.newSpace;
    s.view.pathInput.set_value('/srv/repo'); ns.folder = '/srv/repo'; ns.check = { status: 'repo', top: '/srv/repo' };
    const tree = s.render(), stale = byId(tree, 'new-space:open-existing').attributes.on_click[0];
    if (change === 'removed') s.f.values.spaces.pop();
    if (change === 'folder') s.f.values.panes[1].cwd = '/srv/repo/replaced';
    if (change === 'machine') s.f.values.spaces[1].machine = null;
    stale({}, s.cx); assert.deepEqual(s.f.calls, [], change);
  }
});

test('footer Details remains a real focusable trigger while its inline panel is open', () => {
  const s = setup(); s.view.place(s.row('t1').key); let tree = s.render();
  s.click(tree, 'details:open'); tree = s.render();
  const trigger = byId(tree, 'details:open'), handle = s.view.triggerHandles.get('details:open');
  assert.ok(trigger); assert.equal(trigger.attributes.track_focus[0], handle);
  s.key('escape'); assert.equal(handle.is_focused(), true); assert.equal(s.view.controller.cursor, 'details:open');
  s.key('enter'); assert.ok(s.view.reader); assert.deepEqual(s.f.calls, []);
});

test('editing a checked path invalidates proof and an old final callback cannot create the previous folder', () => {
  const s = setup('spaces'); s.view.openNewSpace('edge', s.cx); const ns = s.view.newSpace;
  s.view.pathInput.set_value('/srv/repo'); ns.folder = '/srv/repo'; ns.check = { status: 'repo', top: '/srv/repo' };
  const stale = byId(s.render(), 'new-space:create').attributes.on_click[0];
  s.view.pathInput.set_value('/srv/another');
  stale({}, s.cx); assert.deepEqual(s.f.calls, [], 'current input differs even without a change notification');
  s.view.pathInput.handlers.change({}, s.cx);
  assert.equal(ns.folder, null); assert.equal(ns.check, null);
  assert.equal(byId(s.render(), 'new-space:create'), undefined);
  stale({}, s.cx); assert.deepEqual(s.f.calls, []);
});

test('long Options labels wrap without losing the final reachable action', () => {
  const s = setup(); let tree = s.render(); s.click(tree, 'tools:toggle');
  s.view.selection = { slots: [{ id: 'sample-'.repeat(30) }] }; tree = s.render();
  const tools = byId(tree, 'roster-options'), last = tools.children.at(-1);
  assert.equal(last.attributes.min_h[0], 24);
  assert.equal(last.children[0].attributes.truncate, undefined); assert.ok(last.children[0].attributes.whitespace_normal);
  assert.equal(textOf(last).replaceAll('\u200b', ''), 'Use Roster in ' + 'sample-'.repeat(30));
  s.view.place(s.view.controls[s.view.controls.indexOf(s.view.controls.find(c => c.key === last.attributes.id[0])) - 1].key);
  s.key('tab'); assert.equal(s.view.controller.cursor, last.attributes.id[0]);
  assert.equal(s.view.optionsScroll.requests.at(-1), tools.children.length - 1); assert.deepEqual(s.f.calls, []);
});

test('invalid checked input clears a previous proof and disables its old final action', () => {
  const s = setup('spaces'); s.view.openNewSpace(null, s.cx); const ns = s.view.newSpace;
  ns.folder = '/sample/repo'; ns.check = { status: 'repo', top: '/sample/repo' };
  const stale = byId(s.render(), 'new-space:create').attributes.on_click[0];
  s.view.checkFolder('bad\npath', s.cx); assert.equal(ns.folder, null); assert.equal(ns.check, null);
  stale({}, s.cx); assert.deepEqual(s.f.calls, []);
});
