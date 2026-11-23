import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { projectRoster } from '../projection.js';
import { Controller } from '../controller.js';
import { fakeHost, terminal, prove, cores, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const sections = p => p.instances.filter(i => i.kind === 'section');
const terminals = p => p.instances.filter(i => i.kind === 'terminal');
function viewOf(f) {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c };
}
const world = () => fakeHost([terminal('t1', 'blocked'), terminal('t2', 'working'), terminal('edge/t3', 'idle'),
  terminal('t4', 'nonsense'), terminal('t5', 'working', { labels: { 'herdr.project': 'unbound-token' } })]);

test('production default folds Unassigned and Status Unknown groups with counts; Needs you stays open', () => {
  const f = world(), { view, cx } = viewOf(f);
  let tree = view.render(cx), p = view.controller.projection;
  assert.deepEqual(sections(p).map(s => [s.label, s.collapsed]),
    [['Needs you', false], ['Unassigned (unbound)', true], ['Unassigned (unknown)', true]]);
  assert.deepEqual(terminals(p).map(i => i.row.address), ['t1'], 'only Needs you rows are drawn');
  assert.match(textOf(tree), /▸ Unassigned \(unbound\) · 1/); assert.match(textOf(tree), /▸ Unassigned \(unknown\) · 4/);
  view.controller.change({ type: 'view', view: 'status' }); tree = view.render(cx); p = view.controller.projection;
  assert.deepEqual(sections(p).map(s => [s.label, s.collapsed]), [['Needs you', false], ['Working', false], ['Idle', false], ['Unknown', true]]);
  assert.match(textOf(tree), /▸ Unknown · 1/);
  assert.ok(!terminals(p).some(i => i.row.address === 't4'));
  // Expanding is an explicit fold and wins over the default.
  const unknown = sections(p).find(s => s.label === 'Unknown');
  byId(tree, unknown.key).attributes.on_click[0]({}, cx); tree = view.render(cx); p = view.controller.projection;
  assert.ok(terminals(p).some(i => i.row.address === 't4'));
  assert.equal(f.calls.length, 0);
});

test('pure projection keeps the old open default unless asked; a fold cannot hide Needs you', () => {
  const f = world(), c = new Controller(f.host, { collapseUnassigned: false }), open = c.render();
  assert.ok(sections(open).every(s => !s.collapsed));
  const folded = projectRoster(c.feed.reduced, { folds: Object.fromEntries(sections(open).map(s => [s.key, true])) }, { collapseUnassigned: true });
  assert.deepEqual(terminals(folded).map(i => i.row.address), ['t1']);
  assert.equal(sections(folded)[0].collapsed, false);
});

test('compact row draws a known context and never a guessed one; tab names stay out of project and context', () => {
  const f = fakeHost([terminal('t1', 'working', { name: 'Planner of Sample project' }), terminal('t2', 'working')]);
  f.values.panes = [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p2', terminal: 't2', tab: 'tab-b' }];
  f.values.spaces = [{ tabs: [{ id: 'tab-a', name: 'Sample project', named: true }, { id: 'tab-b', name: 'Context sample', named: true }] }];
  prove(f.host, { settings: JSON.stringify({ version: 1, projects: [], projectBindings: [], processProviders: [], projectProviders: [], icons: [],
    contexts: [{ coreId: cores[0].id, terminalId: 't1', incarnation: 100, id: 'ctx', label: 'Sample context', source: 'verified' }] }) });
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, collapseUnassigned: false });
  const view = new Type(), c = context(); view.init({}, c.cx);
  const tree = view.render(c.cx), p = view.controller.projection;
  const one = terminals(p).find(i => i.row.address === 't1'), two = terminals(p).find(i => i.row.address === 't2');
  assert.equal(textOf(byId(tree, 'row-execution-context:' + one.key)), 'Sample context');
  assert.equal(byId(tree, 'row-execution-context:' + two.key), undefined);
  for (const i of [one, two]) {
    assert.equal(i.row.project.id, null); assert.equal(byId(tree, i.key).attributes.h[0], 24);
    assert.equal(flatten(byId(tree, i.key)).some(e => /project icon fallback/.test(e.attributes.accessibility_label?.[0] ?? '')), false);
  }
  assert.equal(two.row.executionContext.id, null);
});

