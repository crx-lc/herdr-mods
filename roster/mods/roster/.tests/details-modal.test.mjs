import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, fixture, prove, settings, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const HOME = '/home/sample';
function desk(terminals = [terminal('t1', 'working', { cwd: HOME + '/work/repo', labels: { 'herdr.role': 'developer', 'herdr.issue': 'sample/repo#12' } }),
  terminal('t2', 'idle', { cwd: '/srv/other' }), terminal('edge/t3', 'idle', { cwd: '/home/remote/x' })]) {
  const f = fakeHost(terminals);
  f.values.panes = [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p2', terminal: 't2', tab: 'tab-b' }, { pane: 'p3', terminal: 't2', tab: 'tab-b' }];
  f.values.spaces = [{ id: 'sp-1', name: 'Sample space', machine: null, tabs: [{ id: 'tab-a', name: 'Builder', named: true }, { id: 'tab-b', name: '2', named: false }] }];
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  return f;
}
function setup(f = desk()) {
  const opened = [], app = { ...appOf(f.host), home: () => HOME };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); c.cx.open_url = url => opened.push(url);
  return { f, view, ...c, opened, render: () => view.render(c.cx), key: k => view.key({ keystroke: k }, c.cx) };
}
const item = (view, address) => view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === address);
const click = (s, tree, id) => byId(tree, id).attributes.on_click[0]({}, s.cx);
const field = (tree, id) => byId(tree, 'detail:' + id);
const value = (tree, id) => textOf(field(tree, id)?.children[1]);

test('a discreet ⓘ appears on hover or keyboard focus, keeps its place, and never navigates', () => {
  const s = setup(); let tree = s.render(); const i = item(s.view, 't1');
  const glyph = () => textOf(byId(s.render(), 'info-glyph:' + i.key));
  const info = byId(tree, 'info:' + i.key);
  assert.equal(info.attributes.w[0], 18); assert.equal(info.attributes.tooltip[0], 'Agent details');
  assert.equal(info.attributes.accessibility_label[0], 'Agent details for Developer #12');
  assert.equal(glyph(), '');
  byId(tree, 'line:' + i.key).attributes.on_hover[0](true, s.cx); assert.equal(glyph(), 'ⓘ');
  byId(tree, 'line:' + i.key).attributes.on_hover[0](false, s.cx); assert.equal(glyph(), '');
  s.view.place(i.key); assert.equal(glyph(), 'ⓘ');
  s.view.place('info:' + i.key); assert.equal(glyph(), 'ⓘ');
  tree = s.render(); click(s, tree, 'info:' + i.key);
  assert.equal(s.view.reader.sourceKey, i.key); assert.deepEqual(s.f.calls, []);
});

test('the modal lies over the list without changing scroll, folds or rows; no pagination', () => {
  const s = setup(); let tree = s.render(); const i = item(s.view, 't1');
  const rowsBefore = textOf(byId(tree, 'roster-rows')), folds = JSON.stringify(s.view.controller.state.folds), scrolls = s.view.rowScroll.requests.length;
  click(s, tree, 'info:' + i.key); tree = s.render();
  const stack = byId(tree, 'roster-stack'), modal = byId(tree, 'roster-details');
  assert.ok(stack.attributes.relative); assert.ok(modal.attributes.absolute);
  assert.deepEqual(stack.children.map(e => e.attributes.id[0]), ['roster-rows', 'roster-details']);
  // The list is unchanged except that the open row keeps its ⓘ shown.
  assert.equal(textOf(byId(tree, 'roster-rows')).replace('ⓘ', ''), rowsBefore);
  assert.doesNotMatch(textOf(modal), /Page \d|Previous|Next|Details at opening/);
  s.key('escape'); tree = s.render();
  assert.equal(byId(tree, 'roster-details'), undefined);
  assert.equal(s.view.controller.cursor, 'info:' + i.key, 'back on the same row');
  assert.equal(JSON.stringify(s.view.controller.state.folds), folds); assert.equal(s.view.rowScroll.requests.length, scrolls);
  assert.deepEqual(s.f.calls, []);
});

test('verified facts only, empty fields hidden, values wrap in full; IDs and paths under Technical details', () => {
  const s = setup(); let tree = s.render();
  click(s, tree, 'info:' + item(s.view, 't1').key); tree = s.render();
  const modal = byId(tree, 'roster-details');
  assert.deepEqual(flatten(modal).filter(e => /^detail:/.test(e.attributes.id?.[0] ?? '')).map(e => e.attributes.id[0]),
    ['detail:name', 'detail:role', 'detail:state', 'detail:machine', 'detail:space', 'detail:tab', 'detail:work-item']);
  assert.deepEqual(['name', 'role', 'state', 'machine', 'space', 'tab'].map(id => value(tree, id)),
    ['Developer #12', 'Developer', 'Working', 'This computer', 'Sample space', 'Builder']);
  assert.doesNotMatch(textOf(modal), /Unassigned|Context unknown|Not reported|Project|Repository|p1|t1\b|\/home/);
  const nameValue = field(tree, 'name').children[1];
  assert.ok(nameValue.attributes.whitespace_normal); assert.equal(nameValue.attributes.truncate, undefined);
  // Technical details start collapsed.
  assert.match(textOf(byId(tree, 'details:technical')), /▸ Technical details/);
  click(s, tree, 'details:technical'); tree = s.render();
  assert.deepEqual(['address', 'pane', 'space-id', 'folder', 'identity'].map(id => value(tree, id)),
    ['t1', 'p1', 'sp-1', '~/work/repo', 'provisional (no verified Core)']);
  assert.match(value(tree, 'started'), /^1970-01-01T00:00:00\.100Z$/);
  assert.deepEqual(s.f.calls, []);
});

test('Go to terminal passes the same click-time check as the row; otherwise a short reason', () => {
  const s = setup(); let tree = s.render();
  click(s, tree, 'info:' + item(s.view, 't1').key); tree = s.render();
  click(s, tree, 'details:go');
  assert.deepEqual(s.f.calls, [['pane.focus', { pane: 'p1' }]]); assert.equal(s.view.reader, null);
  // A target that moved after drawing is refused, and the modal stays open.
  tree = s.render(); click(s, tree, 'info:' + item(s.view, 't1').key); tree = s.render();
  s.f.values.panes = [{ pane: 'p9', terminal: 't1', tab: 'tab-a' }, ...s.f.values.panes.slice(1)];
  click(s, tree, 'details:go');
  assert.equal(s.f.calls.length, 1); assert.ok(s.view.reader);
  assert.match(textOf(byId(s.render(), 'roster-message')), /Not opened|Open unavailable/);
  s.key('escape'); tree = s.render();
  // Not navigable: no action, only the reason.
  click(s, tree, 'info:' + item(s.view, 't2').key); tree = s.render();
  assert.equal(byId(tree, 'details:go'), undefined);
  assert.match(textOf(byId(tree, 'details:unavailable')), /more than one pane/);
});

test('an issue link opens only through open_url; nothing runs in Herdr', () => {
  const s = setup(); let tree = s.render();
  click(s, tree, 'info:' + item(s.view, 't1').key); tree = s.render();
  assert.equal(value(tree, 'work-item'), 'sample/repo#12');
  click(s, tree, 'details:link');
  assert.deepEqual(s.opened, ['https://github.com/sample/repo/issues/12']); assert.deepEqual(s.f.calls, []);
});

test('keyboard: Up/Down cycle only the modal controls, Enter acts on them, × and Esc return to the same row', () => {
  const s = setup(); let tree = s.render(); const i = item(s.view, 't1');
  s.view.place(i.key); s.key('d'); tree = s.render();
  const order = s.view.readerControls.map(c => c.key);
  assert.deepEqual(order, ['details:close', 'details:link', 'details:go', 'details:technical']);
  for (const expected of order) { s.key('down'); assert.equal(s.view.readerCursor, expected); }
  s.key('up'); assert.equal(s.view.readerCursor, 'details:go');
  s.key('down'); s.key('enter'); s.render(); assert.equal(s.view.reader.technical, true);
  assert.deepEqual(s.f.calls, []);
  click(s, s.render(), 'details:close'); assert.equal(s.view.reader, null); assert.equal(s.view.controller.cursor, i.key);
});

test('a row that leaves while its details are open says so; Esc then selects Projects', () => {
  const s = setup(); let tree = s.render();
  click(s, tree, 'info:' + item(s.view, 'edge/t3').key);
  s.f.values.terminals = s.f.values.terminals.filter(t => t.address !== 'edge/t3'); tree = s.render();
  assert.match(textOf(byId(tree, 'roster-details')), /no longer listed/);
  s.key('escape'); assert.equal(s.view.controller.cursor, 'mode:projects'); assert.deepEqual(s.f.calls, []);
});

test('known delegation shows the active delegates and the full waiting phrase', () => {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
  const s = setup(f); let tree = s.render();
  click(s, tree, 'info:' + item(s.view, 't1').key); tree = s.render();
  assert.equal(value(tree, 'state'), 'Waiting on 3 agents');
  assert.equal(value(tree, 'delegates'), '3: Developer, Developer, Reviewer');
  assert.equal(value(tree, 'project'), 'Sample project');
  assert.equal(value(tree, 'role'), 'Coordinator');
});
