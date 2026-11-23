import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { Controller } from '../controller.js';
import { desktopHost } from '../desktop.js';
import { nativeTargets } from '../feed.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const space = (machine, ...tabs) => ({ machine, tabs: tabs.map(id => ({ id, name: '1', named: false })) });
// A stock-shaped desktop: native navigation declared; every command recorded.
function desk(terminals, panes, spaces = [space(null, 'tab-a'), space('edge', 'edge/tab-b')]) {
  const f = fakeHost(terminals);
  f.values.panes = panes; f.values.spaces = spaces; f.host.nativeNavigation = true;
  f.host.run = (command, args) => { f.calls.push([command, args]); };
  return f;
}
function setup(f, theme) {
  const app = theme ? { ...appOf(f.host), theme: () => theme } : appOf(f.host);
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c, render: () => view.render(c.cx) };
}
const item = (view, address) => view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === address);
const clickRow = (s, tree, i) => byId(tree, i.key).attributes.on_click[0]({}, s.cx);
const both = () => desk([terminal('t1'), terminal('edge/t2')],
  [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/tab-b' }]);

test('local and remote panes both navigate natively to their exact pane', () => {
  const f = both(), s = setup(f); let tree = s.render();
  for (const [address, pane] of [['t1', 'p1'], ['edge/t2', 'edge/p2']]) {
    const i = item(s.view, address);
    assert.equal(i.navigation.enabled, true, address);
    assert.equal(i.navigation.target.pane, pane); assert.equal(i.navigation.target.action, 'focus');
    const row = byId(tree, i.key);
    assert.ok(row.attributes.cursor_pointer); assert.equal(byId(row, 'row-name:' + i.key).attributes.text_color[0], '#eeeeee');
    clickRow(s, tree, i); tree = s.render();
  }
  assert.deepEqual(f.calls, [['pane.focus', { pane: 'p1' }], ['pane.focus', { pane: 'edge/p2' }]]);
  // Keyboard Enter is the same guarded activation.
  s.view.place(item(s.view, 'edge/t2').key); s.view.key({ keystroke: 'enter' }, s.cx);
  assert.deepEqual(f.calls.at(-1), ['pane.focus', { pane: 'edge/p2' }]);
});

test('a live terminal without a pane peeks, as the stock sidebar does', () => {
  const f = desk([terminal('t1'), terminal('edge/t2')], []), s = setup(f); const tree = s.render();
  for (const address of ['t1', 'edge/t2']) {
    const i = item(s.view, address); assert.equal(i.navigation.target.action, 'peek'); clickRow(s, tree, i);
  }
  assert.deepEqual(f.calls, [['terminal.peek', { terminal: 't1' }], ['terminal.peek', { terminal: 'edge/t2' }]]);
});

const cases = [
  ['two panes', () => desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p2', terminal: 't1', tab: 'tab-a' }]), 't1', 'multiple-panes', 'more than one pane'],
  ['local pane in a tab no Space lists', () => desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-x' }]), 't1', 'pane-tab-unverified', 'not in a tab on its own machine'],
  ['local pane in a remote Space', () => desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }], [space('edge', 'tab-a')]), 't1', 'pane-tab-unverified', 'not in a tab on its own machine'],
  ['remote pane in a local Space', () => desk([terminal('edge/t2')], [{ pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/tab-b' }], [space(null, 'edge/tab-b')]), 'edge/t2', 'pane-tab-unverified', 'not in a tab on its own machine'],
  ['remote pane without its machine prefix', () => desk([terminal('edge/t2')], [{ pane: 'p2', terminal: 'edge/t2', tab: 'edge/tab-b' }]), 'edge/t2', 'pane-tab-unverified', 'not in a tab on its own machine'],
  ['remote pane under another machine prefix', () => desk([terminal('edge/t2')], [{ pane: 'other/p2', terminal: 'edge/t2', tab: 'edge/tab-b' }]), 'edge/t2', 'pane-tab-unverified', 'not in a tab on its own machine'],
  ['remote machine loading', () => { const f = both(); f.values.machines[1].layout = 'loading'; return f; }, 'edge/t2', 'not-current-live', 'stale or absent'],
  ['duplicate pane ids', () => desk([terminal('t1'), terminal('t3')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p1', terminal: 't3', tab: 'tab-a' }]), 't1', 'pane-model-invalid', 'pane list is inconsistent'],
  ['two terminals at one address', () => desk([terminal('t1'), terminal('t1', 'working', { created_ms: 300 })], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }]), 't1', 'ambiguous', 'more than one terminal'],
];
for (const [name, make, address, reason, text] of cases) test(`not navigable, visibly and with a reason: ${name}`, () => {
  const f = make(), s = setup(f); const tree = s.render();
  const shown = s.view.controller.projection.instances.filter(i => i.kind === 'terminal' && i.row.address === address);
  assert.ok(shown.length);
  for (const i of shown) {
    assert.equal(i.navigation.enabled, false); assert.match(i.navigation.reason, new RegExp(reason));
    const row = byId(tree, i.key);
    assert.ok(row.attributes.cursor_default); assert.equal(row.attributes.cursor_pointer, undefined);
    assert.ok(row.attributes.tooltip[0].replace(/\n/g, ' ').includes(text), row.attributes.tooltip[0]);
    clickRow(s, tree, i);
    assert.ok(textOf(byId(s.render(), 'roster-message')).includes(text));
  }
  assert.deepEqual(f.calls, []);
});

test('a muted theme color marks non-navigable names', () => {
  const f = desk([terminal('t1'), terminal('t2')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p2', terminal: 't2', tab: 'tab-a' }, { pane: 'p3', terminal: 't2', tab: 'tab-a' }]);
  const s = setup(f, { surface: '#111111', raised: '#222222', foreground: '#eeeeee', muted: '#777777' }); const tree = s.render();
  assert.equal(byId(tree, 'row-name:' + item(s.view, 't1').key).attributes.text_color[0], '#eeeeee');
  assert.equal(byId(tree, 'row-name:' + item(s.view, 't2').key).attributes.text_color[0], '#777777');
});

test('the target is confirmed at click time: a moved, removed or restarted target is not used', () => {
  for (const change of [
    f => { f.values.panes = [{ pane: 'edge/p9', terminal: 'edge/t2', tab: 'edge/tab-b' }]; },
    f => { f.values.terminals = [terminal('edge/t2', 'working', { created_ms: 500 })]; },
    f => { f.values.panes = []; }, // now pane-less: a peek is not the pane that was drawn
    f => { f.values.spaces = [space('edge', 'edge/tab-c')]; f.values.panes = [{ pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/tab-c' }]; }]) {
    const f = desk([terminal('edge/t2')], [{ pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/tab-b' }]), s = setup(f);
    const tree = s.render(), i = item(s.view, 'edge/t2'); assert.equal(i.navigation.enabled, true);
    change(f); clickRow(s, tree, i);
    assert.deepEqual(f.calls, []);
    assert.match(textOf(byId(s.render(), 'roster-message')), /Not opened|Open unavailable/);
  }
});

test('a successful click clears an earlier refusal; Info and fold clicks never navigate', () => {
  const f = desk([terminal('t1'), terminal('t2', 'working', { parent: 't1', created_ms: 200 })],
    [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p2', terminal: 't2', tab: 'tab-a' }, { pane: 'p3', terminal: 't2', tab: 'tab-a' }]);
  const s = setup(f); let tree = s.render();
  clickRow(s, tree, item(s.view, 't2')); tree = s.render();
  assert.match(textOf(byId(tree, 'roster-message')), /more than one pane/);
  const parent = item(s.view, 't1');
  // Group fold headers are their own controls too.
  const group = s.view.controller.projection.instances.find(i => i.kind === 'section');
  byId(tree, group.key).attributes.on_click[0]({}, s.cx); tree = s.render();
  byId(tree, group.key).attributes.on_click[0]({}, s.cx); tree = s.render();
  byId(tree, 'info:' + parent.key).attributes.on_click[0]({}, s.cx); assert.equal(s.view.reader.sourceKey, parent.key);
  s.view.key({ keystroke: 'escape' }, s.cx); tree = s.render();
  assert.deepEqual(f.calls, []);
  clickRow(s, tree, item(s.view, 't1')); tree = s.render();
  assert.deepEqual(f.calls, [['pane.focus', { pane: 'p1' }]]);
  assert.equal(byId(tree, 'roster-message'), undefined);
});

test('names, titles, tab names and aliases never pick a pane', () => {
  const f = desk([terminal('t1', 'working', { name: 'shared-name' }), terminal('t3', 'working', { name: 'shared-name' }), terminal('edge/t1', 'working', { name: 'shared-name' })],
    [{ pane: 'p1', terminal: 't1', tab: 'tab-a', title: 'shared-name', name: 'shared-name' }],
    [{ machine: null, tabs: [{ id: 'tab-a', name: 'shared-name', named: true }] }, space('edge')]);
  const s = setup(f); s.render();
  assert.equal(item(s.view, 't1').navigation.target.pane, 'p1');
  // Same name elsewhere and the same terminal id on another machine: no pane, so a peek of that exact address.
  assert.deepEqual([item(s.view, 't3').navigation.target.action, item(s.view, 't3').navigation.target.address], ['peek', 't3']);
  assert.deepEqual([item(s.view, 'edge/t1').navigation.target.action, item(s.view, 'edge/t1').navigation.target.address], ['peek', 'edge/t1']);
});

test('stock desktop adapter navigates natively; injected hosts keep the verified-route contract', () => {
  const f = fakeHost([terminal('t1')]);
  assert.equal(new Controller(desktopHost(appOf(f.host), p => p)).nativeNavigation, true);
  const plain = new Controller(f.host, expanded); const p = plain.render();
  assert.equal(p.instances.find(i => i.kind === 'terminal').navigation.reason, 'unverified-identity');
});

test('native targets fail closed per machine and on an inconsistent pane list', () => {
  const live = (address, created_ms = 100) => ({ address, state: 'live', created_ms });
  const machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'loading' }];
  const spaces = [space(null, 'a'), space('edge', 'edge/b')];
  const ok = nativeTargets({ machines, spaces, terminals: [live('t1'), live('edge/t1', 1)],
    panes: [{ pane: 'p1', terminal: 't1', tab: 'a' }, { pane: 'edge/p1', terminal: 'edge/t1', tab: 'edge/b' }] }, 7);
  assert.deepEqual(ok, { generation: 7, unavailable: null, byAddress: {
    t1: { presentation: 'pane', pane: 'p1', tab: 'a', incarnation: 100, generation: 7 }, 'edge/t1': { reason: 'machine-not-ready' } } });
  assert.equal(nativeTargets({ machines, spaces, terminals: [live('t1')],
    panes: [{ pane: 'p1', terminal: 't1', tab: 'a' }, { pane: 'p1', terminal: null, tab: 'a' }] }, 1).unavailable, 'pane-model-invalid');
  assert.deepEqual(nativeTargets({ machines: [], spaces, terminals: [live('t1')], panes: [] }, 1).byAddress, { t1: { reason: 'machine-not-ready' } });
});

test('rows tint on hover and the focused terminal is marked, as in the stock list', () => {
  const f = both(); f.values.focused = { space: 's', tab: 'edge/tab-b', pane: 'edge/p2', terminal: 'edge/t2' };
  const s = setup(f, { surface: '#111111', raised: '#222222', foreground: '#eeeeee', hover: '#333333', selected: '#444444' });
  const tree = s.render(), remote = byId(tree, item(s.view, 'edge/t2').key), local = byId(tree, item(s.view, 't1').key);
  assert.equal(remote.attributes.bg[0], '#222222'); assert.equal(local.attributes.bg[0], '#111111');
  for (const row of [remote, local]) {
    const probe = { bg(color) { this.color = color; return this; } };
    row.attributes.hover[0](probe); assert.equal(probe.color, '#333333');
  }
  s.view.place(item(s.view, 'edge/t2').key);
  assert.equal(byId(s.render(), item(s.view, 'edge/t2').key).attributes.bg[0], '#444444', 'the keyboard cursor wins');
});
