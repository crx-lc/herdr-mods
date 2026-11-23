import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { Controller } from '../controller.js';
import { desktopHost } from '../desktop.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const tab = (id, machine = null) => ({ machine, tabs: [{ id, name: '1', named: false }] });
// A stock-shaped desktop: local pane focus declared, every run recorded and limited to pane.focus {pane}.
function desk(terminals, panes, spaces = [tab('tab-a')]) {
  const f = fakeHost(terminals);
  f.values.panes = panes; f.values.spaces = spaces; f.host.localPaneFocus = true;
  f.host.run = (command, args) => { f.calls.push([command, args]); };
  return f;
}
function setup(f) {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c, render: () => view.render(c.cx) };
}
const item = (view, address) => view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === address);
const clickRow = (s, tree, i) => byId(tree, i.key).attributes.on_click[0]({}, s.cx);

test('a verified local pane is navigable and a click focuses exactly that pane', () => {
  const f = desk([terminal('t1'), terminal('edge/t2')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }]);
  const s = setup(f); let tree = s.render(); const i = item(s.view, 't1');
  assert.equal(i.navigation.enabled, true);
  assert.deepEqual(i.navigation.target, { scope: 'local-pane', coreId: null, terminalId: 't1', associationKey: null, incarnation: 100, address: 't1', pane: 'p1', action: 'focus' });
  const row = byId(tree, i.key);
  assert.ok(row.attributes.cursor_pointer); assert.equal(row.attributes.cursor_default, undefined);
  assert.equal(byId(row, 'row-name:' + i.key).attributes.text_color[0], '#eeeeee');
  assert.equal(row.attributes.tooltip[0], 't1 · Working');
  clickRow(s, tree, i);
  assert.deepEqual(f.calls, [['pane.focus', { pane: 'p1' }]]);
  // Keyboard Enter is the same guarded activation.
  tree = s.render(); s.view.controller.cursor = i.key; s.view.key({ keystroke: 'enter' }, s.cx);
  assert.deepEqual(f.calls, [['pane.focus', { pane: 'p1' }], ['pane.focus', { pane: 'p1' }]]);
});

const cases = [
  ['remote terminal', () => desk([terminal('edge/t2')], [{ pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/tab-b' }], [tab('edge/tab-b', 'edge')]), 'edge/t2', 'remote-pane-unsupported', 'only panes on this computer'],
  ['no pane', () => desk([terminal('t1')], []), 't1', 'no-pane', 'no pane shows this terminal'],
  ['two panes', () => desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }, { pane: 'p2', terminal: 't1', tab: 'tab-a' }]), 't1', 'multiple-panes', 'more than one pane'],
  ['pane in a tab not on this computer', () => desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-x' }]), 't1', 'pane-tab-unverified', 'not in a tab on this computer'],
  ['pane in a remote space', () => desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }], [tab('tab-a', 'edge')]), 't1', 'pane-tab-unverified', 'not in a tab on this computer'],
  ['local layout loading', () => { const f = desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }]); f.values.machines[0].layout = 'loading'; return f; }, 't1', 'not-current-live', 'stale or absent'],
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
    assert.equal(byId(row, 'row-name:' + i.key).attributes.text_color[0], '#eeeeee', 'theme has no muted color: falls back to fg');
    assert.ok(row.attributes.tooltip[0].replace(/\n/g, ' ').includes(text), row.attributes.tooltip[0]);
    clickRow(s, tree, i);
    assert.ok(textOf(byId(s.render(), 'roster-message')).includes(text));
  }
  assert.deepEqual(f.calls, []);
});

test('a muted theme color marks non-navigable names', () => {
  const f = desk([terminal('t1'), terminal('t2')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }]);
  const app = { ...appOf(f.host), theme: () => ({ surface: '#111111', raised: '#222222', foreground: '#eeeeee', muted: '#777777' }) };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); const tree = view.render(c.cx);
  assert.equal(byId(tree, 'row-name:' + item(view, 't1').key).attributes.text_color[0], '#eeeeee');
  assert.equal(byId(tree, 'row-name:' + item(view, 't2').key).attributes.text_color[0], '#777777');
});

test('the target is confirmed at click time: a moved pane or a restarted terminal is not focused', () => {
  for (const change of [
    f => { f.values.panes = [{ pane: 'p9', terminal: 't1', tab: 'tab-a' }]; },
    f => { f.values.terminals = [terminal('t1', 'working', { created_ms: 500 })]; },
    f => { f.values.panes = []; },
    f => { f.values.spaces = [tab('tab-b')]; f.values.panes = [{ pane: 'p1', terminal: 't1', tab: 'tab-b' }]; }]) {
    const f = desk([terminal('t1')], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }]), s = setup(f);
    const tree = s.render(), i = item(s.view, 't1'); assert.equal(i.navigation.enabled, true);
    change(f); clickRow(s, tree, i);
    assert.deepEqual(f.calls, []);
    assert.match(textOf(byId(s.render(), 'roster-message')), /Not opened|Open unavailable/);
  }
});

test('a successful click clears an earlier refusal; Info and fold clicks never focus', () => {
  const f = desk([terminal('t1'), terminal('t2', 'working', { parent: 't1', created_ms: 200 })], [{ pane: 'p1', terminal: 't1', tab: 'tab-a' }]);
  const s = setup(f); let tree = s.render();
  clickRow(s, tree, item(s.view, 't2')); tree = s.render();
  assert.match(textOf(byId(tree, 'roster-message')), /no pane shows this terminal/);
  const parent = item(s.view, 't1');
  byId(tree, 'info:' + parent.key).attributes.on_click[0]({}, s.cx); assert.equal(s.view.reader.sourceKey, parent.key);
  s.view.key({ keystroke: 'escape' }, s.cx); tree = s.render();
  assert.deepEqual(f.calls, []);
  clickRow(s, tree, item(s.view, 't1')); tree = s.render();
  assert.deepEqual(f.calls, [['pane.focus', { pane: 'p1' }]]);
  assert.equal(byId(tree, 'roster-message'), undefined);
});

test('names, titles and tab names never pick a pane', () => {
  const f = desk([terminal('t1', 'working', { name: 'shared-name' }), terminal('t3', 'working', { name: 'shared-name' })],
    [{ pane: 'p1', terminal: 't1', tab: 'tab-a', title: 'shared-name', name: 'shared-name' }],
    [{ machine: null, tabs: [{ id: 'tab-a', name: 'shared-name', named: true }] }]);
  const s = setup(f); s.render();
  assert.equal(item(s.view, 't1').navigation.target.pane, 'p1');
  assert.equal(item(s.view, 't3').navigation.reason, 'no-pane');
});

test('stock desktop adapter declares local pane focus; injected hosts keep the verified-route contract', () => {
  const f = fakeHost([terminal('t1')]);
  assert.equal(new Controller(desktopHost(appOf(f.host), p => p)).localPaneFocus, true);
  const plain = new Controller(f.host, expanded); const p = plain.render();
  assert.equal(p.instances.find(i => i.kind === 'terminal').navigation.reason, 'unverified-identity');
});

test('local pane facts fail closed on an unready layout, an inconsistent pane list or remote ids', async () => {
  const { localPanes } = await import('../feed.js');
  const live = { address: 't1', state: 'live', created_ms: 100 };
  assert.equal(localPanes({ machines: [{ name: null, layout: 'loading' }], panes: [], spaces: [], terminals: [live] }, 1).unavailable, 'local-layout-not-ready');
  assert.equal(localPanes({ machines: [], panes: [], spaces: [], terminals: [live] }, 1).unavailable, 'local-layout-not-ready');
  assert.equal(localPanes({ machines: [{ name: null, layout: 'ready' }], spaces: [tab('a')], terminals: [live],
    panes: [{ pane: 'p1', terminal: 't1', tab: 'a' }, { pane: 'p1', terminal: null, tab: 'a' }] }, 1).unavailable, 'pane-model-invalid');
  const ok = localPanes({ machines: [{ name: null, layout: 'ready' }], spaces: [tab('a')], terminals: [live, { address: 'edge/t1', state: 'live', created_ms: 1 }],
    panes: [{ pane: 'p1', terminal: 't1', tab: 'a' }, { pane: 'edge/p1', terminal: 'edge/t1', tab: 'edge/a' }] }, 7);
  assert.deepEqual(ok, { generation: 7, unavailable: null, byAddress: { t1: { pane: 'p1', tab: 'a', incarnation: 100, generation: 7 } } });
});
