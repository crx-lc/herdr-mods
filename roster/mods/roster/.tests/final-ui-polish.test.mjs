import test from 'node:test';
import assert from 'node:assert/strict';
import { detailFields } from '../detail.js';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
function setup() {
  const f = fakeHost([terminal('t1', 'blocked', { name: 'Sample' }), terminal('t2', 'blocked', { name: 'Sample' })]);
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx);
  const render = () => view.render(c.cx), key = k => view.key({ keystroke: k }, c.cx);
  const click = (tree, id) => byId(tree, id).attributes.on_click[0]({}, c.cx);
  render(); return { ...c, f, view, render, key, click };
}
for (const id of ['mode:status', 'mode:projects', 'tools:toggle']) test('reader toolbar preserves clicked cursor and highlight: ' + id, () => {
  for (const pending of [false, true]) {
    const s = setup(), origin = s.view.controller.projection.instances.find(i => i.row?.address === 't2');
    s.view.controller.cursor = origin.key; s.render(); s.key('d');
    const tree = s.render();
    // Esc resolves the return at once (in the event); the toolbar click then moves on from there.
    if (pending) { s.key('escape'); assert.equal(s.view.reader, null); assert.equal(s.view.controller.cursor, origin.key); }
    s.click(tree, id); s.key('enter'); // no stale action before render
    const result = s.render();
    assert.equal(s.view.reader, null);
    assert.equal(s.view.controller.cursor, id);
    assert.equal(byId(result, id).attributes.bg[0], appOf(s.f.host).theme().raised);
    assert.equal(s.view.controller.state.view, id === 'mode:status' ? 'status' : 'projects');
    assert.equal(s.view.toolsOpen, id === 'tools:toggle');
    assert.equal(s.f.calls.length, 0); assert.equal(s.stats.focus, 1, 'only clicked sidebar control requests focus');
  }
});
test('Back/Esc keep exact duplicate instance; a later state change never drags the cursor back', () => {
  const s = setup(), rows = s.view.controller.projection.instances.filter(i => i.row?.address === 't2');
  for (const origin of rows) for (const close of ['escape', 'back']) {
    let tree = s.render(); s.click(tree, 'info:' + origin.key); tree = s.render();
    s.f.values.terminals.splice(1, 1); s.render(); // disappear then reappear before return
    s.f.values.terminals.push(terminal('t2', 'blocked', { name: 'Sample' })); s.render();
    const scrolls = s.view.rowScroll.requests.length;
    if (close === 'escape') s.key('escape'); else s.click(tree, 'details:close');
    s.render();
    assert.equal(s.view.controller.cursor, 'info:' + origin.key);
    assert.equal(s.view.rowScroll.requests.length, scrolls, 'closing the modal never scrolls the list');
    // Enter on that ⓘ reopens the same row's details, never a terminal action.
    s.key('enter'); assert.equal(s.view.reader.sourceKey, origin.key); s.key('escape'); s.render();
  }
  s.view.controller.cursor = rows[0].key; s.key('d'); s.render();
  s.key('escape'); assert.equal(s.view.controller.cursor, rows[0].key);
  s.view.controller.change({ type: 'view', view: 'status' }); s.render();
  assert.equal(s.view.controller.cursor, rows[0].key, 'render leaves the cursor alone');
  assert.equal(s.view.reader, null); assert.equal(s.f.calls.length, 0);
});
test('compact row shows a bounded machine name and no unknown context; full diagnostic stays in Details/hover', () => {
  const s = setup();
  for (const mode of ['projects', 'status']) for (const alias of ['', 'edge', 'route'.repeat(200)]) {
    s.view.controller.change({ type: 'view', view: mode });
    const original = s.view.controller.render.bind(s.view.controller);
    s.view.controller.render = () => {
      const p = original(); for (const i of p.instances) if (i.row) { i.row.core.alias = alias; i.row.executionContext.label = ''; } return p;
    };
    const tree = s.render(), i = s.view.controller.projection.instances.find(i => i.row);
    const row = byId(tree, i.key);
    assert.equal(row.attributes.h[0], 24);
    const machine = byId(row, 'row-machine:' + i.key);
    assert.equal(textOf(machine), alias || 'This computer');
    assert.deepEqual(machine.attributes.max_w, [84]); assert.deepEqual(machine.attributes.min_w, [0]); assert.ok(machine.attributes.truncate);
    assert.equal(byId(row, 'row-execution-context:' + i.key), undefined, 'unknown context is not drawn');
    assert.doesNotMatch(textOf(row), /Context unknown|Route|host unknown/);
    assert.match(row.attributes.accessibility_label[0], /host unknown.*identity unverified/);
    assert.match(detailFields(i).find(f => f.id === 'machine').value, /host unknown.*identity unverified/);
    assert.equal(detailFields(i).find(f => f.id === 'provider').value, 'Unknown');
    s.view.controller.render = original;
  }
  assert.equal(s.f.calls.length, 0);
});
