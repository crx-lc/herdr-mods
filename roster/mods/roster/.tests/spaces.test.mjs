import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { spaceRows, branchTail, spaceFill, SPACE_MARKS } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const sp = (id, name, extra = {}) => ({ id, name, machine: null, active: false, branch: null, status: null, tabs: [], ...extra });
// Herdr's order is the model's order; remote Space ids carry their machine prefix.
const sample = () => [sp('s1', 'Alpha', { active: true, branch: 'main' }), sp('s2', 'beta', { branch: 'feature-x' }),
  sp('edge/s3', 'Gamma', { machine: 'edge', branch: 'gamma' }), sp('s4', 'Delta'), sp('zed/s5', 'Epsilon', { machine: 'zed' }),
  sp('edge/s6', 'Zeta', { machine: 'edge' })];
const machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }, { name: 'zed', layout: 'loading' }];

test('rows follow Herdr: this computer first, remote machines by name, Spaces in model order', () => {
  const rows = spaceRows({ spaces: sample(), machines });
  assert.deepEqual(rows.map(r => r.kind === 'machine' ? '# ' + r.label : r.name),
    ['# This computer', 'Alpha', 'beta', 'Delta', '# edge', 'Gamma', 'Zeta', '# zed', 'Epsilon']);
  assert.deepEqual(rows.filter(r => r.kind === 'machine').map(r => [r.ready, r.loading, r.count]), [[true, false, 3], [true, false, 2], [false, true, 1]]);
  // One machine only: no headers, as in the stock list.
  assert.deepEqual(spaceRows({ spaces: [sp('s1', 'Alpha'), sp('s2', 'beta')], machines: [{ name: null, layout: 'ready' }] }).map(r => r.kind), ['space', 'space']);
  // Machine headers sort by name even when the model lists a later machine first.
  const reversed = spaceRows({ spaces: [sp('zed/s5', 'Epsilon', { machine: 'zed' }), sp('edge/s3', 'Gamma', { machine: 'edge' })], machines: [] });
  assert.deepEqual(reversed.filter(r => r.kind === 'machine').map(r => r.label), ['This computer', 'edge', 'zed']);
  // A remote machine with no Spaces still gets its header.
  assert.ok(spaceRows({ spaces: [sp('s1', 'Alpha')], machines }).some(r => r.kind === 'machine' && r.label === 'edge' && r.count === 0));
});

test('avatar, active, branch tail and folds use Herdr data only', () => {
  const rows = spaceRows({ spaces: sample(), machines }, { colors: { s1: 'ansi3', s2: '#123456', s4: 'not a color!', 'edge/s3': 'ansi4' },
    folds: { 'spaces:machine:edge': true } });
  const by = Object.fromEntries(rows.filter(r => r.kind === 'space').map(r => [r.id, r]));
  assert.deepEqual([by.s1.color, by.s2.color, by.s4.color], ['ansi3', '#123456', 'ansi6']);
  assert.equal(by['edge/s3'], undefined, 'folded machine hides its Spaces');
  assert.equal(rows.find(r => r.label === 'edge').collapsed, true);
  assert.deepEqual([by.s1.initial, by.s2.initial, by.s1.active, by.s2.active], ['A', 'B', true, false]);
  assert.equal(spaceFill('ansi3'), SPACE_MARKS.ansi3); assert.equal(spaceFill('#123456'), '#123456'); assert.equal(spaceFill('accent', { accent: '#abcdef' }), '#abcdef');
  for (const [branch, name, expected] of [['main', 'x', ''], ['master', 'x', ''], ['Gamma', 'gamma', ''], ['feature-x', 'beta', 'feature-x'], [null, 'x', ''], ['  ', 'x', '']])
    assert.equal(branchTail({ branch, name }), expected, String(branch));
  // Duplicates and ids that are not text are dropped, never merged by name.
  const odd = spaceRows({ spaces: [sp('s1', 'Same'), sp('s1', 'Same'), sp('s2', 'Same'), { id: 3, name: 'x' }, null], machines: [] });
  assert.deepEqual(odd.map(r => r.id), ['s1', 's2']);
});

function setup(spaces = sample(), theme) {
  const f = fakeHost([terminal('t1', 'blocked'), terminal('edge/t2', 'working')]);
  f.values.spaces = spaces; f.values.machines = machines;
  f.host.run = (command, args) => f.calls.push([command, args]);
  const app = { ...appOf(f.host), shared: key => (key === 'space.colors' ? { s1: 'ansi3' } : undefined), ...(theme ? { theme: () => theme } : {}) };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused });
  const view = new Type(), c = context(); view.init({}, c.cx);
  return { f, view, ...c, render: () => view.render(c.cx) };
}

test('Spaces is the first tab and the start view; it lists Spaces, not agents', () => {
  const s = setup(), tree = s.render();
  assert.deepEqual(byId(tree, 'roster-toolbar').children.flatMap(e => e.attributes.id ?? []), ['mode:spaces', 'mode:projects', 'mode:status', 'spaces:new', 'tools:toggle']);
  assert.equal(s.view.controller.state.view, 'spaces');
  const rows = byId(tree, 'roster-rows');
  assert.match(textOf(rows), /This computer.*Alpha.*beta.*Delta.*edge.*Gamma.*Zeta.*zed.*Epsilon/);
  assert.doesNotMatch(textOf(rows), /Needs you|t1|Working/);
  assert.equal(s.view.controller.projection.instances.length, 0);
  assert.equal(s.f.calls.length, 0);
});

test('a Space looks like the stock row: colored initial, active selection, hover tint, branch only when unusual', () => {
  const theme = { surface: '#111111', raised: '#222222', foreground: '#eeeeee', hover: '#333333', selected: '#444444', muted: '#777777' };
  const s = setup(undefined, theme), tree = s.render();
  const alpha = byId(tree, 'space:s1'), beta = byId(tree, 'space:s2');
  assert.equal(byId(tree, 'space-avatar:s1').attributes.bg[0], SPACE_MARKS.ansi3);
  assert.equal(byId(tree, 'space-avatar:s2').attributes.bg[0], SPACE_MARKS.ansi6);
  assert.equal(textOf(byId(tree, 'space-avatar:s2')), 'B');
  assert.equal(alpha.attributes.bg.at(-1), '#444444'); assert.equal(alpha.attributes.hover, undefined);
  const probe = { bg(color) { this.color = color; return this; } }; beta.attributes.hover[0](probe); assert.equal(probe.color, '#333333');
  assert.equal(byId(tree, 'space-branch:s1'), undefined, 'main is not shown');
  assert.equal(textOf(byId(tree, 'space-branch:s2')), 'feature-x');
  assert.equal(byId(tree, 'space-branch:edge/s3'), undefined, 'a branch named like the Space is not shown');
  assert.deepEqual(byId(tree, 'machine-state:spaces:machine:zed').attributes.size, [6]);
});

test('click or Enter selects the Space natively; a machine header folds its Spaces', () => {
  const s = setup(); let tree = s.render();
  byId(tree, 'space:edge/s3').attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls, [['space.select', { id: 'edge/s3' }]]);
  tree = s.render(); s.view.key({ keystroke: 'down' }, s.cx); s.render(); s.view.key({ keystroke: 'enter' }, s.cx);
  assert.deepEqual(s.f.calls.at(-1), ['space.select', { id: 'edge/s6' }]);
  tree = s.render(); byId(tree, 'spaces:machine:edge').attributes.on_click[0]({}, s.cx); tree = s.render();
  assert.equal(byId(tree, 'space:edge/s3'), undefined); assert.equal(textOf(byId(tree, 'spaces:machine:edge')).replace(/\s+/g, ' ').trim(), 'edge + ▸');
  assert.ok(byId(tree, 'space:s1'), 'other machines keep their Spaces');
  assert.deepEqual(s.f.calls.map(c => c[0]), ['space.select', 'space.select'], 'folding sends nothing to Herdr');
});

test('Spaces follows Herdr live: a new active Space or a removed one redraws without state changes', () => {
  const s = setup(); s.render();
  const spaces = sample(); spaces[0].active = false; spaces[3].active = true; s.f.values.spaces = spaces.filter(x => x.id !== 's2');
  const notifies = s.stats.notify, tree = s.render();
  assert.equal(byId(tree, 'space:s2'), undefined);
  assert.equal(byId(tree, 'space:s4').attributes.bg.at(-1), appOf(s.f.host).theme().raised);
  assert.equal(s.stats.notify, notifies);
});

test('switching to Projects shows agents again, with Needs you', () => {
  const s = setup(); let tree = s.render();
  byId(tree, 'mode:projects').attributes.on_click[0]({}, s.cx); tree = s.render();
  assert.match(textOf(byId(tree, 'roster-rows')), /Needs you/);
  assert.equal(s.f.calls.length, 0);
});

const childIds = el => el.children.map(e => e.attributes.id?.[0] ?? (e.attributes.svg ? 'svg:' + e.attributes.svg[0].split('/').pop() : textOf(e)));

test('machine headers follow the stock order: icon, name, then +, the connection dot and the chevron last', () => {
  const s = setup(); let tree = s.render();
  const local = byId(tree, 'spaces:machine:local'), edge = byId(tree, 'spaces:machine:edge'), zed = byId(tree, 'spaces:machine:zed');
  assert.deepEqual(childIds(local), ['group-icon:spaces:machine:local', 'group-label:spaces:machine:local', 'machine-add:spaces:machine:local', 'machine-state:spaces:machine:local', 'group-chevron:spaces:machine:local']);
  assert.equal(byId(local, 'group-icon:spaces:machine:local').attributes.svg[0], 'mods/roster/icons/monitor.svg');
  assert.equal(byId(edge, 'group-icon:spaces:machine:edge').attributes.svg[0], 'mods/roster/icons/server.svg');
  assert.equal(textOf(byId(local, 'group-label:spaces:machine:local')), 'This computer');
  for (const head of [local, edge]) { assert.equal(head.attributes.h[0], 26); assert.equal(head.attributes.text_size[0], 11); assert.ok(head.attributes.hover); }
  // A machine that is not connected says so and offers no +.
  assert.deepEqual(childIds(zed), ['group-icon:spaces:machine:zed', 'group-label:spaces:machine:zed', 'machine-note:spaces:machine:zed', 'machine-state:spaces:machine:zed', 'group-chevron:spaces:machine:zed']);
  assert.equal(textOf(byId(zed, 'machine-note:spaces:machine:zed')), 'loading');
  assert.equal(byId(tree, 'group-chevron:spaces:machine:local').attributes.svg[0], 'mods/roster/icons/chevron-down.svg');
});

test('a machine header + creates a Space on that machine without folding it; the toolbar + creates one where Herdr chooses', () => {
  const s = setup(); let tree = s.render();
  for (const [key, machine] of [['local', ''], ['edge', 'edge']]) {
    const stops = s.stats.stop; byId(tree, 'machine-add:spaces:machine:' + key).attributes.on_click[0]({}, s.cx);
    assert.equal(s.stats.stop, stops + 1, 'the header does not also fold');
    assert.deepEqual(s.f.calls.at(-1), ['space.new', { machine }]);
    tree = s.render(); assert.ok(byId(tree, 'space:s1'), 'still open');
  }
  byId(tree, 'spaces:new').attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls.at(-1), ['space.new', undefined]);
  assert.equal(byId(tree, 'spaces:new').attributes.accessibility_label[0], 'New space');
  // The toolbar + belongs to Spaces only.
  byId(tree, 'mode:projects').attributes.on_click[0]({}, s.cx); assert.equal(byId(s.render(), 'spaces:new'), undefined);
});

test('a connected machine without Spaces offers "New space there", as the stock list does', () => {
  const s = setup([sp('s1', 'Alpha', { active: true })]); const tree = s.render();
  const row = byId(tree, 'spaces:new:edge');
  assert.match(textOf(row), /New space there/); assert.equal(row.children[0].attributes.svg[0], 'mods/roster/icons/plus.svg');
  row.attributes.on_click[0]({}, s.cx); assert.deepEqual(s.f.calls.at(-1), ['space.new', { machine: 'edge' }]);
  assert.equal(byId(tree, 'spaces:new:zed'), undefined, 'not for a machine that is still loading');
});

test('agent group headers use the same style: chevron last, spinner before it, none on Needs you', () => {
  const f = fakeHost([terminal('t1', 'blocked'), terminal('t2', 'working'), terminal('t3', 'idle')]);
  f.host.run = (command, args) => f.calls.push([command, args]);
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, initialView: 'status' });
  const view = new Type(), c = context(); view.init({}, c.cx); const tree = view.render(c.cx);
  const sections = view.controller.projection.instances.filter(i => i.kind === 'section');
  const head = label => byId(tree, sections.find(x => x.label === label).key);
  const needs = head('Needs you'), working = head('Working');
  assert.equal(needs.children.some(e => e.attributes.svg), false);
  assert.deepEqual(working.children.map(e => e.attributes.frames ? 'spinner' : e.attributes.svg ? e.attributes.svg[0].split('/').pop() : 'label'),
    ['label', 'spinner', 'chevron-down.svg']);
  for (const h of [needs, working]) { assert.equal(h.attributes.h[0], 26); assert.equal(h.attributes.text_size[0], 11); }
  assert.equal(f.calls.length, 0);
});
