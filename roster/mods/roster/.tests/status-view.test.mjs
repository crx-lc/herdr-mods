import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView, WORKING_FRAMES } from '../view.js';
import { fakeHost, terminal, fixture, prove, settings, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const chips = el => flatten(el).filter(e => e.attributes.max_w?.[0] === 104).map(textOf);
function setup(f) {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c, render: () => view.render(c.cx) };
}
const rowsOf = view => view.controller.projection.instances.filter(i => i.kind === 'terminal');
const spinners = tree => flatten(tree).filter(e => e.attributes.frames);
const mixed = () => fakeHost([terminal('t1', 'working'), terminal('t2', 'idle'), terminal('t3', 'done'), terminal('t4', 'blocked'), terminal('t5', 'error')]);

test('Status drops chips that repeat their group header; Projects keeps every chip', () => {
  const f = mixed(), s = setup(f);
  let tree = s.render();
  const projects = Object.fromEntries(rowsOf(s.view).map(i => [i.row.address + ':' + i.key.includes('attention'), chips(byId(tree, i.key))]));
  // Every row keeps its chip, except the blocked terminal: its pinned row sits under the Needs
  // you header (no repeat), and its group copy is a muted "in Needs you" echo.
  for (const [key, list] of Object.entries(projects)) assert.equal(list.length, key.startsWith('t4:') ? 0 : 1, key);
  const echo = rowsOf(s.view).find(i => i.row.address === 't4' && !i.key.includes('attention'));
  assert.equal(textOf(byId(tree, 'row-echo:' + echo.key)), 'in Needs you');
  assert.equal(spinners(tree).length, 0, 'Projects has no Working header spinner');
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

test('one native spinner marks the Working header in Status, and only there', () => {
  const f = mixed(), s = setup(f);
  s.view.controller.change({ type: 'view', view: 'status' }); let tree = s.render();
  const found = spinners(tree);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].attributes.frames, [WORKING_FRAMES, 80]);
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
