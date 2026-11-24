import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { spacesByAddress } from '../feed.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

// A factory on one remote Core ("edge"), shaped like the live one, with neutral names.
const DELIVERY = '11111111-2222-4333-8444-555555555555';
function factory({ watcher = {}, planner = {}, extra = [] } = {}) {
  const f = fakeHost([
    terminal('edge/t70', 'blocked', { name: 'watcher-sample-mods', created_ms: 300, labels: { 'herdr.role': 'watcher', 'herdr.project': 'sample-mods', ...watcher.labels }, ...watcher.extra }),
    terminal('edge/t71', 'idle', { name: 'watcher-sample-site', created_ms: 310, labels: { 'herdr.role': 'watcher', 'herdr.project': 'sample-site' } }),
    terminal('edge/t72', 'done', { name: 'planner-sample-mods-1', created_ms: 320,
      labels: { 'herdr.role': 'planner', 'herdr.project': 'sample-mods', 'herdr.issue': 'sample/repo#21', 'herdr.delivery': DELIVERY, ...planner.labels } }),
    terminal('edge/t5', 'nonsense', { created_ms: 330 }), terminal('t1', 'nonsense', { created_ms: 340 }), ...extra]);
  f.values.panes = [{ pane: 'edge/p2', terminal: 'edge/t70', tab: 'edge/tab2' }, { pane: 'edge/p3', terminal: 'edge/t72', tab: 'edge/tab3' },
    { pane: 'edge/p9', terminal: 'edge/t71', tab: 'edge/tab9' }, { pane: 'edge/p5', terminal: 'edge/t5', tab: 'edge/tab9b' }, { pane: 'p1', terminal: 't1', tab: 'tab1' }];
  f.values.spaces = [{ id: 'sp-local', name: 'Local work', machine: null, tabs: [{ id: 'tab1', name: '1', named: false }] },
    { id: 'edge/sp-mods', name: 'Sample Mods', machine: 'edge', tabs: [{ id: 'edge/tab2', name: 'Watcher', named: true }, { id: 'edge/tab3', name: '3', named: false }] },
    { id: 'edge/sp-site', name: 'Sample Site', machine: 'edge', tabs: [{ id: 'edge/tab9', name: '3', named: false }, { id: 'edge/tab9b', name: 'Sample Mods', named: true }] }];
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  return f;
}
function setup(f, initialView = 'projects') {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, initialView });
  const view = new Type(), c = context(); view.init({}, c.cx);
  return { f, view, ...c, render: () => view.render(c.cx) };
}
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const sections = v => v.controller.projection.instances.filter(i => i.kind === 'section').map(i => [i.label, i.collapsed]);
const rows = v => v.controller.projection.instances.filter(i => i.kind === 'terminal');
const find = (v, address, inAttention = false) => rows(v).find(i => i.row.address === address && i.key.includes('attention') === inAttention);

test('the Space map comes only from an exact pane in a tab of a Space on the same machine', () => {
  const f = factory();
  f.values.panes.push({ pane: 'edge/px', terminal: 'edge/t71', tab: 'edge/tab2' }); // two panes: ambiguous
  f.values.panes.push({ pane: 'edge/py', terminal: 'edge/t7', tab: 'tab1' }); // remote terminal in a local Space
  const map = spacesByAddress({ terminals: [...f.values.terminals, { address: 'edge/t7' }], panes: f.values.panes, spaces: f.values.spaces });
  assert.deepEqual(Object.keys(map).sort(), ['edge/t5', 'edge/t70', 'edge/t72', 't1']);
  assert.deepEqual(map['edge/t70'], { id: 'edge/sp-mods', name: 'Sample Mods', machine: 'edge', order: 1 });
});

test('Projects finds the factory: Space groups on their Core, both Watchers, the Planner; shells folded away', () => {
  const s = setup(factory()); let tree = s.render();
  assert.deepEqual(sections(s.view), [['Needs you', false], ['Sample Mods', false], ['Sample Site', false], ['Unidentified', true]]);
  const mods = s.view.controller.projection.instances.find(i => i.label === 'Sample Mods');
  assert.equal(textOf(byId(tree, 'group-space:' + mods.key)), 'Space · edge');
  assert.match(byId(tree, mods.key).attributes.tooltip[0], /Herdr Space on edge .*project not verified/);
  const inMods = rows(s.view).filter(i => i.placement?.space?.id === 'edge/sp-mods' && !i.key.includes('attention'));
  assert.deepEqual(inMods.map(i => i.row.displayLabel).sort(), ['Planner #21', 'Watcher']);
  // Both Watchers are listed and the right one is in each Space; the shells are not drawn until unfolded.
  assert.equal(find(s.view, 'edge/t71').placement.space.name, 'Sample Site');
  assert.equal(rows(s.view).some(i => ['edge/t5', 't1'].includes(i.row.address)), false);
  const unidentified = s.view.controller.projection.instances.find(i => i.label === 'Unidentified');
  byId(tree, unidentified.key).attributes.on_click[0]({}, s.cx); tree = s.render();
  assert.deepEqual(rows(s.view).filter(i => i.placement.key === '["unidentified"]').map(i => i.row.displayLabel).sort(), ['edge/t5', 't1']);
  assert.deepEqual(s.f.calls, []);
});

test('two Watchers on one Core are told apart without Info: role, Space and machine on the row', () => {
  for (const view of ['projects', 'status']) {
    const s = setup(factory(), view); const tree = s.render();
    const mods = find(s.view, 'edge/t70', true), site = view === 'status' ? find(s.view, 'edge/t71') : null;
    assert.equal(textOf(byId(tree, 'row-name:' + mods.key)), 'Watcher');
    assert.equal(textOf(byId(tree, 'row-machine:' + mods.key)), 'Sample Mods · edge');
    if (site) assert.equal(textOf(byId(tree, 'row-machine:' + site.key)), 'Sample Site · edge');
  }
  // Inside its own Space group the Space is already the header, so the row shows the machine.
  const s = setup(factory()); const tree = s.render();
  assert.equal(textOf(byId(tree, 'row-machine:' + find(s.view, 'edge/t71').key)), 'edge');
});

test('names, tabs and folders never assign role, project or issue', () => {
  // A shell whose name and tab title look like the factory stays unidentified.
  const s = setup(factory({ extra: [terminal('edge/t8', 'nonsense', { name: 'watcher-sample-mods', created_ms: 400 })] }));
  s.f.values.panes.push({ pane: 'edge/p8', terminal: 'edge/t8', tab: 'edge/tab2b' });
  s.f.values.spaces[1].tabs.push({ id: 'edge/tab2b', name: 'Watcher #21', named: true });
  s.render();
  const t8 = s.view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === 'edge/t8');
  assert.equal(t8, undefined, 'folded with the other unidentified shells');
  assert.equal(s.view.controller.feed.reduced.rows.find(r => r.address === 'edge/t8').role, 'unknown');
  assert.equal(s.view.controller.feed.reduced.rows.find(r => r.address === 'edge/t8').workItem, null);
  // herdr.project alone is not a verified project: the group is the Space, not "sample-mods".
  assert.ok(!sections(s.view).some(([label]) => /sample-mods/.test(label)));
});

test('missing metadata: the alert says what is known and exactly what is not; no recipient action', () => {
  const s = setup(factory()); const tree = s.render();
  const alert = find(s.view, 'edge/t70', true);
  // Nothing reported: no summary, and a Space is never shown as the project.
  assert.equal(byId(tree, 'alert-summary:' + alert.key), undefined);
  assert.equal(textOf(byId(tree, 'row-machine:' + alert.key)), 'Sample Mods · edge');
  assert.equal(textOf(byId(tree, 'alert-missing:' + alert.key)), 'Not reported: project, issue, reason, recipient');
  assert.equal(byId(tree, 'recipient:' + alert.key), undefined);
  const details = byId(tree, 'alert:' + alert.key).attributes.tooltip[0];
  for (const text of ['Missing project: no verified project for this terminal', 'Missing issue: no herdr.issue on this terminal', 'Missing reason: no status message reported by this terminal',
    'Missing recipient: no herdr.delivery label on this terminal']) assert.ok(details.includes(text), text);
  // The Watcher itself still opens its exact remote pane.
  byId(tree, alert.key).attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls, [['pane.focus', { pane: 'edge/p2' }]]);
});

test('verified recipient: the alert reads like a sentence and Open Planner goes to its exact pane', () => {
  const s = setup(factory({ watcher: { labels: { 'herdr.delivery': DELIVERY }, extra: { report: { msg: 'awaiting a decision' } } } }));
  let tree = s.render(); const alert = find(s.view, 'edge/t70', true);
  assert.equal(textOf(byId(tree, 'alert-summary:' + alert.key)), '#21 · awaiting a decision');
  const open = byId(tree, 'recipient:' + alert.key);
  assert.equal(textOf(open).trim(), 'Open Planner'); assert.match(open.attributes.accessibility_label[0], /Planner #21/);
  assert.match(byId(tree, 'alert:' + alert.key).attributes.tooltip[0], /Reply goes to Planner #21 \(edge\/t72\)/);
  assert.equal(byId(tree, 'alert-missing:' + alert.key), undefined);
  open.attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls, [['pane.focus', { pane: 'edge/p3' }]]);
  // Checked again at click time: a moved Planner pane is not opened.
  tree = s.render(); s.f.values.panes = s.f.values.panes.map(p => p.terminal === 'edge/t72' ? { ...p, pane: 'edge/p30' } : p);
  byId(tree, 'recipient:' + alert.key).attributes.on_click[0]({}, s.cx);
  assert.equal(s.f.calls.length, 1); assert.match(textOf(byId(s.render(), 'roster-message')), /Not opened|changed/);
});

test('an ambiguous or off-machine delivery match is not a verified recipient', () => {
  const twin = terminal('edge/t73', 'idle', { created_ms: 500, labels: { 'herdr.role': 'planner', 'herdr.delivery': DELIVERY } });
  const s = setup(factory({ watcher: { labels: { 'herdr.delivery': DELIVERY } }, extra: [twin] })); const tree = s.render();
  const alert = find(s.view, 'edge/t70', true);
  assert.equal(byId(tree, 'recipient:' + alert.key), undefined);
  assert.match(byId(tree, 'alert:' + alert.key).attributes.tooltip[0], /more than one live terminal on this machine shares its herdr.delivery/);
  // The issue still cannot be borrowed from an unverified Planner.
  assert.equal(alert.alert.issue, null);
  const local = setup(factory({ watcher: { labels: { 'herdr.delivery': DELIVERY } }, planner: { labels: { 'herdr.delivery': 'other-delivery' } },
    extra: [terminal('t9', 'idle', { created_ms: 600, labels: { 'herdr.role': 'planner', 'herdr.delivery': DELIVERY } })] }));
  local.render(); assert.equal(find(local.view, 'edge/t70', true).alert.recipient, null, 'same delivery on another machine does not count');
});

test('one alert, one prominent row: the group copy is a muted echo', () => {
  const s = setup(factory()); const tree = s.render();
  const prominent = find(s.view, 'edge/t70', true), echo = find(s.view, 'edge/t70', false);
  assert.ok(echo.echo); assert.equal(prominent.echo, undefined);
  assert.equal(textOf(byId(tree, 'row-echo:' + echo.key)), 'in Needs you');
  const chips = el => flatten(el).filter(e => e.attributes.max_w?.[0] === 104).map(textOf);
  assert.deepEqual(chips(byId(tree, prominent.key)), [], 'the pinned header says it'); assert.deepEqual(chips(byId(tree, echo.key)), [], 'no second chip');
  assert.ok(byId(byId(tree, 'roster-needs-you'), prominent.key), 'the alert is pinned');
  assert.equal((textOf(byId(tree, 'roster-rows')).match(/\bNeeds you\b/g) ?? []).length, 1, 'only the echo note is in the list');
});
