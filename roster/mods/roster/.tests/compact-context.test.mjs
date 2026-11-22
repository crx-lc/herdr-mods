import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, fixture, prove, settings, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
function viewOf(f, mode) {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused });
  const view = new Type(), { cx } = context(); view.init({}, cx);
  view.controller.change({ type: 'view', view: mode });
  return { view, cx };
}

for (const mode of ['projects', 'status']) for (const state of ['working', 'blocked']) for (const mapped of [true, false]) {
  test(`drawn ${mode} ${state} child and focus retain parent and ${mapped ? 'known' : 'unknown'} project`, () => {
    const f = fakeHost([
      terminal('t1', 'idle', { labels: { 'herdr.role': 'coordinator' } }),
      terminal('t2', state, { parent: 't1', labels: { 'herdr.role': 'developer', 'herdr.project': 'sample' } }),
    ]);
    prove(f.host, mapped ? { settings } : {});
    const { view, cx } = viewOf(f, mode); view.render(cx);
    const children = view.controller.projection.instances.filter(i => i.kind === 'terminal' && i.row.address === 't2');
    assert.ok(children.length);
    if (state === 'blocked') {
      const p = view.controller.projection;
      const attention = p.instances.findIndex(i => i.kind === 'section' && i.label === 'Needs you');
      assert.equal(p.instances[attention + 1].key, children[0].key, 'check the global row, not only a project copy');
    }
    for (const child of children) {
      view.controller.cursor = child.key;
      const tree = view.render(cx);
      for (const el of [byId(tree, child.key), byId(tree, 'roster-focus-tooltip')]) {
        const drawn = textOf(el);
        assert.match(drawn, /Parent Coordinator/);
        assert.ok(drawn.includes(mapped ? 'Sample project' : 'Unassigned'));
        assert.match(drawn, /Local/);
        assert.match(drawn, /Context unknown/);
        if (!mapped) assert.doesNotMatch(drawn, /Sample project/);
      }
    }
    assert.equal(f.calls.length, 0);
  });
}

for (const mode of ['projects', 'status']) {
  test(`drawn ${mode} unknown identity does not invent project or parent`, () => {
    const f = fakeHost([terminal('t2', 'blocked', { parent: 't9', labels: { 'herdr.project': 'sample' } })]);
    const { view, cx } = viewOf(f, mode); view.render(cx);
    const row = view.controller.projection.instances.find(i => i.kind === 'terminal');
    assert.equal(row.context.parent, null);
    view.controller.cursor = row.key; const tree = view.render(cx);
    for (const el of [byId(tree, row.key), byId(tree, 'roster-focus-tooltip')]) {
      assert.match(textOf(el), /Unassigned/);
      assert.match(textOf(el), /Context unknown/);
      assert.doesNotMatch(textOf(el), /Parent |Sample project/);
    }
    assert.equal(f.calls.length, 0);
  });

  test(`long ${mode} waiting and context cannot share the disabled reason line`, () => {
    const world = fixture(), f = fakeHost([world.producer, ...world.children]);
    prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
    const { view, cx } = viewOf(f, mode);
    // Stress the view with a long display value; production's finite waiting phrases
    // are shorter. Keep the actual verified waiting row and navigation decision.
    const render = view.controller.render.bind(view.controller);
    const waiting = 'Waiting on 3 agents ' + 'with lengthy detail '.repeat(40);
    view.controller.render = () => {
      const p = render();
      for (const i of p.instances) if (i.kind === 'terminal' && i.row.roster.state === 'waiting') i.display.detail = waiting;
      return p;
    };
    view.render(cx);
    const parent = view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === 't1');
    assert.equal(parent.row.roster.state, 'waiting');
    assert.equal(parent.navigation.enabled, false);
    const controlIndex = view.controls.findIndex(c => c.key === parent.key);
    view.controller.cursor = view.controls[controlIndex - 1].key;
    view.key({ keystroke: 'down' }, cx);
    const tree = view.render(cx), footer = byId(tree, 'roster-focus-tooltip');
    assert.equal(view.controller.cursor, parent.key);
    assert.equal(footer.attributes.h[0], 32);
    assert.equal(footer.children.length, 2);
    assert.equal(footer.children[0], byId(tree, 'roster-disabled-reason'));
    assert.equal(textOf(footer.children[0]), 'Open unavailable: current route is unverified');
    assert.equal(footer.children[0].attributes.h[0], 16);
    assert.ok(footer.children[0].attributes.flex_none);
    assert.ok(textOf(footer.children[1]).includes(waiting));
    assert.match(textOf(footer.children[1]), /Sample project.*Context unknown/);
    assert.equal(byId(tree, parent.key).attributes.tooltip[0], waiting);
    // Worst fixed regions: Options, selected disabled row, and a layout message.
    view.toolsOpen = true; view.message = 'Sample layout result';
    const full = view.render(cx), body = byId(full, 'roster-rows');
    const fixed = full.children.filter(e => e !== body).reduce((n, e) => n + (e.attributes.h?.[0] ?? e.attributes.max_h?.[0] ?? 350), 0);
    const available = 350 - 2 * full.attributes.p[0] - (full.children.length - 1) * full.attributes.gap[0] - fixed;
    assert.ok(available >= 2 * 38 + 24 + 2 * 3, `only ${available}px for rows`);
    assert.equal(f.calls.length, 0);
  });
}
