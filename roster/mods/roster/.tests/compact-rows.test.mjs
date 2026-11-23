import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { projectRoster } from '../projection.js';
import { Controller } from '../controller.js';
import { fakeHost, terminal, prove, cores, kit, context, appOf, flatten, textOf, layoutHostUnused, association } from './sidebar-fixtures.mjs';
import { canonicalRepository } from '../projection.js';
import { detailFields } from '../detail.js';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const sections = p => p.instances.filter(i => i.kind === 'section');
const terminals = p => p.instances.filter(i => i.kind === 'terminal');
function viewOf(f) {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c };
}
const world = () => fakeHost([terminal('t1', 'blocked'), terminal('t2', 'working'), terminal('edge/t3', 'idle'),
  terminal('t4', 'nonsense'), terminal('t5', 'working', { labels: { 'herdr.project': 'unbound-token' } })]);

test('production default folds one Other group and Status Unknown with counts; Needs you stays open', () => {
  const f = world(), { view, cx } = viewOf(f);
  let tree = view.render(cx), p = view.controller.projection;
  assert.deepEqual(sections(p).map(s => [s.label, s.collapsed]), [['Needs you', false], ['Other', true]]);
  assert.deepEqual(terminals(p).map(i => i.row.address), ['t1'], 'only Needs you rows are drawn');
  assert.match(textOf(tree), /▸ Other · 5/);
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

// Pilot shape: an implementer here and a Planner/Watcher on another machine share a
// project label; a plain shell sits in a clone. Labels and folders are not assignments.
const pilot = () => fakeHost([
  terminal('t1', 'working', { labels: { 'herdr.role': 'developer', 'herdr.project': 'sample' } }),
  terminal('edge/t2', 'done', { labels: { 'herdr.role': 'planner', 'herdr.project': 'sample' } }),
  terminal('edge/t3', 'idle', { labels: { 'herdr.role': 'watcher', 'herdr.project': 'sample' } }),
  terminal('edge/t4', 'idle', { name: 'sample-clone' }), terminal('t5', 'idle', { name: 'Sample project' })]);
const groupsOf = p => sections(p).filter(s => s.label !== 'Needs you').map(s => [s.label, s.counts.identities]);

test('production evidence binds nothing: labelled pilot rows stay in Other and Info names the missing Core', () => {
  const f = pilot(), c = new Controller(f.host, { collapseUnassigned: false }), p = c.render();
  assert.deepEqual(groupsOf(p), [['Other', 5]]);
  const planner = terminals(p).find(i => i.row.address === 'edge/t2');
  const project = detailFields(planner).find(x => x.id === 'project').value;
  assert.equal(project, 'Unassigned (unbound): label herdr.project=sample needs a verified Core to bind');
  assert.equal(detailFields(planner).find(x => x.id === 'repository').value, 'Not verified');
});

test('a bound label groups under its project per verified Core; unbound Cores stay in Other', () => {
  const f = pilot();
  const settings = JSON.stringify({ version: 1, projects: [{ id: 'sample', displayName: 'Sample project' }],
    projectBindings: [{ coreId: 'core-a', token: 'sample', projectId: 'sample' }, { coreId: 'core-b', token: 'sample', projectId: 'sample' }],
    contexts: [], processProviders: [], projectProviders: [], icons: [] });
  prove(f.host, { settings });
  const p = new Controller(f.host, { collapseUnassigned: false }).render();
  assert.deepEqual(groupsOf(p), [['Sample project', 3], ['Other', 2]]);
  // Same label, but only core-a is bound: the edge rows are not assigned by name.
  const g = pilot();
  prove(g.host, { settings: settings.replace(',{"coreId":"core-b","token":"sample","projectId":"sample"}', '') });
  assert.deepEqual(groupsOf(new Controller(g.host, { collapseUnassigned: false }).render()), [['Sample project', 1], ['Other', 4]]);
});

test('explicit verified repository facts group clones across Cores under one canonical identity', () => {
  const f = pilot(), fact = (core, id, remote, extra = {}) => ({ associationKey: association(core, id), coreId: core, remote, verified: true, source: 'owner-mapping', ...extra });
  prove(f.host, { repositories: [fact('core-b', 't4', 'git@github.com:sample/repo.git'), fact('core-a', 't1', 'https://github.com/sample/repo.git'),
    fact('core-a', 't5', 'https://github.com/sample/repo', { verified: false })] });
  const p = new Controller(f.host, { collapseUnassigned: false }).render();
  assert.deepEqual(groupsOf(p), [['github.com/sample/repo', 2], ['Other', 3]]);
  const clone = terminals(p).find(i => i.row.address === 'edge/t4');
  assert.equal(detailFields(clone).find(x => x.id === 'repository').value, 'github.com/sample/repo');
});

test('repository facts that are unverified, mis-scoped, conflicting or path-shaped stay in Other', () => {
  const key = association('core-b', 't4');
  for (const repositories of [
    [{ associationKey: key, coreId: 'core-b', remote: 'https://github.com/sample/repo', verified: false, source: 'x' }],
    [{ associationKey: key, coreId: 'core-a', remote: 'https://github.com/sample/repo', verified: true, source: 'x' }],
    [{ associationKey: key, coreId: 'core-b', remote: 'https://github.com/sample/repo', verified: true, source: ' ' }],
    [{ associationKey: key, coreId: 'core-b', remote: '/home/sample/repo', verified: true, source: 'x' }],
    [{ associationKey: key, coreId: 'core-b', remote: 'https://github.com/sample/repo', verified: true, source: 'x' },
      { associationKey: key, coreId: 'core-b', remote: 'https://github.com/sample/other', verified: true, source: 'x' }]]) {
    const f = pilot(); prove(f.host, { repositories });
    assert.deepEqual(groupsOf(new Controller(f.host, { collapseUnassigned: false }).render()), [['Other', 5]]);
  }
  // Without verified Cores there is no association key to attach any fact to.
  const g = pilot(); g.host.evidence = () => ({ cores: [], routes: [], documents: [], scopes: [], correlations: [], admissions: [],
    repositories: [{ associationKey: key, coreId: 'core-b', remote: 'https://github.com/sample/repo', verified: true, source: 'x' }] });
  assert.deepEqual(groupsOf(new Controller(g.host, { collapseUnassigned: false }).render()), [['Other', 5]]);
});

test('canonical repository identity normalizes remote spellings and rejects names and paths', () => {
  for (const remote of ['https://github.com/sample/repo.git', 'https://GitHub.com/sample/repo', 'git@github.com:sample/repo.git',
    'ssh://git@github.com/sample/repo.git', 'ssh://git@github.com:22/sample/repo', 'https://user@github.com/sample/repo/'])
    assert.equal(canonicalRepository(remote), 'github.com/sample/repo', remote);
  for (const remote of [null, '', 'repo', 'sample/repo', '/home/sample/repo', String.raw`C:\repos\repo`, 'C:/repos/repo', 'file:///home/sample/repo',
    'https://github.com/../repo', 'https://github.com/sample/repo extra', 'http://github.com/sample/repo', 'https://github.com/a/b/c'])
    assert.equal(canonicalRepository(remote), null, String(remote));
});
