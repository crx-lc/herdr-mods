import test from 'node:test';
import assert from 'node:assert/strict';
const source = process.env.ROSTER_CORRECTIONS_SOURCE ?? new URL('../', import.meta.url).href;
const { Controller } = await import(`${source}/controller.js`);
const { createRosterView } = await import(`${source}/view.js`);
// Expectations and fixtures are independent of fingerprint/selection implementation helpers.
import { fakeHost, terminal, fixture, prove, route, settings, kit, appOf, context, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';
const rows = p => p.instances.filter(i => i.kind === 'terminal');
const find = (p, address) => rows(p).find(i => i.row.address === address);
function viewOf(f, production = false) {
  const Type = createRosterView(kit, appOf(f.host), { ...(production ? {} : { host: f.host }), layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), { cx } = context(); view.init({}, cx); return { view, cx };
}
function admitted() {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  const base = prove(f.host, { settings, sourceGeneration: 1 });
  let reads = 0, now = 1000;
  f.host.now = () => now;
  f.host.evidence = (snapshot, generation) => ({ ...structuredClone(base),
    routes: [route('core-a', 't1', 't1', 'pane', generation)],
    admissions: [{ address: 't1', coreId: 'core-a', verified: true, continuity: true, generation,
      producer: JSON.stringify(snapshot.terminals[0]), source: 'independent-current-proof' }] });
  f.values.panes = [{ pane: 'pane-a', terminal: 't1', tab: 'tab-a' }];
  f.host.readTextFile = async () => { reads++; return JSON.stringify(world.doc); };
  return { ...f, world, base, c: new Controller(f.host, expanded), reads: () => reads, advance: ms => now += ms };
}

test('F1 production snapshot scope stays bounded through 3000 terminal turns', () => {
  const f = fakeHost([]), { view, cx } = viewOf(f, true), samples = [];
  for (let i = 1; i <= 3000; i++) {
    f.values.terminals = [terminal(`t${i.toString(36)}`, 'working', { created_ms: i }), terminal('edge/t1', 'blocked')];
    view.render(cx);
    assert.equal(view.controller.feed.reduced.rows.length, 2);
    assert.equal(view.controller.projection.counts.all.identities, 2);
    assert.equal(view.controller.projection.counts.all.needsYou, 1);
    if (i % 1000 === 0) samples.push({ turns: i, held: view.controller.feed.previous?.size ?? 0, reduced: 2, instances: rows(view.controller.projection).length });
  }
  f.values.terminals = []; view.render(cx);
  assert.equal(view.controller.feed.reduced.rows.length, 0);
  assert.ok(!view.controller.feed.previous || view.controller.feed.previous.size === 0);
  assert.equal(f.calls.length, 0); console.log('churn scope samples', samples);
});

test('F6 address reuse removes superseded incarnation and keeps distinct aliases/cores', () => {
  const f = fakeHost([terminal('t1'), terminal('edge/t1')]); prove(f.host);
  const c = new Controller(f.host, expanded); c.render(); f.values.terminals[0] = terminal('t1', 'working', { created_ms: 200 }); c.render();
  assert.equal(c.feed.reduced.rows.length, 2); assert.equal(c.projection.counts.all.identities, 2);
  assert.deepEqual(c.feed.reduced.rows.filter(r => r.address === 't1').map(r => r.incarnation), [200]);
  assert.equal(c.feed.reduced.rows.find(r => r.address === 'edge/t1').core.id, 'core-b');
});

test('F3 authoritative PaneInfo.pane permits exact focus; strict fake rejects impossible id', () => {
  const f = fakeHost(); f.values.panes = [{ pane: 'pane-a', terminal: 't1', tab: 'tab-a' }];
  prove(f.host, { routes: [route('core-a', 't1', 't1', 'pane')] });
  const c = new Controller(f.host, expanded), p = c.render(); assert.equal(find(p, 't1').navigation.enabled, true);
  assert.equal(c.activate(p, find(p, 't1').key).enabled, true);
  assert.deepEqual(f.calls, [['pane.focus', { terminal: 't1' }]]);
  f.values.panes = [{ id: 'impossible', terminal: 't1', tab: 'tab-a' }]; assert.throws(() => c.render(), /PaneInfo/);
});

test('F3 malformed, absent or duplicate pane fields fail closed for pane and pane-less routes', () => {
  const valid = { pane: 'pane-a', terminal: 't1', tab: 'tab-a' };
  const models = [[{ id: 'old', terminal: 't1', tab: 'tab-a' }], [{ ...valid, pane: '' }], [{ ...valid, pane: null }],
    [{ ...valid, tab: undefined }], [{ ...valid, terminal: undefined }], [valid, valid], [valid, { ...valid, terminal: 't2' }]];
  for (const panes of models) for (const presentation of ['pane', 'pane-less']) {
    const f = fakeHost(); f.host.panes = () => structuredClone(panes); // Deliberately malformed transport input.
    prove(f.host, { routes: [route('core-a', 't1', 't1', presentation)] });
    const c = new Controller(f.host, expanded), p = c.render(); assert.equal(c.activate(p, find(p, 't1').key).enabled, false); assert.equal(f.calls.length, 0);
  }
});

test('F4 provider stamps its supplied generation: routes stabilise through render and activation', () => {
  const f = fakeHost(), base = prove(f.host);
  f.host.evidence = (_snapshot, generation) => ({ ...structuredClone(base), routes: [route('core-a', 't1', 't1', 'pane-less', generation)] });
  const c = new Controller(f.host, expanded);
  for (let i = 0; i < 5; i++) {
    const p = c.render(); assert.equal(c.feed.generation, 1); assert.equal(find(p, 't1').navigation.enabled, true);
    assert.equal(c.activate(p, find(p, 't1').key).enabled, true);
  }
  assert.equal(f.calls.length, 5);
});

test('F4 admitted waiting survives focus, scroll, selection and agent display without reread', async () => {
  const f = admitted(); f.c.render(); assert.equal(await f.c.refresh(), true);
  assert.equal(find(f.c.render(), 't1').row.roster.state, 'waiting'); const generation = f.c.feed.generation;
  for (const change of [() => f.values.focused = { terminal: 't2', selection: 'sample' },
    () => f.values.panes[0].scroll = { offset: 5 }, () => f.values.panes[0].selection = 'sample',
    () => f.values.panes[0].focused = true, () => f.values.terminals[0].selection = { start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }, () => f.values.agents = [{ address: 't2', focused: true }]]) {
    change(); assert.equal(find(f.c.render(), 't1').row.roster.state, 'waiting');
    assert.equal(f.c.feed.generation, generation); assert.equal(f.reads(), 1);
  }
  f.advance(5000); assert.equal(await f.c.refresh(), false); assert.equal(f.reads(), 1);
  assert.equal(find(f.c.render(), 't1').row.roster.state, 'waiting');
});

test('admitted delegation tracks current statuses without reacquiring continuity', async () => {
  const f = admitted(); f.c.render(); assert.equal(await f.c.refresh(), true);
  let p = f.c.render(); const generation = f.c.feed.generation, document = f.c.feed.documents[0];
  assert.equal(find(p, 't1').row.roster.state, 'waiting');
  const stable = () => { assert.equal(f.c.feed.generation, generation); assert.equal(f.c.feed.documents[0], document); assert.equal(f.reads(), 1); };
  f.values.terminals[1].status = 'idle'; f.values.terminals[1].status_ms = 1050;
  p = f.c.render(); stable(); assert.equal(find(p, 't1').row.roster.state, 'waiting');
  assert.equal(find(p, 't2').row.roster.state, 'idle'); assert.equal(p.counts.all.working, 2);
  f.values.terminals[1].status = 'blocked'; f.values.terminals[1].status_ms = 1100;
  p = f.c.render(); stable();
  assert.equal(find(p, 't1').row.roster.state, 'child-needs-you');
  assert.equal(find(p, 't2').row.roster.state, 'needs-you');
  assert.equal(p.counts.all.working, 2); assert.equal(p.counts.all.needsYou, 1);
  f.values.terminals[0].status = 'blocked'; f.values.terminals[0].status_ms = 1200;
  p = f.c.render(); stable(); assert.equal(find(p, 't1').row.roster.state, 'needs-you');
  f.values.terminals[0].status = 'idle'; f.values.terminals[0].status_ms = 1300;
  f.values.terminals[2].status = 'idle'; f.values.terminals[2].status_ms = 1300;
  f.values.terminals[3].status = 'idle'; f.values.terminals[3].status_ms = 1300;
  p = f.c.render(); stable(); assert.notEqual(find(p, 't1').row.roster.state, 'waiting');
  assert.equal(p.counts.all.working, 0); assert.equal(find(p, 't2').row.roster.state, 'needs-you');
  f.advance(5000); assert.equal(await f.c.refresh(), false); stable();
});

const realChanges = {
  core: f => f.base.cores[0].id = 'replacement-core',
  epoch: f => f.base.sourceGeneration++,
  disconnect: f => f.values.machines[0].layout = 'unavailable',
  incarnation: f => f.values.terminals[0].created_ms++,
  pid: f => f.values.terminals[0].pid++,
  root: f => f.values.terminals[0].argv[0] = 'other-root',
  run: f => f.values.terminals[0].labels['herdr.run'] = '22222222-2222-4222-8222-222222222222',
  launch: f => f.values.terminals[1].labels['herdr.launch'] = 'other-launch',
  parent: f => f.values.terminals[1].parent = 't9',
  keep: f => f.values.terminals[1].keep = true,
  state: f => f.values.terminals[1].state = 'finished',
  path: f => f.values.terminals[0].labels['herdr.delegations'] = '/sample/replacement.json',
  paneIdentity: f => f.values.panes[0].pane = 'replacement-pane',
  paneAddress: f => f.values.panes[0].terminal = 't2',
  paneMembership: f => f.values.panes = [],
  completeness: f => f.base.panesComplete = false,
  proof: f => f.base.cores[0].source = 'changed-proof',
  withdrawal: f => f.host.evidence = () => ({ cores: [], documents: [], admissions: [], routes: [] }),
};
test('F4 every real acquisition change invalidates callbacks and admitted text within throttle', async () => {
  for (const [name, change] of Object.entries(realChanges)) {
    const f = admitted(); f.c.render(); await f.c.refresh(); const p = f.c.render(), old = f.c.feed.generation;
    assert.equal(find(p, 't1').row.roster.state, 'waiting'); change(f);
    assert.equal(await f.c.refresh(), false, name); // Must observe even when no new read is allowed.
    assert.ok(f.c.feed.generation > old, name); assert.equal(f.c.feed.documents.length, 0, name);
    assert.equal(f.c.activate(p, find(p, 't1').key).enabled, false, name);
    assert.equal(f.c.feed.history[0].revision, 1, name); assert.equal(f.reads(), 1, name); assert.equal(f.calls.length, 0, name);
  }
});

test('F4 late completions cannot cross any real acquisition change during throttle', async () => {
  for (const [name, change] of Object.entries(realChanges)) {
    const f = admitted(); f.c.render(); let complete;
    f.host.readTextFile = () => new Promise(resolve => complete = resolve);
    const pending = f.c.refresh(); await Promise.resolve(); await Promise.resolve();
    change(f); assert.equal(await f.c.refresh(), false, name); complete(JSON.stringify(f.world.doc));
    assert.equal(await pending, false, name); assert.equal(f.c.feed.documents.length, 0, name);
  }
});

test('F4 explicit fresh read invalidates before await and retains revision high water', async () => {
  const f = admitted(); f.c.render(); await f.c.refresh(); const p = f.c.render(), old = f.c.feed.generation;
  f.advance(10000); let complete; f.host.readTextFile = () => new Promise(resolve => complete = resolve);
  const pending = f.c.refresh(); assert.equal(f.c.feed.generation, old + 1); assert.equal(f.c.feed.documents.length, 0);
  assert.equal(f.c.activate(p, find(p, 't1').key).enabled, false); assert.equal(f.c.feed.history[0].revision, 1);
  await Promise.resolve(); await Promise.resolve(); complete(null); await pending;
  assert.equal(f.c.feed.history[0].revision, 1);
});

test('F5 Enter preserves mode/filter/fold position, Down advances and tooltip/a11y follows', () => {
  const f = fakeHost([terminal('t1'), terminal('t2', 'working', { parent: 't1' }), terminal('edge/t3')]); prove(f.host);
  const { view, cx } = viewOf(f); view.toolsOpen = true; let tree = view.render(cx);
  const parent = find(view.controller.projection, 't1');
  const section = view.controls.find(c => c.label.includes('Unassigned'));
  for (const key of ['mode:status', 'mode:projects', 'filter:coreIds:value:core-a', 'all:coreIds', `fold:${parent.key}`, section.key]) {
    view.controller.cursor = key; view.key({ keystroke: 'enter' }, cx); tree = view.render(cx);
    assert.equal(view.controller.cursor, key);
    const index = view.controls.findIndex(c => c.key === key), expected = view.controls[(index + 1) % view.controls.length].key;
    view.key({ keystroke: 'down' }, cx); tree = view.render(cx); assert.equal(view.controller.cursor, expected);
    const selected = view.controls.find(c => c.key === expected);
    assert.equal(tree.attributes.accessibility_label[0], selected.label);
    assert.equal(textOf(flatten(tree).find(e => e.attributes.id?.[0] === 'roster-focus-tooltip')), [selected.disabledReason, selected.detail ?? selected.label, selected.instance ? 'Details (D)' : null].filter(Boolean).join(' '));
  }
  assert.equal(f.calls.length, 0);
});

test('F5 disappeared selected control falls back deterministically without implicit terminal action', () => {
  const f = fakeHost(), { view, cx } = viewOf(f); view.render(cx);
  const key = find(view.controller.projection, 't1').key; view.controller.cursor = key;
  const index = view.controls.findIndex(c => c.key === key); f.values.terminals = []; view.render(cx);
  assert.equal(view.controller.cursor, view.controls[Math.min(index, view.controls.length - 1)].key);
  assert.equal(f.calls.length, 0);
});
