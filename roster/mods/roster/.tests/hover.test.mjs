import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { hoverText, wrapText, HOVER_WIDTH, HOVER_LINE_CAP } from '../detail.js';
import { fakeHost, terminal, fixture, prove, settings, route, kit, context, appOf, flatten, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const points = s => Array.from(s).length;
function setup(f) {
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); return { view, ...c };
}
const instance = (displayLabel, enabled = false, reason = 'unverified-identity') =>
  ({ row: { displayLabel }, navigation: { enabled, reason } });

test('hover is name and status, plus a short reason only when opening is unavailable', () => {
  assert.equal(hoverText(instance('Planner #12'), 'Done'), 'Planner #12 · Done\nOpen unavailable: terminal identity is\nunverified');
  assert.equal(hoverText(instance('Planner #12', true), 'Working'), 'Planner #12 · Working');
  assert.equal(hoverText(instance('t9', false, 'outside-current-filters'), 'Idle'), 't9 · Idle\nOutside current filters');
});

test('hover wraps at spaces, splits only overlong words and caps each logical line', () => {
  const wrapped = wrapText('one two three four five six seven eight nine ten eleven twelve thirteen');
  assert.ok(wrapped.split('\n').every(line => points(line) <= HOVER_WIDTH));
  assert.equal(wrapped.replace(/\n/g, ' '), 'one two three four five six seven eight nine ten eleven twelve thirteen');
  assert.deepEqual(wrapText('x'.repeat(95)).split('\n').map(points), [40, 40, 15]);
  assert.equal(wrapText('  spaced \t out\n text '), 'spaced out text');
  const long = hoverText(instance('名'.repeat(200)), 'Waiting on 3 agents ' + 'with detail '.repeat(40));
  const lines = long.split('\n');
  assert.ok(lines.every(line => points(line) <= HOVER_WIDTH));
  // Two capped logical lines: at most ceil(80/40) lines for the name/status and two for the reason.
  assert.ok(lines.length <= Math.ceil(HOVER_LINE_CAP / HOVER_WIDTH) + 2, `${lines.length} lines`);
  assert.ok(long.includes('…'));
});

test('drawn row and footer hover stay compact; Info and the accessibility label keep every fact', () => {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
  const s = setup(f);
  let tree = s.view.render(s.cx);
  const rows = s.view.controller.projection.instances.filter(i => i.kind === 'terminal');
  assert.ok(rows.length >= 4);
  for (const i of rows) {
    const element = byId(tree, i.key), hover = element.attributes.tooltip[0];
    assert.ok(hover.startsWith(i.row.displayLabel + ' · '), hover);
    assert.ok(hover.split('\n').every(line => points(line) <= HOVER_WIDTH));
    assert.doesNotMatch(hover, /Project:|Parent:|Context unknown|Machine \/ route|Execution context/);
    for (const fact of ['Project: Sample project', 'Machine / route:', 'Execution context:']) assert.ok(element.attributes.accessibility_label[0].includes(fact), fact);
    s.view.controller.cursor = i.key; tree = s.view.render(s.cx);
    const footer = byId(tree, 'roster-focus-tooltip');
    assert.equal(footer.attributes.tooltip[0], hover);
    assert.ok(footer.attributes.accessibility_label[0].includes('Project: Sample project'));
  }
  const parent = rows.find(i => i.row.roster.state === 'waiting');
  assert.match(byId(tree, parent.key).attributes.tooltip[0].replace(/\n/g, ' '), /Waiting on 3 agents/);
  assert.equal(f.calls.length, 0);
});

test('an openable row has no reason line in its hover', () => {
  const f = fakeHost(); prove(f.host, { routes: [route('core-a', 't1', 't1')] });
  const s = setup(f), tree = s.view.render(s.cx);
  const i = s.view.controller.projection.instances.find(x => x.kind === 'terminal');
  assert.ok(i.navigation.enabled);
  assert.equal(byId(tree, i.key).attributes.tooltip[0], i.row.displayLabel + ' · Working');
});
