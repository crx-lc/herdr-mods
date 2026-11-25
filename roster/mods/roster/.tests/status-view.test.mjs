import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, fixture, prove, settings, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const chips = el => flatten(el).filter(e => e.attributes.max_w?.[0] === 104).map(textOf);
function setup(f, app = {}) {
  const Type = createRosterView(kit, { ...appOf(f.host), ...app }, { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c, render: () => view.render(c.cx) };
}
const rowsOf = view => view.controller.projection.instances.filter(i => i.kind === 'terminal');
// Anything that moves: a frames spinner, a turning icon, or a looping property.
const spinners = tree => flatten(tree).filter(e => e.attributes.frames || e.attributes.spin || e.attributes.loop);
const mixed = () => fakeHost([terminal('t1', 'working'), terminal('t2', 'idle'), terminal('t3', 'done'), terminal('t4', 'blocked'), terminal('t5', 'error')]);

test('Status drops chips that repeat their group header; Projects shows a status icon instead of every chip (#30)', () => {
  const f = mixed(), s = setup(f);
  let tree = s.render();
  // Projects: no text chip on any row; each listed row ends in one status icon from the Status tab's vocabulary.
  for (const i of rowsOf(s.view)) assert.deepEqual(chips(byId(tree, i.key)), [], i.row.address);
  const icons = Object.fromEntries(rowsOf(s.view).filter(i => !i.pinned).map(i => [i.row.address, byId(tree, 'row-status:' + i.key)]));
  const svgOf = el => flatten(el).find(e => e.attributes.svg)?.attributes.svg[0].split('/').pop();
  assert.deepEqual(Object.fromEntries(Object.entries(icons).map(([a, el]) => [a, svgOf(el)])),
    { t1: 'working.svg', t2: 'pause-circle.svg', t3: 'check-circle.svg', t4: 'bell.svg', t5: 'help-circle.svg' });
  // The full status on hover and as the accessible label; the echo names where the alert is.
  assert.equal(icons.t2.attributes.tooltip[0], 'Idle'); assert.equal(icons.t2.attributes.accessibility_label[0], 'Status: Idle');
  assert.equal(icons.t5.attributes.tooltip[0], 'Error');
  assert.match(icons.t4.attributes.accessibility_label[0], /Needs you: listed in Needs you above/);
  // The pinned row carries no status icon: the pinned header already says Needs you.
  const pinned = rowsOf(s.view).find(i => i.pinned);
  assert.equal(byId(tree, 'row-status:' + pinned.key), undefined);
  // Only the Working row's icon turns: no header spinner in Projects, and nothing else moves.
  assert.deepEqual(spinners(tree), [flatten(icons.t1).find(e => e.attributes.spin)], 'only the Working row icon turns');
  // Distinct from the leading runtime icon, which stays first on the row.
  const row = byId(tree, rowsOf(s.view).find(i => i.row.address === 't1').key);
  assert.ok(row.children.findIndex(e => e.attributes?.id?.[0]?.startsWith('row-kind:')) < row.children.findIndex(e => e.attributes?.id?.[0]?.startsWith('row-status:')));
  s.view.controller.change({ type: 'view', view: 'status' }); s.render();
  // Done starts folded; open every group so each state is drawn.
  for (const section of s.view.controller.projection.instances.filter(i => i.kind === 'section' && i.collapsed))
    s.view.controller.change({ type: 'fold', key: section.key, collapsed: false });
  tree = s.render();
  assert.deepEqual(rowsOf(s.view).map(i => i.row.address).sort(), ['t1', 't2', 't3', 't4', 't5'], 'Needs you rows appear once, in Needs you');
  for (const i of rowsOf(s.view)) {
    const list = chips(byId(tree, i.key));
    if (i.row.address === 't5') assert.deepEqual(list, ['Error'], 'a chip that adds information stays');
    else assert.deepEqual(list, [], i.row.address + ' repeats ' + i.status);
  }
  // The full state is still in hover and the accessibility label.
  const done = rowsOf(s.view).find(i => i.row.address === 't3');
  assert.match(byId(tree, done.key).attributes.tooltip[0], /t3 · Done/);
  assert.equal(f.calls.length, 0);
});

test('one native turning ring marks the Working header in Status, in the working color, and only there', () => {
  const f = mixed(), s = setup(f, { theme: () => ({ ...appOf(f.host).theme(), working: '#33aa55' }) });
  s.view.controller.change({ type: 'view', view: 'status' }); let tree = s.render();
  const found = spinners(tree);
  assert.equal(found.length, 1);
  assert.equal(found[0].attributes.svg[0], 'mods/roster/icons/working.svg'); assert.equal(found[0].attributes.spin[0], 1200);
  assert.equal(found[0].attributes.text_color[0], '#33aa55');
  const working = s.view.controller.projection.instances.find(i => i.kind === 'section' && i.label === 'Working');
  assert.ok(flatten(byId(tree, working.key)).includes(found[0]), 'inside the Working header');
  assert.equal(found[0].attributes.on_click, undefined);
  assert.ok(!s.view.controls.some(c => c.key === 'roster-working-indicator'), 'decoration, not a control');
  // Folding Working keeps the header and its indicator; no Working rows means no header.
  s.view.controller.change({ type: 'fold', key: working.key, collapsed: true }); tree = s.render();
  assert.equal(spinners(tree).length, 1);
  const idle = setup(fakeHost([terminal('t2', 'idle')])); idle.view.controller.change({ type: 'view', view: 'status' });
  assert.equal(spinners(idle.render()).length, 0);
});

test('waiting for a delegate stays in Working with a compact marker; direct work has none', () => {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
  const s = setup(f); s.view.controller.change({ type: 'view', view: 'status' }); const tree = s.render();
  const sections = s.view.controller.projection.instances;
  const parent = rowsOf(s.view).find(i => i.row.address === 't1');
  assert.equal(parent.row.roster.state, 'waiting');
  const header = sections.slice(0, sections.indexOf(parent)).reverse().find(i => i.kind === 'section');
  assert.equal(header.label, 'Working');
  const marker = byId(tree, 'row-waiting:' + parent.key);
  assert.equal(textOf(marker), '◈ Waiting'); assert.equal(marker.attributes.accessibility_label[0], 'Waiting for delegate');
  assert.doesNotMatch(textOf(byId(tree, parent.key)), /Waiting on 3 agents/);
  assert.match(byId(tree, parent.key).attributes.tooltip[0].replace(/\n/g, ' '), /Waiting on 3 agents/);
  for (const child of rowsOf(s.view).filter(i => i.row.address !== 't1')) {
    assert.deepEqual(chips(byId(tree, child.key)), [], child.row.address);
    assert.equal(byId(tree, 'row-waiting:' + child.key), undefined);
  }
});
