import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApp, normalizeCompact } from '../normalize.js';
import { resolveIdentities } from '../identity.js';
import { enrichMetadata } from '../metadata.js';
import { reduceRoster } from '../attention.js';
import { projectRoster, transition, viewState } from '../projection.js';
import { navigationOrder, navigationTarget, moveCursor, actionIntent as guardedActionIntent, rowIdentity } from '../navigation.js';
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const cores = [{ alias: '', id: 'core-a', verified: true, source: 'fixture', hostLabel: 'same-host' },
  { alias: 'edge', id: 'core-b', verified: true, source: 'fixture', hostLabel: 'same-host' }];
const config = { projects: [{ id: 'project-a', displayName: 'Equal title' }, { id: 'project-b', displayName: 'Equal title' }],
  projectBindings: [{ coreId: 'core-a', token: 'a', projectId: 'project-a' }, { coreId: 'core-b', token: 'b', projectId: 'project-b' }],
  contexts: [{ coreId: 'core-a', id: 'context-a', label: 'A', source: 'verified', exclusive: true },
    { coreId: 'core-b', id: 'context-b', label: 'B', source: 'verified', exclusive: true }] };
const raw = (address, status = 'idle', extra = {}) => ({ address, status, state: 'live', created_ms: 100,
  name: 'Equal title', labels: { 'herdr.project': address.includes('/') ? 'b' : 'a' }, ...extra });
const observation = { observedAt: 1000, refresh: 'success' };
const rowsOf = (raws, cs = cores, cfg = config) => enrichMetadata(resolveIdentities(raws.map(r => normalizeApp(r, r.observation ?? observation, 1000)), cs), cfg).rows;
const reducedOf = raws => reduceRoster(rowsOf(raws));
const evidence = reduced => ({ generation: 'g1', routes: reduced.rows.map(r => ({ associationKey: r.associationKey, coreId: r.core.id,
  address: r.address, generation: 'g1', verified: true, source: 'current-pane-snapshot', presentation: r.address.includes('/') ? 'pane-less' : 'pane' })) });
const project = (r, state, options = {}) => projectRoster(r, state, { navigation: evidence(r), ...options });
const actionIntent = (r, p, key, e) => guardedActionIntent(r, p, key, e, { state: p.state, generation: e.generation });
const terminals = p => p.instances.filter(i => i.kind === 'terminal');
const find = (p, address) => terminals(p).find(i => i.row.address === address);
const section = (p, label) => p.instances.find(i => i.kind === 'section' && i.label === label);
const fold = (p, key, collapsed = true) => transition(p.state, { type: 'fold', key, collapsed });

test('default Projects nests verified parent, keeps actionable attention above folded trees and hides finished children', () => {
  const r = reducedOf([raw('t1'), raw('t2', 'blocked', { parent: 't1', created_ms: 200 }),
    raw('t3', 'done', { state: 'finished', parent: 't1', created_ms: 300 })]);
  const p = project(r);
  assert.equal(p.state.view, 'projects');
  assert.equal(p.instances[0].label, 'Needs you');
  assert.equal(terminals(p)[0].row.address, 't2');
  assert.equal(terminals(p).filter(i => i.row.address === 't2').length, 2);
  assert.equal(find(p, 't3'), undefined); assert.equal(section(p, 'Done').collapsed, true);
  const parent = find(p, 't1'), child = terminals(p).find(i => i.row.address === 't2' && i.depth === 2);
  assert.equal(child.context.parent.associationKey, parent.row.associationKey);
  const foldedParent = project(r, fold(p, parent.key));
  assert.deepEqual(terminals(foldedParent).map(i => i.row.address), ['t2', 't1']);
  const foldedProject = project(r, fold(p, section(p, 'Equal title').key));
  assert.deepEqual(terminals(foldedProject).map(i => i.row.address), ['t2']);
  const expandedDone = project(r, fold(p, section(p, 'Done').key, false));
  assert.equal(find(expandedDone, 't3').depth, 3);
  assert.ok(!expandedDone.order.some(i => i.target.address === 't3'));
});

test('first visible navigable attention occurrence wins; every rendered key is unique including nested Done', () => {
  const r = reducedOf([raw('t1', 'blocked'), raw('t2', 'blocked', { parent: 't1', created_ms: 200 }),
    raw('t3', 'done', { state: 'finished', parent: 't1', created_ms: 300 }),
    raw('edge/t1', 'blocked')]);
  let p = project(r);
  p = project(r, fold(p, section(p, 'Done').key, false));
  assert.equal(new Set(p.instances.map(i => i.key)).size, p.instances.length);
  assert.equal(new Set(p.order.map(i => i.identity)).size, 3);
  assert.deepEqual(p.order.map(i => i.key), terminals(p).slice(0, 3).map(i => i.key));
  assert.equal(p.counts.all.needsYou, 3); assert.equal(p.counts.visible.identities, 4);
  assert.equal(p.order.find(i => i.target.address === 'edge/t1').target.coreId, 'core-b');
  const duplicate = terminals(p).find(i => i.row.address === 't1' && i.depth === 1 && i.key !== p.order[0].key);
  assert.ok(duplicate); assert.ok(!p.order.some(i => i.key === duplicate.key));
});

test('attention outside independent core AND context filters stays visible with reasons, context and disabled intents', () => {
  const r = reducedOf([raw('t1', 'working'), raw('edge/t1', 'blocked')]);
  const p = project(r, { coreIds: ['core-a'], contextIds: ['context-a'] });
  const outside = find(p, 'edge/t1');
  assert.deepEqual(outside.outsideFilters, ['core-outside-filter', 'context-outside-filter']);
  assert.equal(outside.context.coreId, 'core-b'); assert.equal(outside.context.executionContext.id, 'context-b');
  assert.equal(outside.context.hostLabel, 'same-host'); assert.equal(outside.context.project.id, 'project-b');
  assert.equal(outside.navigation.enabled, false);
  assert.equal(actionIntent(r, p, outside.key, evidence(r)).enabled, false);
  assert.deepEqual(p.order.map(i => i.target.address), ['t1']);
  assert.deepEqual(p.counts.all, { identities: 2, working: 1, waiting: 0, needsYou: 1 });
  assert.equal(p.counts.filtered.identities, 1); assert.equal(p.counts.visible.identities, 2);
  assert.equal(p.counts.outsideFilterAttention.needsYou, 1);
  const coreOnly = project(r, { coreIds: ['core-b'] });
  assert.equal(find(coreOnly, 'edge/t1').outsideFilters.length, 0);
  const contextOnly = project(r, { contextIds: ['context-a'] });
  assert.deepEqual(find(contextOnly, 'edge/t1').outsideFilters, ['context-outside-filter']);
});

test('same-core terminal context filters are independent; null selects unknown explicitly', () => {
  const cfg = { ...config, contexts: [
    { coreId: 'core-a', terminalId: 't1', incarnation: 100, id: 'context-a', label: 'A', source: 'verified' },
    { coreId: 'core-a', terminalId: 't2', incarnation: 100, id: 'context-b', label: 'B', source: 'verified' }] };
  const r = reduceRoster(rowsOf([raw('t1'), raw('t2'), raw('t3')], cores, cfg));
  assert.deepEqual(terminals(project(r, { coreIds: ['core-a'], contextIds: ['context-b'] })).map(i => i.row.address), ['t2']);
  assert.deepEqual(terminals(project(r, { contextIds: [null] })).map(i => i.row.address), ['t3']);
  assert.equal(terminals(project(r, { coreIds: [] })).length, 0);
});

test('Status retains project/parent context and separate Offline, Stale, Unknown, errors and Done', () => {
  const r = reducedOf([raw('t1', 'working'), raw('t2', 'blocked', { parent: 't1', created_ms: 200 }),
    raw('t3', 'done'), raw('t4'), raw('t5', 'working', { observation: { ...observation, connection: 'offline' } }),
    raw('t6', 'working', { observation: { ...observation, refresh: 'error' } }), raw('t7', 'error'), raw('t8', null)]);
  let p = project(r, { view: 'status' });
  assert.deepEqual(p.instances.filter(i => i.kind === 'section').map(i => i.label), ['Needs you', 'Working', 'Done', 'Idle', 'Offline', 'Stale', 'Unknown']);
  assert.equal(find(p, 't2').context.parent.associationKey, find(p, 't1').row.associationKey);
  assert.equal(find(p, 't2').context.project.id, 'project-a');
  assert.equal(find(p, 't5').status, 'Offline'); assert.equal(find(p, 't6').status, 'Stale');
  assert.equal(find(p, 't7').display.error, 'Error'); assert.equal(find(p, 't7').status, 'Unknown');
  assert.equal(find(p, 't8').status, 'Unknown'); assert.equal(p.counts.all.working, 1);
  assert.equal(find(p, 't3'), undefined);
  p = project(r, fold(p, section(p, 'Done').key, false));
  assert.equal(find(p, 't3').row.lifecycle, 'live'); assert.equal(find(p, 't3').status, 'Done');
});

const run = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function delegated(statuses = ['working', 'working', 'working']) {
  const producer = raw('t1', 'idle', { pid: 1, argv: ['codex-auto'], keep: true,
    labels: { 'herdr.project': 'a', 'herdr.role': 'coordinator', 'herdr.run': run(1) } });
  const children = statuses.map((s, n) => raw(`t${n + 2}`, s, { parent: 't1', created_ms: 200 + n, pid: n + 2, argv: ['claude-auto'], keep: false,
    labels: { 'herdr.role': n === 2 ? 'reviewer' : 'developer', 'herdr.launch': run(n + 2), 'herdr.run': run(n + 20) } }));
  const record = t => ({ address: t.address, created: t.created_ms, pid: t.pid, program: t.argv[0], keep: t.keep, run: t.labels['herdr.run'] });
  const doc = { schema: 'herdr-agents/delegations', version: 1, owner: 'herdr-agents', producer: { core: 'core-a', terminal: record(producer) },
    revision: 1, updatedAt: '2000-01-01T00:00:00Z', assignments: children.map(t => ({ id: t.labels['herdr.launch'], role: t.labels['herdr.role'],
      project: 'a', item: null, child: record(t), state: 'active', revision: 1, ended: null })) };
  const actionIntent = (r, p, key, e) => guardedActionIntent(r, p, key, e, { state: p.state, generation: e.generation });
const terminals = [producer, ...children];
  return reduceRoster(rowsOf(terminals), { terminals, machines: [{ name: null, layout: 'ready' }], documents: [{ producer, text: JSON.stringify(doc) }] });
}

test('actual merged delegation result gives Working 3 and waiting 1, with full detail when hidden and compact when expanded', () => {
  const r = delegated(); assert.equal(r.rows.find(r => r.address === 't1').roster.state, 'waiting');
  const p = project(r), parent = find(p, 't1');
  assert.equal(parent.display.compact, true); assert.equal(parent.display.tooltip, 'Waiting on 3 agents');
  const folded = project(r, fold(p, parent.key));
  assert.equal(find(folded, 't1').display.label, 'Waiting on 3 agents');
  assert.equal(folded.counts.all.working, 3); assert.equal(folded.counts.all.waiting, 1);
  assert.equal(folded.counts.visible.working, 0); assert.equal(folded.counts.visible.waiting, 1);
  const status = project(r, { view: 'status' });
  assert.equal(terminals(status).filter(i => i.status === 'Working').length, 4);
  assert.equal(status.counts.visible.working, 3); assert.equal(status.counts.visible.waiting, 1);
  assert.equal(find(status, 't1').display.compact, false);
});

test('R2 child attention retains actual identity and no extra actionable target; blocked parent wins', () => {
  const r = delegated(['blocked', 'working', 'working']);
  for (const view of ['projects', 'status']) {
    const p = project(r, { view }), parent = find(p, 't1');
    assert.equal(parent.row.roster.state, 'child-needs-you'); assert.equal(parent.contextOnly, true);
    assert.equal(parent.status, 'Child needs you'); assert.equal(p.counts.all.working, 2); assert.equal(p.counts.all.needsYou, 1);
    assert.equal(parent.row.roster.children[0].associationKey, find(p, 't2').row.associationKey);
    assert.equal(actionIntent(r, p, parent.key, evidence(r)).enabled, false);
    assert.deepEqual(p.order.map(i => i.target.address), ['t2', 't3', 't4']);
  }
  const own = reducedOf([raw('t1', 'blocked'), raw('t2', 'blocked', { parent: 't1', created_ms: 200 })]);
  assert.equal(project(own).counts.all.needsYou, 2);
});

test('unassigned, unbound and ambiguous metadata never guessed from titles or role names', () => {
  const r = reducedOf([raw('t1', 'idle', { name: 'Supervisor Developer', labels: {} }), raw('t2', 'idle', { labels: { 'herdr.project': 'missing' } }),
    raw('t3', 'idle', { labels: { 'herdr.project': {} } })]);
  const p = project(r);
  assert.ok(p.instances.filter(i => i.kind === 'section').every(i => i.label === 'Other'));
  assert.ok(terminals(p).every(i => i.row.role === 'unknown'));
  assert.equal(terminals(p).length, 3);
});

test('verified core-wide services appear once in Infrastructure; scoped Supervisor stays in project and health is unknown', () => {
  const rs = rowsOf([raw('t1', 'idle', { labels: { 'herdr.role': 'supervisor' } }),
    raw('t2', 'idle', { labels: { 'herdr.role': 'supervisor' } }),
    raw('edge/t1', 'idle', { labels: { 'herdr.role': 'supervisor', 'herdr.project': 'b' } })]);
  const r = reduceRoster(rs), scopes = rs.map(row => ({ associationKey: row.associationKey, coreId: row.core.id, verified: true, scope: 'core-wide', source: 'explicit-service-scope' }));
  const p = project(r, {}, { scopes });
  assert.equal(terminals(p).length, 3); assert.equal(terminals(p).filter(i => i.placement.label === 'Infrastructure').length, 2);
  assert.equal(find(p, 'edge/t1').placement.projectId, 'project-b');
  assert.equal(find(p, 't1').diagnostic, 'multiple-supervisors');
  assert.ok(terminals(p).every(i => i.health === 'unknown'));
  assert.equal(section(project(r), 'Infrastructure'), undefined);
  assert.equal(section(project(r, {}, { scopes: scopes.map(e => ({ ...e, verified: false })) }), 'Infrastructure'), undefined);
});

test('orphan, cycle, ambiguous and cross-project parents remain bounded and keep truthful context', () => {
  const r = reducedOf([raw('t1', 'idle', { parent: 't2' }), raw('t2', 'idle', { parent: 't1' }),
    raw('t3', 'idle', { parent: 't99' }), raw('edge/t1', 'working', { parent: 't1', created_ms: 200 })]);
  const p = project(r); assert.equal(terminals(p).length, 4);
  assert.equal(find(p, 't1').context.parentResolution, 'cycle'); assert.equal(find(p, 't3').context.parentResolution, 'orphan');
  assert.equal(find(p, 'edge/t1').context.parentResolution, 'verified');
  assert.equal(find(p, 'edge/t1').depth, 1); assert.equal(find(p, 'edge/t1').context.parent.associationKey, find(p, 't1').row.associationKey);
  // Defensive handling of invalid caller edges cannot recurse or drop rows.
  const forged = structuredClone(r); const [a, b] = forged.rows;
  a.parent = { resolution: 'verified', associationKey: b.associationKey };
  b.parent = { resolution: 'verified', associationKey: a.associationKey };
  assert.equal(terminals(project(forged)).length, 4);
});

test('known incarnations and unknown compact identity never merge; navigation fails closed on overlap', () => {
  const app = normalizeApp(raw('t1', 'working'), observation, 1000);
  const compact = normalizeCompact(raw('t1', 'working'), observation, 1000);
  const historical = normalizeCompact(raw('t9', 'done', { state: 'finished' }), observation, 1000);
  const metadata = xs => enrichMetadata(resolveIdentities(xs, cores), config).rows;
  const overlap = reduceRoster(metadata([app, compact, historical]));
  const p = project(overlap); assert.equal(new Set(terminals(p).map(i => i.identity)).size, 2);
  assert.equal(p.order.length, 0); assert.equal(p.counts.all.identities, 3);
  assert.notEqual(rowIdentity(overlap.rows[0]), rowIdentity(overlap.rows[1]));
  // Acquisition caller excludes overlapping compact t1; distinct finished t9 stays.
  const acquired = reduceRoster(metadata([app, historical]));
  assert.equal(project(acquired).counts.all.working, 1); assert.equal(project(acquired).order.length, 1);
  const reused = reducedOf([raw('t1', 'working'), raw('t1', 'idle', { created_ms: 200 })]);
  assert.equal(project(reused).order.length, 0); assert.equal(terminals(project(reused)).length, 2);
});

test('explicit actions route exact current core-qualified focus or peek; no evidence means no guessed API', () => {
  const r = reducedOf([raw('t1'), raw('edge/t1')]), p = project(r);
  for (const [address, action, coreId] of [['t1', 'focus', 'core-a'], ['edge/t1', 'peek', 'core-b']]) {
    const result = actionIntent(r, p, find(p, address).key, evidence(r));
    assert.equal(result.enabled, true); assert.equal(result.intent.address, address);
    assert.equal(result.intent.action, action); assert.equal(result.intent.coreId, coreId);
    assert.equal(result.intent.associationKey, find(p, address).row.associationKey);
  }
  assert.equal(projectRoster(r).order.length, 0);
  assert.equal(actionIntent(r, p, 'missing', evidence(r)).enabled, false);
  assert.equal(actionIntent(r, p, section(p, 'Equal title').key, evidence(r)).enabled, false);
});

test('stale/offline/invalid/ambiguous routes, old generation and changed aliases disable actions', () => {
  const r = reducedOf([raw('t1')]), row = r.rows[0], e = evidence(r), p = project(r);
  for (const edit of [x => x.freshness = 'stale', x => x.freshness = 'offline', x => x.lifecycle = 'finished',
    x => x.address = 'bad', x => x.address = 'edge/t1', x => x.core.verified = false, x => x.associationKey = null]) {
    const copy = structuredClone(r); edit(copy.rows[0]);
    assert.equal(actionIntent(copy, p, find(p, 't1').key, e).enabled, false);
  }
  for (const edit of [x => x.routes.push({ ...x.routes[0] }), x => x.generation = 'g2', x => x.routes[0].address = 't2',
    x => x.routes[0].coreId = 'core-b', x => x.routes[0].verified = false, x => x.routes[0].presentation = 'unknown', x => x.routes[0].source = '']) {
    const bad = structuredClone(e); edit(bad); assert.equal(navigationTarget(row, r.rows, bad).enabled, false);
  }
});

test('local cursor follows first visible order and never activates during view/fold/filter transitions', () => {
  const r = freeze(delegated()), initial = freeze(project(r)), before = JSON.stringify(r);
  const next = moveCursor(initial.order, null); assert.equal(next, initial.order[0].key);
  assert.equal(moveCursor(initial.order, next, 'previous'), initial.order.at(-1).key);
  assert.equal(moveCursor([], next), null);
  let state = transition(initial.state, { type: 'view', view: 'status' });
  state = transition(state, { type: 'filters', coreIds: [] });
  const p = project(r, state); assert.equal(p.order.length, 0);
  assert.equal(moveCursor(p.order, next), null);
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(Object.keys(state).sort(), ['contextIds', 'coreIds', 'folds', 'view']);
  // There is no host/command API to call; transition results contain only state.
  assert.deepEqual(viewState({ coreIds: [null, 'core-a'], contextIds: ['context-a', null] }), viewState({ coreIds: ['core-a', null], contextIds: [null, 'context-a'] }));
  assert.deepEqual(viewState(), { view: 'projects', coreIds: null, contextIds: null, folds: {} });
});

test('frozen inputs, view states, routes and scope facts stay unchanged; permutation order and keys are stable without Intl', () => {
  const raws = freeze([raw('t1', 'blocked'), raw('t2', 'working', { parent: 't1', created_ms: 200 }), raw('edge/t1', 'blocked')]);
  const r = freeze(reducedOf(raws)), options = freeze({ navigation: evidence(r), scopes: [] });
  const state = freeze({ view: 'projects', coreIds: ['core-b', 'core-a'], contextIds: ['context-b', 'context-a'] });
  const before = JSON.stringify({ r, options, state }), p = projectRoster(r, state, options);
  const reversed = reduceRoster(rowsOf([...raws].reverse(), [...cores].reverse(), { ...config, projects: [...config.projects].reverse(), projectBindings: [...config.projectBindings].reverse() }));
  assert.deepEqual(projectRoster(reversed, state, { ...options, navigation: { ...options.navigation, routes: [...options.navigation.routes].reverse() } }), p);
  assert.equal(JSON.stringify({ r, options, state }), before);
  const saved = globalThis.Intl;
  try { delete globalThis.Intl; assert.deepEqual(projectRoster(r, state, options), p); }
  finally { globalThis.Intl = saved; }
  assert.deepEqual(navigationOrder(p.instances), p.order);
});

// Neutral source-derived simulation of the three independently retained native
// limitations. This is NOT a live App probe or a global navigation release pass.
function nativeOrder(hint, paneCandidates) {
  return [...new Set([...hint.filter(t => paneCandidates.includes(t)), ...paneCandidates])];
}
function nativeNext(order, selected, roots) {
  return order[(order.indexOf(roots[selected] ?? selected) + 1) % order.length];
}
test('native ordering hint appends hidden agents, excludes pane-less child and can repeat selected child from root', () => {
  assert.deepEqual(nativeOrder(['t1'], ['t1', 't2']), ['t1', 't2']);
  assert.deepEqual(nativeOrder(['t1', 'edge/t7'], ['t1']), ['t1']);
  assert.equal(nativeNext(['t1', 'edge/t7', 't2'], 'edge/t7', { 'edge/t7': 't1' }), 'edge/t7');
  assert.notEqual(nativeNext(['t1', 'edge/t7', 't2'], 'edge/t7', { 'edge/t7': 't1' }), 't2');
});

test('Working header measures workers separately from contextual waiting and filtering a delegate restores full waiting detail', () => {
  const r = delegated();
  assert.deepEqual(section(project(r, { view: 'status' }), 'Working').counts, { identities: 4, working: 3, waiting: 1, needsYou: 0 });
  const altered = structuredClone(r);
  altered.rows.find(r => r.address === 't2').executionContext = { id: 'context-b', label: 'B', source: 'verified' };
  const p = project(altered, { contextIds: ['context-a'] });
  assert.equal(find(p, 't1').display.label, 'Waiting on 3 agents');
  assert.equal(find(p, 't1').display.compact, false);
  assert.equal(p.counts.all.working, 3); assert.equal(p.counts.filtered.working, 2);
});

test('finished project roots and nested Done have independent deterministic fold keys', () => {
  const r = reducedOf([raw('t1', 'done', { state: 'finished' }),
    raw('t2', 'done', { state: 'finished', parent: 't1', created_ms: 200 }), raw('t3', 'working')]);
  let p = project(r); assert.equal(find(p, 't1'), undefined);
  p = project(r, fold(p, section(p, 'Done').key, false));
  assert.ok(find(p, 't1')); assert.equal(find(p, 't2'), undefined);
  const nested = p.instances.filter(i => i.kind === 'section' && i.label === 'Done');
  assert.equal(nested.length, 2); assert.notEqual(nested[0].key, nested[1].key);
  p = project(r, fold(p, nested[1].key, false));
  assert.ok(find(p, 't2')); assert.equal(p.order.length, 1);
  assert.equal(new Set(p.instances.map(i => i.key)).size, p.instances.length);
});

test('ambiguous parent incarnations remain roots with explicit resolution and disabled reused terminal targets', () => {
  const r = reducedOf([raw('t1'), raw('t1', 'idle', { created_ms: 150 }),
    raw('t2', 'working', { parent: 't1', created_ms: 200 })]);
  const p = project(r); assert.equal(find(p, 't2').context.parentResolution, 'ambiguous');
  assert.equal(find(p, 't2').depth, 1); assert.equal(find(p, 't1').identityDiagnostic, 'ambiguous-incarnation');
  assert.deepEqual(p.order.map(i => i.target.address), ['t2']);
});

test('deep actual ancestry traverses iteratively with each terminal rendered once', () => {
  const raws = Array.from({ length: 150 }, (_, n) => raw(`t${(n + 1).toString(36)}`, 'idle',
    { created_ms: 100 + n, parent: n ? `t${n.toString(36)}` : null }));
  const p = project(reducedOf(raws));
  assert.equal(terminals(p).length, 150);
  assert.equal(Math.max(...terminals(p).map(i => i.depth)), 150);
  assert.equal(new Set(p.instances.map(i => i.key)).size, p.instances.length);
});

test('finished ancestor never conceals live branches by default; expanding history adds no duplicates', () => {
  const r = reducedOf([raw('t1', 'done', { state: 'finished', finished_ms: 500 }),
    raw('t2', 'working', { parent: 't1', created_ms: 200 }), raw('t3', 'idle', { parent: 't1', created_ms: 300 })]);
  const p = project(r), status = project(r, { view: 'status' });
  assert.deepEqual(terminals(p).map(i => i.row.address), ['t2', 't3']);
  assert.deepEqual(p.order.map(i => i.target.address), ['t2', 't3']);
  assert.equal(p.counts.visible.working, p.counts.filtered.working);
  assert.equal(find(status, 't2').status, find(p, 't2').status);
  assert.equal(find(p, 't2').context.parent.associationKey, r.rows.find(r => r.address === 't1').associationKey);
  assert.equal(find(p, 't2').context.parentResolution, 'verified');
  const expanded = project(r, fold(p, section(p, 'Done').key, false));
  assert.equal(terminals(expanded).length, 3);
  assert.equal(new Set(terminals(expanded).map(i => i.identity)).size, 3);
  assert.equal(section(expanded, 'Done').count, 1);
});

test('multiple finished ancestors, mixed branches and filtered parents preserve exact context and explicit folds', () => {
  const r = reducedOf([raw('t1'), raw('t2', 'done', { state: 'finished', parent: 't1', created_ms: 200 }),
    raw('t3', 'done', { state: 'finished', parent: 't2', created_ms: 300 }),
    raw('t4', 'working', { parent: 't3', created_ms: 400 }),
    raw('t5', 'idle', { parent: 't4', created_ms: 500 }), raw('t6', 'working', { parent: 't1', created_ms: 600 })]);
  const p = project(r);
  assert.deepEqual(new Set(terminals(p).map(i => i.row.address)), new Set(['t1', 't4', 't5', 't6']));
  assert.equal(find(p, 't4').depth, 1); // lifted root, no invented t1 -> t4 link
  assert.equal(find(p, 't4').context.parent.associationKey, r.rows.find(r => r.address === 't3').associationKey);
  assert.equal(find(p, 't5').depth, 2);
  const f = project(r, fold(p, find(p, 't4').key));
  assert.equal(find(f, 't5'), undefined); assert.ok(find(f, 't6'));
  assert.equal(terminals(project(r, fold(p, section(p, 'Equal title').key))).length, 0);
  const changed = structuredClone(r); changed.rows.find(r => r.address === 't4').executionContext.id = 'context-b';
  const filtered = project(changed, { contextIds: ['context-a'] });
  assert.equal(find(filtered, 't5').depth, 1);
  assert.equal(find(filtered, 't5').context.parent.associationKey, r.rows.find(r => r.address === 't4').associationKey);
});

test('Supervisor diagnostics require simultaneous current live distinct identities on the same verified core', () => {
  const supervisor = (address, extra = {}) => raw(address, 'idle', { labels: { 'herdr.role': 'supervisor' }, ...extra });
  for (const extra of [{ state: 'finished', finished_ms: 150 },
    { observation: { ...observation, refresh: 'error' } }, { observation: { ...observation, connection: 'offline' } }]) {
    const p = project(reducedOf([supervisor('t1', extra), supervisor('t2', { created_ms: 200 })]));
    assert.equal(find(p, 't2').diagnostic, null); assert.equal(find(p, 't2').health, 'unknown');
  }
  const two = project(reducedOf([supervisor('t1'), supervisor('t2'), supervisor('edge/t1')]));
  assert.equal(find(two, 't1').diagnostic, 'multiple-supervisors');
  assert.equal(find(two, 't2').diagnostic, 'multiple-supervisors');
  assert.equal(find(two, 'edge/t1').diagnostic, null);
  assert.ok(terminals(project(reducedOf([supervisor('t1'), supervisor('edge/t1')]))).every(i => i.diagnostic === null));
  for (const cs of [[], [...cores, { alias: '', id: 'other', verified: true, source: 'conflict' }]]) {
    const unknown = project(reduceRoster(rowsOf([supervisor('t1'), supervisor('t2')], cs)));
    assert.ok(terminals(unknown).every(i => !i.row.core.verified && i.diagnostic === null && i.health === 'unknown'));
  }
  const duplicate = reducedOf([supervisor('t1'), supervisor('t1')]);
  assert.equal(find(project(duplicate), 't1').diagnostic, null);
});

test('Status has one global Needs you and a distinct nonactionable Child needs you section', () => {
  const r = reducedOf([raw('t1'), raw('t2', 'blocked', { parent: 't1', created_ms: 200 })]);
  const p = project(r, { view: 'status' });
  assert.deepEqual(p.instances.filter(i => i.kind === 'section').map(i => i.label), ['Needs you', 'Child needs you']);
  assert.equal(section(p, 'Child needs you').counts.needsYou, 0);
  assert.equal(section(p, 'Child needs you').counts.working, 0);
  assert.equal(find(p, 't1').contextOnly, true);
  assert.equal(find(p, 't1').row.roster.children[0].associationKey, find(p, 't2').row.associationKey);
  assert.deepEqual(p.order.map(i => i.target.address), ['t2']);
  const own = project(reducedOf([raw('t1', 'blocked'), raw('t2', 'blocked', { parent: 't1', created_ms: 200 })]), { view: 'status' });
  assert.equal(section(own, 'Child needs you'), undefined); assert.equal(own.counts.all.needsYou, 2);
});

test('explicit action rejects absent independent state, same-generation transitions and newer acquisitions', () => {
  const r = reducedOf([raw('t1'), raw('t2', 'working', { parent: 't1', created_ms: 200 })]);
  const p = project(r), key = find(p, 't2').key, e = evidence(r);
  assert.equal(guardedActionIntent(r, p, key, e).enabled, false);
  assert.equal(guardedActionIntent(r, p, key, e, { generation: 'g1' }).enabled, false);
  const current = { state: viewState(), generation: 'g1' };
  assert.equal(guardedActionIntent(r, p, key, e, current).enabled, true);
  for (const event of [{ type: 'filters', coreIds: ['core-b'] }, { type: 'filters', contextIds: ['context-b'] },
    { type: 'view', view: 'status' }, { type: 'fold', key: find(p, 't1').key, collapsed: true },
    { type: 'fold', key: section(p, 'Equal title').key, collapsed: true }]) {
    const state = transition(current.state, event);
    assert.equal(guardedActionIntent(r, p, key, e, { ...current, state }).reason, 'projection-state-changed');
  }
  const newer = { generation: 'g2', routes: e.routes.map(x => ({ ...x, generation: 'g2' })) };
  assert.equal(guardedActionIntent(r, p, key, newer, { ...current, generation: 'g2' }).enabled, false);
  assert.equal(guardedActionIntent(r, p, key, e, { ...current, generation: 'g2' }).enabled, false);
  const refreshed = projectRoster(r, current.state, { navigation: newer });
  assert.equal(guardedActionIntent(r, refreshed, key, newer, { ...current, generation: 'g2' }).enabled, true);
});

test('activation recomputes eligibility when rows, context, attention, identity or route change within generation', () => {
  const r = reducedOf([raw('t1'), raw('t2', 'working', { parent: 't1', created_ms: 200 })]);
  const state = viewState({ coreIds: ['core-a'], contextIds: ['context-a'] }), e = evidence(r), p = project(r, state);
  const current = { state, generation: 'g1' }, key = find(p, 't1').key;
  for (const edit of [x => x.rows[0].executionContext.id = 'context-b', x => x.rows[0].core.id = 'core-b',
    x => x.rows[0].roster.state = 'child-needs-you', x => x.rows.splice(0, 1),
    x => x.rows[0].incarnation = 900, x => x.rows[0].address = 'other/t1']) {
    const changed = structuredClone(r); edit(changed);
    assert.equal(guardedActionIntent(changed, p, key, e, current).enabled, false);
  }
  const blocked = reducedOf([raw('t1', 'blocked')]), attention = project(blocked, state);
  assert.equal(guardedActionIntent(r, attention, find(attention, 't1').key, e, current).enabled, false); // vanished attention key
  const routeGone = { generation: 'g1', routes: [] };
  assert.equal(guardedActionIntent(r, p, key, routeGone, current).enabled, false);
  const forged = structuredClone(p); find(forged, 't1').contextOnly = false; find(forged, 't1').outsideFilters = [];
  const changed = structuredClone(r); changed.rows[0].roster.state = 'child-needs-you';
  assert.equal(guardedActionIntent(changed, forged, key, e, current).enabled, false);
  // Supplied canonical state is independent of the stored token, including folds.
  const badBinding = structuredClone(p); badBinding.binding.state.folds[key] = true;
  assert.equal(guardedActionIntent(r, badBinding, key, e, current).enabled, false);
  assert.equal(guardedActionIntent(r, p, key, e, current).enabled, true);
});

test('seeded worlds expose every eligible nonfinished row in default Projects independently of input order', () => {
  let seed = 34891;
  const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let world = 0; world < 250; world++) {
    const raws = Array.from({ length: 2 + rnd(15) }, (_, n) => {
      const done = rnd(3) === 0;
      return raw(`t${(n + 1).toString(36)}`, ['working', 'idle', 'blocked'][rnd(3)], {
        state: done ? 'finished' : 'live', created_ms: 100 + n, ...(done ? { finished_ms: 900 } : {}),
        parent: n && rnd(4) ? `t${(1 + rnd(n)).toString(36)}` : undefined });
    });
    const r = freeze(reducedOf(raws));
    for (const state of [{}, { coreIds: ['core-a'] }, { contextIds: ['context-a'] }, { coreIds: [] }]) {
      const p = project(r, state), eligible = r.rows.filter(x => x.lifecycle !== 'finished' && state.coreIds?.length !== 0);
      for (const row of eligible) {
        const i = terminals(p).find(i => i.identity === rowIdentity(row));
        assert.ok(i, `world ${world}: missing ${row.address}`);
        if (row.parent.resolution === 'verified') assert.equal(i.context.parent.associationKey, row.parent.associationKey);
      }
      assert.equal(new Set(p.instances.map(i => i.key)).size, p.instances.length);
      assert.equal(new Set(p.order.map(i => i.identity)).size, p.order.length);
      assert.equal(p.counts.filtered.working, p.counts.visible.working);
      assert.deepEqual(project(reducedOf([...raws].reverse()), state), p);
    }
  }
});


test('activation validates independently asserted state before applying UI defaults', () => {
  const r = freeze(reducedOf([raw('t1', 'working')])), e = freeze(evidence(r)), p = freeze(project(r));
  const key = find(p, 't1').key, before = JSON.stringify({ r, e, p });
  const malformed = [true, 1, 'status', [], { view: 'bogus' }, null, undefined,
    { view: null }, { view: 1 }, { coreIds: 'core-a' }, { contextIds: {} },
    { coreIds: [true] }, { coreIds: [1] }, { contextIds: [[]] }, { contextIds: [{}] },
    { coreIds: [''] }, { coreIds: [' core-a'] }, { contextIds: ['bad\n'] },
    { coreIds: [undefined] }, { coreIds: Array(1) }, { folds: null }, { folds: [] },
    { folds: true }, { folds: { arbitrary: 1 } }, { folds: { arbitrary: null } },
    { unknown: true }, new Date(0), Object.create({ view: 'projects' }),
    { get view() { throw new Error('must not read accessor'); } }, { [Symbol('view')]: 'projects' }];
  const accessorIds = [];
  Object.defineProperty(accessorIds, '0', { get() { throw new Error('must not read ID accessor'); } });
  malformed.push({ coreIds: accessorIds });
  for (const state of malformed) {
    if (state?.coreIds === accessorIds) { Object.freeze(accessorIds); Object.freeze(state); }
    else if (state && Object.getOwnPropertyDescriptor(state, 'view')?.get) Object.freeze(state);
    else freeze(state);
    assert.deepEqual(guardedActionIntent(r, p, key, e, { state, generation: 'g1' }),
      { enabled: false, reason: 'projection-state-changed', intent: null });
  }
  // Partial {} explicitly means the default Projects state; full normalized state also works.
  for (const state of [{}, { view: 'projects' }, viewState(), Object.create(null)]) {
    assert.equal(guardedActionIntent(r, p, key, e, freeze({ state, generation: 'g1' })).enabled, true);
  }
  for (const state of [{ view: 'status' }, { coreIds: ['core-a'], contextIds: ['context-a'] },
    { coreIds: null, contextIds: null, folds: { arbitrary: false } },
    { coreIds: ['core-a', null, 'core-a'], contextIds: [null, 'context-a'], folds: { arbitrary: true } }]) {
    const current = freeze({ state, generation: 'g1' }), projected = freeze(project(r, state));
    const prior = JSON.stringify(current);
    assert.equal(guardedActionIntent(r, projected, find(projected, 't1').key, e, current).enabled, true);
    assert.equal(JSON.stringify(current), prior);
  }
  assert.equal(JSON.stringify({ r, e, p }), before);
});

test('Infrastructure activation requires current exact scope facts rather than saved projection scopes', () => {
  const r = freeze(reducedOf([raw('t1', 'idle', { labels: { 'herdr.role': 'supervisor' } })]));
  const row = r.rows[0], e = freeze(evidence(r));
  const scopes = freeze([{ associationKey: row.associationKey, coreId: row.core.id,
    verified: true, scope: 'core-wide', source: 'explicit-service-scope' }]);
  const p = freeze(project(r, {}, { scopes })), instance = find(p, 't1'), key = instance.key;
  assert.equal(instance.placement.label, 'Infrastructure');
  assert.equal(instance.navigation.enabled, true);
  const current = freeze({ state: viewState(), generation: 'g1', scopes });
  const before = JSON.stringify({ r, e, p, current });
  const success = guardedActionIntent(r, p, key, e, current);
  assert.equal(success.enabled, true);
  assert.equal(success.intent.coreId, row.core.id);
  assert.equal(success.intent.associationKey, row.associationKey);
  for (const currentScopes of [undefined, [], [{ ...scopes[0], scope: 'project' }],
    [{ ...scopes[0], coreId: 'core-b' }], [{ ...scopes[0], verified: false }],
    [{ ...scopes[0], associationKey: 'other' }], [{ ...scopes[0], source: '' }]]) {
    const changed = freeze({ state: current.state, generation: 'g1', ...(currentScopes ? { scopes: currentScopes } : {}) });
    const prior = JSON.stringify(changed);
    assert.equal(guardedActionIntent(r, p, key, e, changed).enabled, false);
    assert.equal(JSON.stringify(changed), prior);
  }
  assert.equal(JSON.stringify({ r, e, p, current }), before);
});
