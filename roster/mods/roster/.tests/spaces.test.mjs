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
  // The only agent instances in Spaces are the pinned Needs you section, outside this list.
  assert.ok(s.view.controller.projection.instances.every(i => i.pinned));
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
  assert.doesNotMatch(textOf(byId(tree, 'roster-rows')), /Needs you 1/, 'Needs you is no longer a group in the list');
  assert.match(textOf(byId(tree, 'roster-needs-you')), /Needs you 1/);
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
  // Machine headers carry more weight: 30px, a 14px semibold name in the foreground color, 18px icons.
  // The header's own 11px size still applies to +, so +, the dot and the chevron are unchanged.
  for (const [key, head] of [['local', local], ['edge', edge], ['zed', zed]]) {
    assert.equal(head.attributes.h[0], 30); assert.equal(head.attributes.text_size[0], 11); assert.ok(head.attributes.hover);
    const label = byId(head, 'group-label:spaces:machine:' + key);
    // Bold at the Spaces tab's 12px.
    assert.equal(label.attributes.text_size[0], 12); assert.ok(label.attributes.font_bold); assert.equal(label.attributes.text_color[0], '#eeeeee');
    assert.deepEqual(byId(head, 'group-icon:spaces:machine:' + key).attributes.size, [18]);
    assert.deepEqual(byId(head, 'group-chevron:spaces:machine:' + key).attributes.size, [11]);
    assert.deepEqual(byId(head, 'machine-state:spaces:machine:' + key).attributes.size, [6]);
  }
  assert.equal(byId(local, 'machine-add:spaces:machine:local').attributes.text_size, undefined, '+ inherits the 11px header size');
  // Space rows stay compact.
  assert.equal(byId(tree, 'space:s1').attributes.h[0], 30); assert.equal(byId(tree, 'space-name:s1').attributes.text_size[0], 12);
  // A machine that is not connected says so and offers no +.
  assert.deepEqual(childIds(zed), ['group-icon:spaces:machine:zed', 'group-label:spaces:machine:zed', 'machine-note:spaces:machine:zed', 'machine-state:spaces:machine:zed', 'group-chevron:spaces:machine:zed']);
  assert.equal(textOf(byId(zed, 'machine-note:spaces:machine:zed')), 'loading');
  assert.equal(byId(tree, 'group-chevron:spaces:machine:local').attributes.svg[0], 'mods/roster/icons/chevron-down.svg');
});

test('a machine header + opens Open folder as Space for that machine without folding it; nothing is created', () => {
  const s = setup(); let tree = s.render();
  for (const [key, machine] of [['local', null], ['edge', 'edge']]) {
    const stops = s.stats.stop; byId(tree, 'machine-add:spaces:machine:' + key).attributes.on_click[0]({}, s.cx);
    assert.equal(s.stats.stop, stops + 1, 'the header does not also fold');
    assert.equal(s.view.newSpace.machine, machine); assert.deepEqual(s.f.calls, [], 'no Space created on click');
    tree = s.render(); assert.ok(byId(tree, 'space:s1'), 'still open'); assert.ok(byId(tree, 'roster-new-space'));
    s.view.key({ keystroke: 'escape' }, s.cx); tree = s.render(); assert.equal(s.view.newSpace, null);
  }
  // The toolbar + preselects the machine of the shown Space, and belongs to Spaces only.
  byId(tree, 'spaces:new').attributes.on_click[0]({}, s.cx); assert.equal(s.view.newSpace.machine, null, 'Alpha (this computer) is shown');
  assert.equal(byId(tree, 'spaces:new').attributes.accessibility_label[0], 'Open folder as Space');
  s.view.closeNewSpace(s.cx); tree = s.render();
  byId(tree, 'mode:projects').attributes.on_click[0]({}, s.cx); assert.equal(byId(s.render(), 'spaces:new'), undefined);
  assert.deepEqual(s.f.calls, []);
});

test('a connected machine without Spaces offers "New space there", which opens the same dialog', () => {
  const s = setup([sp('s1', 'Alpha', { active: true })]); const tree = s.render();
  const row = byId(tree, 'spaces:new:edge');
  assert.match(textOf(row), /New space there/); assert.equal(row.children[0].attributes.svg[0], 'mods/roster/icons/plus.svg');
  row.attributes.on_click[0]({}, s.cx); assert.equal(s.view.newSpace.machine, 'edge'); assert.deepEqual(s.f.calls, []);
  assert.equal(byId(tree, 'spaces:new:zed'), undefined, 'not for a machine that is still loading');
});

// One header in every view: 30px, an 18px leading icon, a 12px bold title in full contrast
// (folded or not), the tail, and the chevron last (or an empty slot where a group never folds).
const shape = el => el.children.map(e => {
  const id = e.attributes.id?.[0] ?? '';
  if (/^group-icon:/.test(id)) return e.attributes.frames ? 'icon:spinner' : e.attributes.svg ? 'icon:' + e.attributes.svg[0].split('/').pop().replace('.svg', '') : 'icon:initial';
  if (/^group-label:/.test(id)) return 'title';
  if (/^group-count:/.test(id)) return 'count:' + textOf(e);
  if (/^group-chevron:/.test(id)) return e.attributes.svg ? 'chevron' : 'slot';
  if (/^group-space:/.test(id)) return 'space:' + textOf(e);
  return id.split(':')[0];
});
const sameLook = (el, key) => {
  assert.equal(el.attributes.h[0], 30, key);
  const title = el.children.find(e => /^group-label:/.test(e.attributes.id?.[0] ?? ''));
  assert.equal(title.attributes.text_size[0], 12); assert.ok(title.attributes.font_bold); assert.equal(title.attributes.text_color[0], '#eeeeee', key + ' full contrast');
  const lead = el.children[0];
  assert.ok(lead.attributes.size?.[0] === 18 || (lead.attributes.w?.[0] === 18 && lead.attributes.h?.[0] === 18), key + ' 18px icon');
};

test('Status headers: the shared header with a status icon, the count, and the chevron last', () => {
  const f = fakeHost([terminal('t1', 'blocked'), terminal('t2', 'working'), terminal('t3', 'idle'), terminal('t4', 'done'), terminal('t5', 'nonsense')]);
  f.host.run = (command, args) => f.calls.push([command, args]);
  const Type = createRosterView(kit, { ...appOf(f.host), theme: () => ({ surface: '#111111', raised: '#222222', foreground: '#eeeeee', muted: '#777777', dim: '#555555' }) }, { host: f.host, layoutHost: layoutHostUnused, initialView: 'status' });
  const view = new Type(), c = context(); view.init({}, c.cx); const tree = view.render(c.cx);
  const sections = view.controller.projection.instances.filter(i => i.kind === 'section');
  const head = label => byId(tree, sections.find(x => x.label === label).key);
  assert.deepEqual(shape(head('Needs you')), ['icon:bell', 'title', 'count:1', 'slot'], 'never folds: slot keeps the count aligned');
  assert.deepEqual(shape(head('Working')), ['icon:spinner', 'title', 'count:1', 'chevron']);
  assert.deepEqual(shape(head('Done')), ['icon:check-circle', 'title', 'count:1', 'chevron']);
  assert.deepEqual(shape(head('Idle')), ['icon:pause-circle', 'title', 'count:1', 'chevron']);
  assert.deepEqual(shape(head('Unknown')), ['icon:help-circle', 'title', 'count:1', 'chevron']);
  for (const label of ['Needs you', 'Working', 'Done', 'Idle', 'Unknown']) sameLook(head(label), label);
  assert.ok(sections.find(x => x.label === 'Done').collapsed, 'folded groups use the same title weight and contrast');
  assert.equal(f.calls.length, 0);
});

test('Projects and Spaces headers share the same layout; each keeps its own tail', () => {
  const f = fakeHost([terminal('edge/t1', 'blocked', { labels: { 'herdr.role': 'watcher' } }), terminal('edge/t2', 'idle', { labels: { 'herdr.role': 'planner' } }), terminal('t3', 'nonsense')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  f.values.panes = [{ pane: 'edge/p1', terminal: 'edge/t1', tab: 'edge/a' }, { pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/a' }];
  f.values.spaces = [{ id: 'edge/s1', name: 'Sample Mods', machine: 'edge', active: true, tabs: [{ id: 'edge/a', name: '1', named: false }] }];
  f.host.run = (command, args) => f.calls.push([command, args]);
  const Type = createRosterView(kit, { ...appOf(f.host), theme: () => ({ surface: '#111111', raised: '#222222', foreground: '#eeeeee', muted: '#777777', dim: '#555555' }) }, { host: f.host, layoutHost: layoutHostUnused, initialView: 'projects' });
  const view = new Type(), c = context(); view.init({}, c.cx); let tree = view.render(c.cx);
  const key = label => view.controller.projection.instances.find(i => i.kind === 'section' && i.label === label).key;
  assert.deepEqual(shape(byId(tree, key('Needs you'))), ['icon:bell', 'title', 'count:1', 'slot']);
  assert.deepEqual(shape(byId(tree, key('Sample Mods'))), ['icon:initial', 'title', 'space:Space · edge', 'count:2', 'chevron']);
  assert.equal(textOf(byId(tree, 'group-icon:' + key('Sample Mods'))), 'S');
  assert.deepEqual(shape(byId(tree, key('Unidentified'))), ['icon:terminal', 'title', 'count:1', 'chevron']);
  for (const label of ['Needs you', 'Sample Mods', 'Unidentified']) sameLook(byId(tree, key(label)), label);
  // Spaces: the reference header, with its machine tail and no count.
  byId(tree, 'mode:spaces').attributes.on_click[0]({}, c.cx); tree = view.render(c.cx);
  assert.deepEqual(shape(byId(tree, 'spaces:machine:edge')), ['icon:server', 'title', 'machine-add', 'machine-state', 'chevron']);
  sameLook(byId(tree, 'spaces:machine:edge'), 'edge');
  assert.equal(f.calls.length, 0);
});
