// #30 and #25 in the drawn sidebar (fake GPUI kit, fake host, fake gh): registered project headers, fallbacks, status
// icons, totals, the inline issue list, keyboard and pointer. Fixture evidence, not a native run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { CatalogSource } from '../catalog-source.js';
import { GitHubData } from '../github.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';
import { entry, catalogText, catalogHost, clock, settle, pilotFixture, fakeGh } from './projects-fixtures.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z'), DAY = 86400000;
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const issue = (number, daysAgo, title = 'Sample issue ' + number) => ({ number, title, createdAt: new Date(NOW - daysAgo * DAY).toISOString().replace(/\.\d+Z$/, 'Z') });
// The contract's pilot (an icon and a palette) on this computer; the same project on edge, idle there, with its site.
const PILOT = pilotFixture();
const edgePilot = entry('pilot', { primary: 'crx-lc/pilot-app', board: PILOT.board, mode: 'manual', displayName: 'Herdr Pilot',
  repositories: [{ name: 'crx-lc/pilot-app', role: 'app', primary: true, checkout: 'bound' }, { name: 'crx-lc/pilot-site', role: 'site', primary: false, checkout: 'bound' }] });
const notes = entry('notes', { primary: 'sample-org/notes', mode: 'manual', displayName: 'Notes' });

function world({ catalog = { local: catalogText(null, [PILOT, notes]), edge: catalogText('edge', [edgePilot]) }, repos = {}, ghOptions = {}, terminals = null } = {}) {
  const f = fakeHost(terminals ?? [
    terminal('t1', 'working', { created_ms: 101, labels: { 'herdr.role': 'developer', 'herdr.project': 'pilot' } }),
    terminal('edge/t2', 'idle', { created_ms: 102, labels: { 'herdr.role': 'reviewer', 'herdr.project': 'pilot' } }),
    terminal('t3', 'working', { created_ms: 103, labels: { 'herdr.role': 'developer' } }),
    terminal('edge/t4', 'idle', { created_ms: 104, labels: { 'herdr.role': 'planner' } }),
    terminal('t5', 'idle', { created_ms: 105, labels: { 'herdr.role': 'planner', 'herdr.project': 'Pilot' } })]);
  const addresses = f.values.terminals.map(t => t.address);
  f.values.panes = addresses.map(a => ({ pane: a.replace(/t(\w+)$/, 'p$1'), terminal: a, tab: a.startsWith('edge/') ? 'edge/tab' : 'tab' }));
  // Two Spaces with the same name, one per machine.
  f.values.spaces = [{ id: 'sp-a', name: 'Work', machine: null, tabs: [{ id: 'tab', name: '1', named: false }] },
    { id: 'edge/sp-b', name: 'Work', machine: 'edge', tabs: [{ id: 'edge/tab', name: '1', named: false }] }];
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  const t = clock(NOW); f.host.now = () => t.now;
  const { host } = catalogHost({ answers: catalog, machines: [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }], now: () => t.now });
  const catalogSource = new CatalogSource(host);
  const gh = fakeGh(repos, { boardOwner: 'crx-lc', ...ghOptions });
  const github = new GitHubData({ exec: gh.exec, now: () => t.now, load: async () => null, save: async () => {} });
  const projectIcons = { lookup: icon => icon?.sha256 ?? null, ensure() {}, takeChanged: () => false };
  return { f, t, gh, catalogSource, github, projectIcons };
}
async function setup(w, { narrow = false, storage = null } = {}) {
  const Type = createRosterView(kit, appOf(w.f.host), { host: w.f.host, layoutHost: layoutHostUnused, initialView: 'projects', collapseUnassigned: false,
    catalogSource: w.catalogSource, github: w.github, projectIcons: w.projectIcons, storage });
  const view = new Type(), c = context(); view.init({}, c.cx);
  // Panels ask for data with the host timer; here it is the test's clock.
  c.cx.timer.after = (ms, fn) => w.t.after(ms, fn);
  if (narrow) view.measureList({ height: 200, width: 240 }, c.cx);
  const poll = async () => { view.pollProjects(c.cx, w.t.after); await settle(); view.pollProjects(c.cx, w.t.after); };
  await poll();
  return { ...w, view, ...c, poll, render: () => view.render(c.cx) };
}
const sections = view => view.controller.projection.instances.filter(i => i.kind === 'section' && !i.pinned);
const registered = (view, id) => sections(view).find(i => i.registered?.id === id);
const rowsIn = (view, section) => view.controller.projection.instances.filter(i => i.kind === 'terminal' && !i.pinned && i.key.startsWith(section.key.slice(0, -1) + ','));
const press = (s, keystroke) => s.view.key({ keystroke }, s.cx);

test('#30: registered projects by stable ID first (idle too), one group across repositories and Cores; fallbacks subordinate, duplicate Space names apart', async () => {
  const s = await setup(world()); const tree = s.render();
  const list = sections(s.view).filter(i => i.depth === 0);
  assert.deepEqual(list.map(i => [i.label, !!i.registered, !!i.subordinate]),
    [['Herdr Pilot', true, false], ['Notes', true, false], ['Work', false, true], ['Work', false, true]]);
  // One Pilot group holds the local and the remote session; each keeps its machine.
  const pilot = registered(s.view, 'pilot');
  assert.deepEqual(rowsIn(s.view, pilot).map(i => i.row.address).sort(), ['edge/t2', 't1']);
  const remote = rowsIn(s.view, pilot).find(i => i.row.address === 'edge/t2');
  assert.match(textOf(byId(tree, 'row-machine:' + remote.key)), /edge/);
  // A label that only looks like the token, and sessions without one, stay in their Space groups, which never merge by name.
  const spaces = list.filter(i => i.space);
  assert.deepEqual(spaces.map(i => [i.space.machine, rowsIn(s.view, i).map(r => r.row.address).sort()]), [[null, ['t3', 't5']], ['edge', ['edge/t4']]]);
  // The idle project is listed with no sessions; its header says idle.
  const idle = registered(s.view, 'notes');
  assert.equal(rowsIn(s.view, idle).length, 0);
  assert.match(s.view.controls.find(c => c.key === idle.key).label, /^Project Notes, idle,/);
  // Fallbacks read as secondary under a caption; registered titles keep the full header style.
  assert.equal(textOf(byId(tree, 'fallback-caption')), 'Not in a registered project');
  assert.equal(byId(tree, 'group-label:' + spaces[0].key).attributes.font_bold, undefined);
  assert.ok(byId(tree, 'group-label:' + pilot.key).attributes.font_bold);
  // The catalog icon (a verified cached file) on the palette's background; Notes has the neutral monogram.
  assert.equal(byId(tree, 'project-icon:' + pilot.key).attributes.image[0], 'mods/roster/.cache/icons/' + PILOT.presentation.icon.sha256 + '.svg');
  assert.equal(byId(tree, 'group-icon:' + pilot.key).attributes.bg[0], PILOT.presentation.palette.light.background);
  assert.equal(textOf(byId(tree, 'project-monogram:' + idle.key)), 'N');
  assert.deepEqual(s.f.calls, []);
});

test('#30: primary repository and board in Details, not the header; a manual project without a board is valid', async () => {
  const s = await setup(world()); let tree = s.render();
  const pilot = registered(s.view, 'pilot'), notesGroup = registered(s.view, 'notes');
  assert.doesNotMatch(textOf(byId(tree, pilot.key)), /crx-lc|projects\/7/, 'the header stays compact');
  s.view.controls.find(c => c.key === 'project-info:' + pilot.key).activate(s.cx); tree = s.render();
  const panel = textOf(byId(tree, 'roster-project'));
  assert.match(panel, /Primary: crx-lc\/pilot-app/); assert.match(panel, /site: crx-lc\/pilot-site/); assert.match(panel, /docs: crx-lc\/pilot-docs/);
  assert.match(panel, /Board: crx-lc #7/); assert.match(panel, /This computer.*watcher · Space Pilot/s); assert.match(panel, /edge.*manual/s);
  const board = s.view.controls.find(c => c.key === 'project:board');
  const opened = []; board.activate({ ...s.cx, open_url: url => opened.push(url) });
  assert.deepEqual(opened, ['https://github.com/orgs/crx-lc/projects/7']);
  s.view.controls.find(c => c.key === 'project-info:' + notesGroup.key).activate(s.cx); tree = s.render();
  assert.match(textOf(byId(tree, 'roster-project')), /No board \(a manual project\)/);
  assert.equal(byId(tree, 'roster-project') && s.view.panel.anchor, JSON.stringify(['project', notesGroup.registered.key, 'details']), 'one panel at a time');
});

test('#30: an unavailable catalog in a narrow sidebar: one truncated, focusable notice, Spaces groups as before', async () => {
  const s = await setup(world({ catalog: { local: Error('EIO'), edge: Error('EIO') } }), { narrow: true }); const tree = s.render();
  const notice = byId(tree, 'catalog:notice');
  assert.equal(textOf(byId(tree, 'catalog-notice-text')), 'Project catalog unavailable · showing Spaces');
  assert.ok(byId(tree, 'catalog-notice-text').attributes.truncate, 'truncated, never wrapped over the list');
  assert.equal(notice.attributes.h[0], 20);
  const control = s.view.controls.find(c => c.key === 'catalog:notice');
  assert.match(control.label, /This computer: read failed\nedge: read failed/, 'every machine\'s state in its label');
  assert.deepEqual(sections(s.view).filter(i => i.depth === 0).map(i => [i.label, !!i.registered, !!i.subordinate]), [['Work', false, false], ['Work', false, false]]);
  assert.equal(byId(tree, 'fallback-caption'), undefined);
  // Keyboard reaches it first in the list, before the groups.
  s.view.place('mode:status'); press(s, 'down'); press(s, 'down');
  assert.equal(s.view.controller.cursor, 'catalog:notice');
});

test('#30: keyboard and pointer keep folds, the exact session and the pinned section', async () => {
  const w = world(); w.f.values.terminals.push(terminal('t9', 'blocked', { created_ms: 109, labels: { 'herdr.role': 'developer', 'herdr.project': 'pilot' } }));
  w.f.values.panes.push({ pane: 'p9', terminal: 't9', tab: 'tab' });
  const s = await setup(w); let tree = s.render();
  const pilot = registered(s.view, 'pilot'), notesGroup = registered(s.view, 'notes');
  // The pinned Needs you section is unchanged, and its session is echoed in its project with the bell.
  assert.ok(byId(tree, 'roster-needs-you'));
  const echo = rowsIn(s.view, pilot).find(i => i.row.address === 't9');
  assert.ok(echo.echo); assert.equal(flatten(byId(tree, 'row-status:' + echo.key)).find(e => e.attributes.svg).attributes.svg[0], 'mods/roster/icons/bell.svg');
  // Fold Notes, then Down from the Pilot header: issues, PRs, ⓘ, then its rows.
  s.view.controls.find(c => c.key === notesGroup.key).activate(s.cx); tree = s.render();
  assert.equal(registered(s.view, 'notes').collapsed, true);
  s.view.place(pilot.key); press(s, 'down');
  assert.equal(s.view.controller.cursor, 'project-issues:' + pilot.key); press(s, 'down');
  assert.equal(s.view.controller.cursor, 'project-prs:' + pilot.key); press(s, 'down');
  assert.equal(s.view.controller.cursor, 'project-info:' + pilot.key);
  // Enter opens the PR drill-through below the header; Esc closes it and returns to the trigger. Folds stay.
  s.view.place('project-prs:' + pilot.key); press(s, 'enter'); tree = s.render();
  assert.equal(s.view.projectPanel.tab, 'prs');
  assert.ok(flatten(byId(tree, 'inline:' + pilot.key)).includes(byId(tree, 'roster-project')), 'directly below its header');
  press(s, 'escape'); tree = s.render();
  assert.equal(s.view.projectPanel, null); assert.equal(s.view.controller.cursor, 'project-prs:' + pilot.key);
  assert.equal(registered(s.view, 'notes').collapsed, true, 'folds survive the panel');
  // Pointer: the issues total toggles its panel.
  const click = id => byId(s.render(), id).attributes.on_click[0]({}, s.cx);
  click('project-issues:' + pilot.key); assert.equal(s.view.projectPanel.tab, 'issues');
  click('project-issues:' + pilot.key); assert.equal(s.view.projectPanel, null);
  // A row in the project still opens its exact pane.
  const local = rowsIn(s.view, registered(s.view, 'pilot')).find(i => i.row.address === 't1');
  click(local.key);
  assert.deepEqual(s.f.calls, [['pane.focus', { pane: 'p1' }]]);
});

test('#30: a new Needs you pulses its echo icon once with the bell; a refresh never replays it; motion off keeps it still', async () => {
  const w = world(); const s = await setup(w);
  const every = []; s.cx.timer.every = (ms, fn) => every.push(fn);
  s.render(); s.view.watchArrivals(s.cx);
  w.f.values.terminals[0] = { ...w.f.values.terminals[0], status: 'blocked' };
  s.render(); s.cx.timer.after = () => {}; s.view.watchArrivals(s.cx);
  const pilot = registered(s.view, 'pilot');
  const echo = rowsIn(s.view, pilot).find(i => i.row.address === 't1');
  const glyph = () => flatten(byId(s.render(), 'row-status:' + echo.key)).find(e => e.attributes.svg);
  assert.equal(glyph().attributes.loop[0], 'opacity');
  s.view.watchArrivals(s.cx); s.render();
  w.t.now += 2500; assert.equal(glyph().attributes.loop, undefined, 'one short pulse, then still');
  s.view.watchArrivals(s.cx); assert.equal(glyph().attributes.loop, undefined, 'no replay on refresh');
  // Motion reduced in Options: the same arrival draws a still bell, and a Working row's icon does not turn.
  const r = await setup(world(), { storage: { getItem: () => 'reduce', setItem() {} } });
  r.render(); r.view.watchArrivals(r.cx);
  r.f.values.terminals[0] = { ...r.f.values.terminals[0], status: 'blocked' };
  r.render(); r.view.watchArrivals(r.cx);
  const still = rowsIn(r.view, registered(r.view, 'pilot')).find(i => i.row.address === 't1');
  const tree = r.render();
  assert.equal(flatten(byId(tree, 'row-status:' + still.key)).find(e => e.attributes.svg).attributes.loop, undefined);
  assert.deepEqual(flatten(byId(tree, 'roster-rows')).filter(e => e.attributes.spin || e.attributes.loop), []);
});

test('#25: two labeled totals on each registered row, idle and across Cores; partial with one inaccessible repository', async () => {
  const repos = { 'crx-lc/pilot-app': { issues: 7, prs: 3 }, 'crx-lc/pilot-docs': { issues: 2, prs: 1 }, 'sample-org/notes': { issues: 0, prs: 0 } };
  const s = await setup(world({ repos, ghOptions: { modes: { 'crx-lc/pilot-site': 'refuse' } } }));
  await s.poll(); const tree = s.render();
  const pilot = registered(s.view, 'pilot'), notesGroup = registered(s.view, 'notes');
  assert.equal(s.gh.calls.filter(c => c.kind === 'counts').length, 4, 'four distinct repositories across both Cores, each once');
  assert.equal(textOf(byId(tree, 'project-issues:' + pilot.key)), '≥9 issues');
  assert.equal(textOf(byId(tree, 'project-prs:' + pilot.key)), '≥4 PRs');
  assert.match(s.view.controls.find(c => c.key === 'project-issues:' + pilot.key).label, /unavailable: crx-lc\/pilot-site \(not found or access refused\)/);
  assert.equal(textOf(byId(tree, 'project-issues:' + notesGroup.key)), '0 issues', 'an idle, empty project is a confirmed zero');
  assert.equal(textOf(byId(tree, 'project-prs:' + notesGroup.key)), '0 PRs');
});

test('#25: the issue list opens inline by keyboard and pointer, oldest first across repositories, with status filters, age and exact date', async () => {
  const repos = { 'crx-lc/pilot-app': { issues: 3, prs: 1, list: [issue(3, 12, 'Fix the header'), issue(8, 2, 'Off the board')], board: { 3: 'Ready' } },
    'crx-lc/pilot-docs': { issues: 1, prs: 0, list: [issue(4, 30, 'Write the guide')], board: { 4: null } },
    'crx-lc/pilot-site': { issues: 1, prs: 0, list: [issue(2, 20, 'Site banner')], board: { 2: 'In Progress' } } };
  const s = await setup(world({ repos }));
  await s.poll(); s.render();
  const pilot = registered(s.view, 'pilot');
  s.view.place('project-issues:' + pilot.key); press(s, 'enter'); await settle(); let tree = s.render();
  const panel = byId(tree, 'roster-project');
  assert.ok(flatten(byId(tree, 'inline:' + pilot.key)).includes(panel), 'below its own header; the project list stays');
  assert.ok(byId(tree, 'project-prs:' + pilot.key), 'the PR total keeps its own drill-through');
  const items = s.view.controls.filter(c => c.key.startsWith('project:issue:'));
  assert.deepEqual(items.map(c => c.key), ['project:issue:crx-lc/pilot-docs#4', 'project:issue:crx-lc/pilot-site#2', 'project:issue:crx-lc/pilot-app#3', 'project:issue:crx-lc/pilot-app#8']);
  assert.match(items[2].label, /^crx-lc\/pilot-app#3 Fix the header · Ready · opened 12 days ago · Opened 2026-11-13 12:00 UTC$/);
  assert.equal(byId(tree, 'project:issue:crx-lc/pilot-app#3').attributes.tooltip[0].split('\n')[0], 'Opened 2026-11-13 12:00 UTC', 'exact date on hover');
  // Keyboard focus on an item shows its exact date in the footer.
  s.view.place('project:issue:crx-lc/pilot-app#3'); tree = s.render();
  assert.match(textOf(byId(tree, 'roster-focus-tooltip')), /Opened 2026-11-13 12:00 UTC/);
  // Filters: the board's statuses and No board status (status-less and off-board), never Backlog by default.
  assert.deepEqual(s.view.controls.filter(c => c.key.startsWith('project:filter:')).map(c => c.key.slice(15)),
    ['all', 'status:Backlog', 'status:Ready', 'status:In Progress', 'status:Done', 'none']);
  s.view.controls.find(c => c.key === 'project:filter:none').activate(s.cx); s.render();
  assert.deepEqual(s.view.controls.filter(c => c.key.startsWith('project:issue:')).map(c => c.key.slice(14)), ['crx-lc/pilot-docs#4', 'crx-lc/pilot-app#8']);
  // An item opens the GitHub page built from its repository and number.
  const opened = []; s.view.controls.find(c => c.key === 'project:issue:crx-lc/pilot-app#8').activate({ ...s.cx, open_url: url => opened.push(url) });
  assert.deepEqual(opened, ['https://github.com/crx-lc/pilot-app/issues/8']);
  // Closing #8 removes it and updates the total after refresh.
  repos['crx-lc/pilot-app'] = { ...repos['crx-lc/pilot-app'], issues: 2, list: [issue(3, 12, 'Fix the header')] };
  s.t.now += 300000; await s.poll(); tree = s.render();
  assert.deepEqual(s.view.controls.filter(c => c.key.startsWith('project:issue:')).map(c => c.key.slice(14)), ['crx-lc/pilot-docs#4']);
  assert.equal(textOf(byId(tree, 'project-issues:' + pilot.key)), '4 issues');
});

test('#25: inaccessible board data is said, by repository; the list is never read as complete or as Backlog', async () => {
  const repos = { 'crx-lc/pilot-app': { list: [issue(3, 12)] }, 'crx-lc/pilot-docs': { list: [issue(4, 30)] }, 'crx-lc/pilot-site': { list: [] } };
  const s = await setup(world({ repos, ghOptions: { modes: { board: 'scope' } } }));
  s.render(); const pilot = registered(s.view, 'pilot');
  s.view.controls.find(c => c.key === 'project-issues:' + pilot.key).activate(s.cx); await settle(); const tree = s.render();
  const text = textOf(byId(tree, 'roster-project'));
  assert.match(text, /crx-lc\/pilot-app: board status unknown \(the gh login lacks a needed scope\)/);
  // Backlog stays only a filter of the board's own statuses (0 here); no issue is put there.
  for (const item of s.view.controls.filter(c => c.key.startsWith('project:issue:'))) assert.match(item.label, / · status unknown · /, 'never Backlog');
  assert.match(text, /Backlog 0/); assert.match(text, /Status unknown 2/);
});
