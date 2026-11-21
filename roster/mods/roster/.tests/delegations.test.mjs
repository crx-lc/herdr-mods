import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDelegations, consumeDelegations, readDelegations } from '../delegations.js';
import { reduceRoster } from '../attention.js';
import { normalizeApp } from '../normalize.js';
import { resolveIdentities } from '../identity.js';
import { enrichMetadata } from '../metadata.js';
const copy = x => JSON.parse(JSON.stringify(x));
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const run = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function world(n = 1) {
  const producer = { address: 't4z', created_ms: 100, pid: 1, state: 'live', status: 'idle', argv: ['codex-auto'], keep: true,
    labels: { 'herdr.role': 'coordinator', 'herdr.run': run(1), 'herdr.delegations': '/data/delegations.json' } };
  const children = Array.from({ length: n }, (_, i) => ({ address: `t${7 + i}a`, created_ms: 200 + i, pid: 10 + i, state: 'live', status: 'working', parent: 't4z', argv: ['claude-auto'], keep: false,
    labels: { 'herdr.role': i === 2 ? 'reviewer' : 'developer', 'herdr.launch': run(10 + i), 'herdr.run': run(20 + i) } }));
  const record = t => ({ address: t.address, created: t.created_ms, pid: t.pid, program: t.argv[0], keep: t.keep, run: t.labels['herdr.run'] });
  const doc = { schema: 'herdr-agents/delegations', version: 1, owner: 'herdr-agents', producer: { core: 'core-a', terminal: record(producer) }, revision: 3, updatedAt: '2000-01-01T00:00:00Z',
    assignments: children.map(t => ({ id: t.labels['herdr.launch'], role: t.labels['herdr.role'], project: 'sample', item: null, child: record(t), state: 'active', revision: 1, ended: null })) };
  return { producer, terminals: [producer, ...children], machines: [{ name: null, layout: 'ready' }], doc };
}
const input = w => ({ ...w, text: JSON.stringify(w.doc) });
const assess = w => assessDelegations(input(w));
function rows(w, cores = [{ alias: '', id: 'core-a', verified: true, source: 'explicit' }]) {
  return enrichMetadata(resolveIdentities(w.terminals.map(t => normalizeApp(t, { observedAt: 1000, refresh: 'success' }, 1000)), cores)).rows;
}
const reduce = (w, options = {}, rs = rows(w)) => reduceRoster(rs, { ...w, documents: [{ producer: w.producer, text: JSON.stringify(w.doc) }], ...options });
const parent = r => r.rows.find(r => r.role === 'coordinator').roster;

test('parallel workers count actual work; waiting coordinator contributes zero with distinct display metadata', () => {
  const w = world(3), r = reduce(w); assert.equal(parent(r).state, 'waiting');
  assert.equal(r.counts.working, 3); assert.equal(parent(r).delegation.pendingCount, 3);
  assert.deepEqual(parent(r).display, { collapsedLabel: 'Waiting for delegate', icon: 'delegation-waiting', tooltip: 'Waiting on 3 agents', detail: 'Waiting on 3 agents' });
});
test('known Developer/Reviewer and unknown role details retain literal collapsed label', () => {
  for (const [role, label] of [['developer', 'Waiting for Developer'], ['reviewer', 'Waiting for Reviewer'], ['unknown', 'Waiting on 1 agent']]) {
    const w = world(); w.terminals[1].labels['herdr.role'] = role;
    assert.equal(parent(reduce(w)).display.detail, label); assert.equal(parent(reduce(w)).display.collapsedLabel, 'Waiting for delegate');
  }
});
test('pending differs from working; last work stopping and finished/done children clear waiting', () => {
  const w = world(3); w.terminals[2].status = 'idle'; w.terminals[3].status = 'done';
  let r = reduce(w); assert.equal(parent(r).delegation.pendingCount, 2); assert.equal(r.counts.working, 1);
  w.terminals[1].status = 'idle'; assert.equal(parent(reduce(w)).state, 'idle');
  w.terminals[1].state = 'finished'; w.terminals[2].state = 'finished'; r = reduce(w);
  assert.equal(parent(r).delegation.pendingCount, 0); assert.equal(parent(r).state, 'idle');
});
test('explicit end never joins unrelated later child work, including same-address reuse', () => {
  for (const reuse of [false, true]) {
    const w = world(); const a = w.doc.assignments[0]; a.state = 'ended'; a.ended = { reason: 'completed', revision: 3 };
    if (reuse) { w.terminals[1].created_ms++; w.terminals[1].pid++; w.terminals[1].labels['herdr.run'] = run(90); }
    assert.equal(parent(reduce(w)).state, 'idle'); assert.equal(parent(reduce(w)).delegation.pendingCount, 0);
  }
});
test('own attention and direct child attention outrank waiting without extra actionable parent', () => {
  const w = world(2); w.terminals[1].status = 'blocked';
  let r = reduce(w); assert.equal(parent(r).state, 'child-needs-you'); assert.equal(r.targets.length, 1);
  assert.equal(parent(r).children[0].address, w.terminals[1].address); assert.equal(parent(r).actionable, false);
  w.producer.status = 'blocked'; r = reduce(w); assert.equal(parent(r).state, 'needs-you'); assert.equal(r.targets.length, 2);
  const rs = rows(w); rs.find(r => r.address === w.terminals[1].address).parent.resolution = 'unresolved';
  w.producer.status = 'idle'; const idle = rows(w); idle.find(r => r.address === w.terminals[1].address).parent.resolution = 'unresolved';
  assert.equal(parent(reduce(w, {}, idle)).state, 'waiting');
  assert.equal(parent(reduce(w, {}, idle)).children.length, 0);
});
for (const [name, change, why] of [
  ['producer pid', w => w.producer.pid++, 'producer-mismatch'],
  ['producer root', w => w.producer.argv = ['bash'], 'producer-continuity'],
  ['producer run', w => w.producer.labels['herdr.run'] = run(99), 'producer-continuity'],
  ['producer disconnect', w => w.machines[0].layout = 'unavailable', 'machine-unavailable'],
  ['worker pid', w => w.terminals[1].pid++, 'child-incarnation'],
  ['worker creation', w => w.terminals[1].created_ms++, 'child-incarnation'],
  ['worker run', w => w.terminals[1].labels['herdr.run'] = run(99), 'child-continuity'],
  ['worker kept', w => w.terminals[1].keep = true, 'child-continuity'],
  ['worker root', w => w.terminals[1].argv = ['wrapper'], 'child-continuity'],
  ['worker launch', w => w.terminals[1].labels['herdr.launch'] = run(99), 'child-launch-label'],
  ['worker parent', w => w.terminals[1].parent = 't99', 'child-parent'],
  ['cross core', w => w.doc.assignments[0].child.address = 'edge/t7a', 'child-machine-unavailable'],
  ['finished worker', w => w.terminals[1].state = 'finished', 'child-finished'],
]) test(`${name} fails closed in consumer and reduction`, () => {
  const w = world(); change(w); const result = assess(w);
  assert.equal(result.why ?? result.assignments[0].why, why); assert.notEqual(parent(reduce(w)).state, 'waiting');
});
test('missing core/ambiguous identity, conflicting parent, stale R1 status never promote waiting', () => {
  const w = world();
  assert.equal(parent(reduce(w, {}, rows(w, []))).state, 'idle');
  for (const mutate of [r => r.freshness = 'stale', r => r.appStatus = 'unknown', r => r.parent.resolution = 'conflict']) {
    const rs = rows(w); mutate(rs.find(r => r.address === 't7a')); assert.equal(parent(reduce(w, {}, rs)).state, 'idle');
  }
  assert.equal(assessDelegations({ ...input(w), coreId: 'other' }).why, 'core-mismatch');
});
test('parser rejects malformed whole documents, duplicates and revisions; ignores additive fields and timestamp age', () => {
  for (const mutate of [d => delete d.producer.terminal.run, d => delete d.assignments[0].child.keep,
    d => d.assignments.push(copy(d.assignments[0])), d => d.assignments[0].revision = 9,
    d => d.assignments[0].state = 'surprise']) {
    const w = world(); mutate(w.doc); assert.equal(assess(w).why, 'malformed');
  }
  const w = world(); w.doc.extra = { future: true }; assert.equal(assess(w).assignments[0].state, 'active');
  assert.equal(assessDelegations({ ...input(w), text: '{' }).why, 'unreadable');
  assert.equal(assessDelegations({ ...input(w), text: null }).why, 'missing');
  w.doc.schema = 'foreign'; assert.equal(assess(w).why, 'not-a-contract');
  w.doc.schema = 'herdr-agents/delegations'; w.doc.version = 2; assert.equal(assess(w).why, 'version-unknown');
});
test('monotonic revisions survive disconnect/reconnect; new producer incarnation has independent history', () => {
  const w = world(), first = consumeDelegations(input(w));
  w.machines[0].layout = 'unavailable'; assert.equal(consumeDelegations(input(w), first.history).result.status, 'unknown');
  w.machines[0].layout = 'ready'; w.doc.revision = 2;
  assert.equal(consumeDelegations(input(w), first.history).result.why, 'revision-backwards');
  w.producer.pid++; w.doc.producer.terminal.pid++; assert.equal(consumeDelegations(input(w), first.history).result.status, 'ok');
});
test('watcher attention stays unless exact optional live sole-cause delivery evidence passes', () => {
  const w = world(); const watcher = copy(w.terminals[1]); watcher.address = 't99'; watcher.created_ms = 300; watcher.pid = 99;
  watcher.status = 'blocked'; watcher.labels['herdr.role'] = 'watcher'; w.terminals.push(watcher); w.terminals[1].status = 'blocked';
  const rs = rows(w), watch = rs.find(r => r.address === 't99'), target = rs.find(r => r.address === 't7a');
  const evidence = (r, raw) => ({ associationKey: r.associationKey, pid: raw.pid, run: raw.labels['herdr.run'] });
  const c = { verified: true, soleCause: true, source: 'explicit-live-event', generation: 1, delivery: run(80), targetDelivery: run(80), watcher: evidence(watch, watcher), target: evidence(target, w.terminals[1]) };
  assert.equal(reduce(w).targets.length, 2);
  assert.equal(reduce(w, { correlations: [c], generation: 1 }).targets.length, 1);
  for (const edit of [x => x.soleCause = false, x => x.verified = false, x => x.generation = 0, x => x.target.pid++, x => x.target.run = run(90), x => x.targetDelivery = run(81)]) {
    const bad = copy(c); edit(bad); assert.equal(reduce(w, { correlations: [bad], generation: 1 }).targets.length, 2);
  }
});
test('pure transitions are deterministic and never mutate frozen observations or native statuses', () => {
  const w = freeze(world(3)), rs = freeze(rows(w)), opts = freeze({ ...w, documents: [{ producer: w.producer, text: JSON.stringify(w.doc) }] });
  const before = JSON.stringify({ w, rs, opts }); const a = reduceRoster(rs, opts);
  assert.deepEqual(a, reduceRoster([...rs].reverse(), { ...opts, terminals: [...opts.terminals].reverse() }));
  assert.equal(JSON.stringify({ w, rs, opts }), before);
  assert.equal(a.rows.find(r => r.role === 'coordinator').appStatus, 'idle');
  const saved = globalThis.Intl, encoder = globalThis.TextEncoder;
  try { delete globalThis.Intl; delete globalThis.TextEncoder; assert.deepEqual(reduceRoster(rs, opts), a); }
  finally { globalThis.Intl = saved; globalThis.TextEncoder = encoder; }
});
const deadline = p => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), 10))]);
test('bounded acquisition handles absent, rejected, malformed, oversized, hung and late reads', async () => {
  const w = world(); const host = { generation: () => 1, deadline, readTextFile: async (path, options) => { assert.equal(path, '/data/delegations.json'); assert.deepEqual(options, { on: null }); return JSON.stringify(w.doc); } };
  assert.equal((await readDelegations(host, w.producer, 1)).status, 'read');
  for (const fn of [async () => null, async () => { throw Error('unavailable'); }, async () => 7, async () => 'x'.repeat(1048577), () => new Promise(() => {})]) {
    const r = await readDelegations({ ...host, readTextFile: fn }, w.producer, 1);
    assert.ok(r.status === 'unknown' || r.text === null);
  }
  let finish; const pending = readDelegations({ ...host, readTextFile: () => new Promise(r => finish = r) }, w.producer, 1);
  await new Promise(r => setTimeout(r, 20)); assert.equal((await pending).status, 'unknown'); finish(JSON.stringify(w.doc));
  assert.equal((await readDelegations({ ...host, generation: () => 2 }, w.producer, 1)).why, 'superseded-read');
  w.producer.address = 'edge/t4z';
  assert.equal((await readDelegations({ ...host, readTextFile: async (_, o) => { assert.equal(o.on, 'edge'); return '{'; } }, w.producer, 1)).status, 'read');
  w.producer.labels['herdr.delegations'] = 'relative'; assert.equal((await readDelegations(host, w.producer, 1)).why, 'invalid-path');
});

test('older R1 process observations cannot attach working status to a later process sharing creation time', () => {
  const w = world(), rs = rows(w);
  w.terminals[1].pid++; w.terminals[1].labels['herdr.run'] = run(99);
  w.doc.assignments[0].child.pid++; w.doc.assignments[0].child.run = run(99);
  assert.equal(assess(w).assignments[0].state, 'active');
  assert.equal(parent(reduce(w, {}, rs)).state, 'idle');
  const old = copy(w.terminals[1]); old.pid--; old.labels['herdr.run'] = run(20);
  const mixed = enrichMetadata(resolveIdentities([...w.terminals, old].map(t => normalizeApp(t, { observedAt: 1000, refresh: 'success' }, 1000)), [{ alias: '', id: 'core-a', verified: true, source: 'explicit' }])).rows;
  assert.equal(parent(reduce(w, {}, mixed)).state, 'idle');
});
test('revision history follows explicit core aliases, and cached documents cannot cross a reconnect generation', () => {
  const w = world(); const first = consumeDelegations({ ...input(w), coreId: 'core-a' });
  w.producer.address = 'edge/t4z'; w.terminals[1].address = 'edge/t7a'; w.terminals[1].parent = 'edge/t4z'; w.machines.push({ name: 'edge', layout: 'ready' }); w.doc.revision = 2;
  assert.equal(consumeDelegations({ ...input(w), coreId: 'core-a' }, first.history).result.why, 'revision-backwards');
  const local = world(); assert.equal(parent(reduce(local, { generation: 2, documents: [{ producer: local.producer, text: JSON.stringify(local.doc), generation: 1 }] })).state, 'idle');
  assert.equal(parent(reduce(local, { generation: 2, documents: [{ producer: local.producer, text: JSON.stringify(local.doc), generation: 2 }] })).state, 'waiting');
});

test('partial contract knowledge reports confirmed lower bounds and does not count a stale delegate', () => {
  const w = world(3); w.terminals[2].keep = true; w.terminals[3].status = 'idle';
  const r = reduce(w), d = parent(r).delegation;
  assert.equal(d.knowledge, 'partial'); assert.equal(d.pendingCount, 2); assert.equal(d.workingCount, 1);
  assert.equal(d.unresolved.length, 1); assert.equal(parent(r).state, 'waiting');
  // Counts measure all actual agents, even when their assignment is unverifiable.
  assert.equal(r.counts.working, 2);
  const duplicate = reduce(w, { documents: [{ producer: w.producer, text: JSON.stringify(w.doc) }, { producer: w.producer, text: JSON.stringify(w.doc) }] });
  assert.equal(parent(duplicate).delegation.knowledge, 'unknown'); assert.equal(parent(duplicate).state, 'idle');
});
test('verified alias routing preserves exact delegated identity without overriding conflicting R1 process evidence', () => {
  const w = world();
  const aliases = w.terminals.map(t => ({ ...copy(t), address: `edge/${t.address}`, parent: t.parent ? `edge/${t.parent}` : null }));
  const all = [...w.terminals, ...aliases];
  const rs = enrichMetadata(resolveIdentities(all.map(t => normalizeApp(t, { observedAt: 1000, refresh: 'success' }, 1000)),
    [{ alias: '', id: 'core-a', verified: true, source: 'explicit' }, { alias: 'edge', id: 'core-a', verified: true, source: 'explicit' }])).rows;
  const r = reduce(w, {}, rs); assert.equal(parent(r).state, 'waiting'); assert.equal(r.counts.working, 1);
  assert.equal(parent(r).delegation.delegates[0].associationKey, rs.find(r => r.terminalId === 't7a').associationKey);
});
test('ready cross-core workers and ambiguous child addresses are unknown', () => {
  const w = world(); w.doc.assignments[0].child.address = 'edge/t7a'; w.machines.push({ name: 'edge', layout: 'ready' });
  assert.equal(assess(w).assignments[0].why, 'child-cross-core');
  const d = world(); d.terminals.push(copy(d.terminals[1])); assert.equal(assess(d).assignments[0].why, 'child-ambiguous');
});
