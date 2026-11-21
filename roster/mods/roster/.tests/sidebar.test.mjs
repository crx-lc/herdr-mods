import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Controller } from '../controller.js';
import { Feed } from '../feed.js';
import { desktopHost } from '../desktop.js';
import { createRosterView, timerDeadline } from '../view.js';
import { reduceRoster } from '../attention.js';
import { fakeHost, terminal, fixture, prove, cores, settings, route, association, context, kit, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';
const rows = p => p.instances.filter(i => i.kind === 'terminal');
const find = (p, address) => rows(p).find(i => i.row.address === address);
const checkCounts = counts => assert.deepEqual(counts, { terminals: 1, machines: 1, panes: 1, spaces: 1, agents: 1, focused: 1 });
function viewOf(f, options = {}) { const app = appOf(f.host), Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, ...options }); const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c, app }; }

test('actual main entry defaults passive, captures exactly once, renders labels and never reads or acts', async () => {
  const f = fakeHost([terminal('t1', 'blocked', { labels: { 'herdr.issue': 'sample/repo#12', 'herdr.role': 'planner', 'herdr.project': 'sample' } }), terminal('edge/t1')]);
  const app = appOf(f.host); globalThis.__rosterTestKit = kit; globalThis.__rosterTestApp = app; globalThis.localStorage = { getItem: () => { throw Error('unexpected state'); }, setItem: () => { throw Error('unexpected state'); } };
  const url = source => `data:text/javascript,${encodeURIComponent(source)}`;
  const source = (await readFile(new URL('../main.js', import.meta.url), 'utf8'))
    .replace("'gpui-kit'", JSON.stringify(url('export const View = globalThis.__rosterTestKit.View; export const div = globalThis.__rosterTestKit.div;')))
    .replace("'herdr'", JSON.stringify(url(Object.keys(app).map(k => `export const ${k} = globalThis.__rosterTestApp.${k};`).join('\n'))))
    .replace("'./view.js'", JSON.stringify(new URL('../view.js', import.meta.url).href));
  const Type = (await import(url(source))).default, view = new Type(), c = context(); view.init({}, c.cx);
  const tree = view.render(c.cx); checkCounts(f.counts); assert.equal(c.stats.focus, 0); assert.equal(f.calls.length, 0);
  assert.match(textOf(tree), /Planner #12/); assert.match(textOf(tree), /GitHub/); assert.match(textOf(tree), /Context unknown/);
  assert.match(textOf(tree), /unverified/); assert.ok(rows(view.controller.projection).every(i => !i.navigation.enabled));
  assert.ok(view.controller.feed.reduced.rows.every(r => !r.core.verified && r.project.id === null));
  assert.ok(flatten(tree).some(e => e.attributes.accessibility_label?.[0].includes('GitHub')));
  assert.ok(flatten(tree).some(e => e.attributes.w?.[0] === 18 && e.attributes.h?.[0] === 18));
  delete globalThis.__rosterTestKit; delete globalThis.__rosterTestApp;
});

test('default adapter ignores purported host identity provider and preserves separate aliases', () => {
  const f = fakeHost([terminal('t1'), terminal('edge/t1')]); prove(f.host, { documents: [{ text: '{"producer":{"core":"core-a"}}' }] });
  const c = new Controller(desktopHost(appOf(f.host), p => p)), p = c.render();
  assert.equal(rows(p).length, 2); assert.ok(c.feed.reduced.rows.every(r => !r.core.verified)); assert.equal(p.order.length, 0);
});

for (const [address, core, presentation] of [['t1', 'core-a', 'pane'], ['edge/t1', 'core-b', 'pane'], ['t1', 'core-a', 'pane-less'], ['edge/t1', 'core-b', 'pane-less']]) {
  test(`actual actionIntent dispatches exact ${address} ${presentation} only on activation`, () => {
    const f = fakeHost([terminal(address)]); if (presentation === 'pane') f.values.panes = [{ id: 'pane-sample', terminal: address, tab: 'tab-a' }];
    prove(f.host, { routes: [route(core, 't1', address, presentation)] });
    const c = new Controller(f.host), p = c.render(); checkCounts(f.counts); assert.equal(f.calls.length, 0);
    assert.equal(c.activate(p, find(p, address).key).enabled, true);
    assert.deepEqual(f.calls, [[presentation === 'pane' ? 'pane.focus' : 'terminal.peek', { terminal: address }]]);
    assert.ok(Object.values(f.counts).every(n => n === 2));
  });
}

test('model completeness, duplicate pane, unsupported presentation, route generation and offline readiness fail closed', () => {
  for (const mutation of [e => e.panesComplete = false, e => e.routes[0].generation = 0, e => e.routes[0].presentation = 'guess', e => e.routes.push(e.routes[0])]) {
    const f = fakeHost(); const e = prove(f.host, { routes: [route('core-a', 't1', 't1')] }); mutation(e);
    const c = new Controller(f.host), p = c.render(); assert.equal(c.activate(p, find(p, 't1').key).enabled, false); assert.equal(f.calls.length, 0);
  }
  for (const panes of [[{ id: 'a', terminal: 't1' }], [{ id: 'a', terminal: 't1' }, { id: 'b', terminal: 't1' }]]) {
    const f = fakeHost(); f.values.panes = panes; prove(f.host, { routes: [route('core-a', 't1', 't1')] });
    const c = new Controller(f.host), p = c.render(); assert.equal(find(p, 't1').navigation.enabled, false);
  }
});

test('stale callbacks, changed view, vanished target and observed disconnect reject activation', () => {
  for (const change of [f => f.values.terminals.splice(0), f => f.values.machines[0].layout = 'unavailable', f => f.values.panes.push({ id: 'new', terminal: 't1' })]) {
    const f = fakeHost(); prove(f.host, { routes: [route('core-a', 't1', 't1')] }); const c = new Controller(f.host), p = c.render();
    change(f); assert.equal(c.activate(p, find(p, 't1').key).enabled, false); assert.equal(f.calls.length, 0);
  }
  const f = fakeHost(); prove(f.host, { routes: [route('core-a', 't1', 't1')] }); const c = new Controller(f.host), p = c.render(); c.change({ type: 'view', view: 'status' });
  assert.equal(c.activate(p, find(p, 't1').key).enabled, false); assert.equal(f.calls.length, 0);
});

test('vanished observations become stale without fabricated finished history', () => {
  const f = fakeHost(), c = new Controller(f.host); c.render(); f.values.terminals = []; c.render();
  assert.equal(c.feed.reduced.rows[0].freshness, 'stale'); assert.equal(c.feed.reduced.rows[0].lifecycle, 'live');
});

function waitingWorld(partial = false) {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  if (partial) world.doc.assignments.push({ ...world.doc.assignments[0], id: 'missing', child: { ...world.doc.assignments[0].child, address: 't9' } });
  prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
  return { f, world };
}
test('actual view renders static compact waiting, full hover AND keyboard focus text, collapsed and Status full detail/count3', () => {
  const { f } = waitingWorld(), { view, cx } = viewOf(f); let tree = view.render(cx), p = view.controller.projection;
  const parent = find(p, 't1'); assert.equal(parent.display.compact, true); assert.equal(p.counts.all.working, 3);
  const element = flatten(tree).find(e => e.attributes.id?.[0] === parent.key);
  assert.equal(element.attributes.tooltip[0], 'Waiting on 3 agents'); assert.match(element.attributes.accessibility_label[0], /Waiting on 3 agents/);
  assert.match(textOf(element), /◈/); view.controller.cursor = parent.key; tree = view.render(cx);
  assert.match(textOf(flatten(tree).find(e => e.attributes.id?.[0] === 'roster-focus-tooltip')), /Waiting on 3 agents/);
  view.controller.change({ type: 'fold', key: parent.key, collapsed: true }); tree = view.render(cx); assert.match(textOf(tree), /Waiting on 3 agents/);
  view.controller.change({ type: 'view', view: 'status' }); tree = view.render(cx); assert.match(textOf(tree), /Working · 3/); assert.match(textOf(tree), /Waiting on 3 agents/);
  assert.equal(f.calls.length, 0);
});

test('R2 partial waiting is assessed, omitted and rerun; high water survives failure/reconnect', () => {
  const { f, world } = waitingWorld(true), c = new Controller(f.host); c.render();
  assert.equal(find(c.projection, 't1').row.roster.state, 'idle'); assert.equal(c.feed.history[0].revision, 1);
  const direct = reduceRoster(c.feed.reduced.rows, { terminals: f.values.terminals, machines: f.values.machines, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }], generation: 1 });
  assert.equal(direct.rows.find(r => r.address === 't1').roster.delegation.knowledge, 'partial'); assert.equal(direct.rows.find(r => r.address === 't1').roster.state, 'waiting');
  f.values.machines[0].layout = 'unavailable'; c.render(); f.values.machines[0].layout = 'ready'; c.render(); assert.equal(c.feed.history[0].revision, 1);
  assert.notEqual(find(c.projection, 't1').row.roster.state, 'waiting');
});

test('mode/fold/filter controls and keyboard arrows cause zero terminal actions, Enter uses current projection', () => {
  const f = fakeHost(); prove(f.host, { routes: [route('core-a', 't1', 't1')] }); const { view, cx, stats } = viewOf(f);
  let tree = view.render(cx);
  for (const id of ['mode:status', 'mode:projects', 'filter:coreIds:core-a', 'all:coreIds', 'filter:contextIds:null', 'all:contextIds']) {
    flatten(tree).find(e => e.attributes.id?.[0] === id).attributes.on_click[0]({}, cx); tree = view.render(cx);
  }
  view.key({ keystroke: 'down' }, cx); view.key({ keystroke: 'up' }, cx); assert.equal(f.calls.length, 0);
  const row = find(view.controller.projection, 't1'); view.controller.cursor = row.key; view.key({ keystroke: 'enter' }, cx);
  assert.deepEqual(f.calls, [['terminal.peek', { terminal: 't1' }]]); assert.ok(stats.stop >= 3);
  assert.equal(new Set(view.controls.map(c => c.key)).size, view.controls.length);
});

test('global Needs you survives filters/folds and contextual parent stays contextual', () => {
  const { f, world } = waitingWorld(); f.values.terminals[1].status = 'blocked'; const c = new Controller(f.host); let p = c.render();
  assert.equal(find(p, 't1').contextOnly, true); assert.equal(p.counts.all.needsYou, 1);
  c.change({ type: 'filters', coreIds: [] }); p = c.render(); assert.equal(rows(p).length, 1); assert.equal(rows(p)[0].row.address, world.children[0].address);
  assert.equal(rows(p)[0].navigation.enabled, false); assert.equal(f.calls.length, 0);
});

test('hidden children retain an accessible unfold control and use full waiting label', () => {
  const { f } = waitingWorld(), { view, cx } = viewOf(f); let tree = view.render(cx); const parent = find(view.controller.projection, 't1');
  flatten(tree).find(e => e.attributes.id?.[0] === `fold:${parent.key}`).attributes.on_click[0]({}, cx);
  tree = view.render(cx); assert.equal(rows(view.controller.projection).length, 1); assert.match(textOf(tree), /Waiting on 3 agents/);
  const unfold = flatten(tree).find(e => e.attributes.id?.[0] === `fold:${parent.key}`); assert.match(textOf(unfold), /Show children/);
  unfold.attributes.on_click[0]({}, cx); view.render(cx); assert.equal(rows(view.controller.projection).length, 4); assert.equal(f.calls.length, 0);
});

test('configured private icons always fall back when production containment guarantees are unavailable', () => {
  const { f } = waitingWorld(); const e = f.host.evidence(); const cfg = JSON.parse(settings); cfg.icons = [{ projectId: 'sample', asset: 'sample.svg' }];
  e.settings = JSON.stringify(cfg); f.host.evidence = () => structuredClone(e); const { view, cx } = viewOf(f); const tree = view.render(cx);
  assert.match(textOf(tree), /Sample project/); assert.ok(flatten(tree).some(e => e.attributes.accessibility_label?.[0] === 'Sample project project icon fallback'));
  assert.equal(flatten(tree).some(e => e.attributes.image), false);
});

test('single reviewer and unknown purpose use exact full detail; ended and last done delegates clear waiting', () => {
  for (const [role, expected] of [['reviewer', 'Waiting for Reviewer'], ['unknown', 'Waiting on 1 agent']]) {
    const { f, world } = waitingWorld(); world.doc.assignments = [world.doc.assignments[0]]; world.doc.assignments[0].role = role;
    prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
    const { view, cx } = viewOf(f); view.controller.change({ type: 'view', view: 'status' }); const tree = view.render(cx); assert.match(textOf(tree), new RegExp(expected));
  }
  for (const kind of ['done', 'ended']) {
    const { f, world } = waitingWorld();
    if (kind === 'done') f.values.terminals.slice(1).forEach(t => t.status = 'done');
    else world.doc.assignments.forEach(a => { a.state = 'ended'; a.ended = { reason: 'completed', revision: 1 }; });
    prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
    const c = new Controller(f.host); c.render(); assert.equal(find(c.projection, 't1').row.roster.state, 'idle');
  }
});

test('native timer deadline bounds actual view read and retains native slot', async () => {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  prove(f.host, { admissions: [{ address: 't1', coreId: 'core-a', verified: true, continuity: true, generation: 2,
    producer: JSON.stringify(world.producer), source: 'independent-fixture' }] });
  f.host.readTextFile = () => new Promise(() => {});
  const { view, cx, timers } = viewOf(f); f.host.deadline = p => timerDeadline(cx, p); view.controller.render();
  const pending = view.controller.refresh(); await Promise.resolve(); await Promise.resolve();
  assert.equal(timers.length, 1); timers[0](); await pending; assert.equal(view.controller.reader.outstanding, 1);
  assert.ok(view.controller.feed.reduced.rows.every(r => r.roster.state !== 'waiting'));
});

test('actual view counts theme and props once, focus command is deferred beyond render', async () => {
  const f = fakeHost(), { view, app, cx, stats, tasks } = viewOf(f); let themes = 0, props = 0;
  app.theme = () => { themes++; return { surface: '#111111', text: '#eeeeee' }; }; app.props = () => { props++; return {}; }; let delivered = false; app.nextCommand = () => { if (!delivered) { delivered = true; return Promise.resolve('focus'); } return new Promise(() => {}); };
  view.render(cx); checkCounts(f.counts); assert.equal(themes, 1); assert.equal(props, 1); assert.equal(stats.focus, 0);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); assert.equal(stats.focus, 1); assert.equal(f.calls.length, 0);
});

test('actual view native opt-in and restarted undo share private data across changed props without touching source or Quotr', async () => {
  const f = fakeHost(), app = appOf(f.host), c = context(); let currentName = 'main', props = {};
  const original = { id: 'root', type: 'row', children: [{ id: 'agents', type: 'block', content: { mod: 'agents' } },
    { id: 'quotes', type: 'block', content: { mod: 'quotr', props: { sample: true } } }] };
  const files = new Map([['/sample/app/layouts/main.json', JSON.stringify(original)]]), writes = [];
  app.appHome = () => '/sample/app'; app.shared = key => { assert.equal(key, 'layout'); return currentName; };
  app.layout = () => JSON.parse(files.get(`/sample/app/layouts/${currentName}.json`)); app.props = () => props;
  app.readTextFile = async (path, options) => { assert.deepEqual(options, { on: null }); assert.match(path, /^\/sample\/app\/(layouts|data\/roster)\//); return files.get(path) ?? null; };
  app.writeTextFile = async (path, text, expected) => { assert.equal(files.get(path) ?? null, expected); writes.push(path); files.set(path, text); };
  app.run = (command, args) => { assert.equal(command, 'layout.switch'); currentName = args.name; props = app.layout().children[0].content.props; };
  const Type = createRosterView(kit, app, { host: f.host }); let view = new Type(); view.init({}, c.cx); let tree = view.render(c.cx);
  assert.equal(writes.length, 0); flatten(tree).find(e => e.attributes.id?.[0] === 'layout:select').attributes.on_click[0]({}, c.cx);
  tree = view.render(c.cx); flatten(tree).find(e => e.attributes.id?.[0] === 'layout:enable:agents').attributes.on_click[0]({}, c.cx);
  await c.tasks.at(-1); assert.match(currentName, /^roster-/); assert.equal(app.layout().children[0].content.mod, 'roster');
  const source = files.get('/sample/app/layouts/main.json'); assert.equal(source, JSON.stringify(original)); assert.equal(writes.length, 3);
  const latest = app.layout(); latest.children[1].size = { px: 321 }; files.set(`/sample/app/layouts/${currentName}.json`, JSON.stringify(latest));
  // New instance, new props and a new native adapter; restoration survives both.
  view = new Type(); view.init({}, c.cx); tree = view.render(c.cx);
  flatten(tree).find(e => e.attributes.id?.[0] === 'layout:undo').attributes.on_click[0]({}, c.cx); await c.tasks.at(-1);
  assert.equal(app.layout().children[0].content.mod, 'agents'); assert.deepEqual(app.layout().children[1], latest.children[1]);
  assert.equal(files.get('/sample/app/layouts/main.json'), source); assert.equal(f.calls.length, 0);
});
