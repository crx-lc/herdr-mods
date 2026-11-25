import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { programOf, terminalKind } from '../runtime.js';
import { reducedMotion, Arrivals } from '../motion.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

// Herdr's program records as terminals() reports them (neutral sample values).
const P = {
  claude: { key: 'claude', name: 'Claude Code', icon: 'icons/claude.svg', tint: false, shell: false, agent: true },
  codex: { key: 'codex', name: 'Codex', icon: 'icons/codex.svg', tint: false, shell: false, agent: true },
  antigravity: { key: 'antigravity', name: 'Antigravity', icon: 'icons/antigravity.svg', tint: false, shell: false, agent: true },
  bash: { key: 'shell', name: 'bash', icon: 'icons/shell.svg', tint: true, shell: true, agent: false },
  powershell: { key: 'shell', name: 'powershell.exe', icon: 'icons/shell.svg', tint: true, shell: true, agent: false },
  zsh: { key: 'shell', name: 'zsh', icon: 'icons/shell.svg', tint: true, shell: true, agent: false },
  watcher: { key: 'herdr-watcher', name: 'Watcher', icon: 'icons/git.svg', tint: true, shell: false, agent: true },
  unlisted: { key: 'program', name: 'mytool', icon: 'icons/program.svg', tint: true, shell: false, agent: false },
};

test('runtime icons come only from Herdr\'s program record; shells get Roster\'s own color icons', () => {
  const kind = p => { const k = terminalKind(programOf(p)); return [k.source, k.name, k.color, k.label]; };
  assert.deepEqual(kind(P.claude), ['herdr', 'claude', true, 'Claude Code']);
  assert.deepEqual(kind(P.codex), ['herdr', 'codex', true, 'Codex']);
  assert.deepEqual(kind(P.antigravity), ['herdr', 'antigravity', true, 'Antigravity']);
  assert.deepEqual(kind(P.bash), ['roster', 'bash', true, 'Bash']);
  assert.deepEqual(kind(P.powershell), ['roster', 'powershell', true, 'PowerShell']);
  assert.deepEqual(kind({ ...P.powershell, name: 'pwsh' }), ['roster', 'powershell', true, 'PowerShell']);
  assert.deepEqual(kind(P.zsh), ['herdr', 'shell', false, 'zsh'], 'another shell: Herdr\'s tinted glyph');
  assert.deepEqual(kind(P.watcher), ['herdr', 'git', false, 'Watcher'], 'the Watcher\'s existing icon, reused');
  // Unknown: the neutral terminal, never a guess.
  for (const p of [P.unlisted, null, undefined, 'claude', {}, { key: '' }])
    assert.deepEqual(kind(p).slice(0, 3), ['roster', 'terminal', false], JSON.stringify(p));
  // Only Herdr's own icons/<name>.svg: no paths out of that folder, no other files.
  for (const icon of ['../icons/claude.svg', '/icons/claude.svg', 'icons/sub/claude.svg', 'mods/roster/icons/bash.svg', 'icons/claude.png', 'icons/.svg', 'icons/Claude.svg'])
    assert.equal(programOf({ ...P.claude, icon }).icon, null, icon);
  assert.deepEqual(Object.keys(programOf({ ...P.claude, extra: 'x' })).sort(), ['agent', 'icon', 'key', 'name', 'shell', 'tint']);
});

const THEMES = {
  dark: { surface: '#16181c', raised: '#24272d', foreground: '#e8e8e8', muted: '#9aa0a6', dim: '#6b7076', working: '#e0a040', blocked: '#e06c75', done: '#5fb878', idle: '#8a9099' },
  light: { surface: '#ffffff', raised: '#eef0f3', foreground: '#1d1f23', muted: '#5f656d', dim: '#8b9097', working: '#b7791f', blocked: '#c53030', done: '#2f855a', idle: '#6b7280' },
};
// A local PowerShell in a tab titled "Claude" (the title must not count), a remote Claude
// Developer, and a terminal Herdr knows nothing about (no pane: not openable).
function desk() {
  const f = fakeHost([
    // A shell reports no agent status, so the tab title never names it either.
    terminal('t1', 'unknown', { created_ms: 100, program: P.powershell, argv: ['powershell.exe'] }),
    terminal('edge/t2', 'working', { created_ms: 110, program: P.claude, labels: { 'herdr.role': 'developer', 'herdr.issue': 'sample/repo#7' } }),
    terminal('t3', 'idle', { created_ms: 120, labels: { 'herdr.role': 'reviewer' } })]);
  f.values.panes = [{ pane: 'p1', terminal: 't1', tab: 'tab1' }, { pane: 'edge/p2', terminal: 'edge/t2', tab: 'edge/tab2' }];
  f.values.spaces = [{ id: 'sp1', name: 'Local work', machine: null, tabs: [{ id: 'tab1', name: 'Claude', named: true }] },
    { id: 'edge/sp2', name: 'Remote work', machine: 'edge', tabs: [{ id: 'edge/tab2', name: '1', named: false }] }];
  f.host.nativeNavigation = true; f.host.run = (command, args) => f.calls.push([command, args]);
  return f;
}
function setup(f, { theme = THEMES.dark, view = 'status', storage = null, settings = null, cx: custom } = {}) {
  const app = { ...appOf(f.host), theme: () => theme, settings: () => settings };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, initialView: view, collapseUnassigned: false, storage });
  const v = new Type(), c = custom ?? context(); v.init({}, c.cx);
  return { f, view: v, ...c, render: () => v.render(c.cx) };
}
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const row = (s, address) => s.view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === address && !i.pinned);
const kindOf = (tree, i) => { const el = byId(tree, 'row-kind:' + i.key).children[0]; return el.attributes.image?.[0] ?? el.attributes.svg?.[0]; };
const moving = el => flatten(el).filter(e => e.attributes.frames || e.attributes.spin || e.attributes.loop);

for (const [name, theme] of Object.entries(THEMES)) {
  test(`narrow sidebar, ${name}: one leading icon, name first, machine only when remote, quiet tail`, () => {
    for (const view of ['status', 'projects']) {
      const s = setup(desk(), { theme, view }); const tree = s.render();
      const shell = row(s, 't1'), claude = row(s, 'edge/t2'), unknown = row(s, 't3');
      // One leading icon each: a color PowerShell (not Claude, despite the tab title), Herdr's
      // Claude Code icon for the Developer, and the neutral terminal in the theme's dim color.
      assert.equal(kindOf(tree, shell), 'mods/roster/icons/powershell.svg');
      assert.equal(kindOf(tree, claude), 'icons/claude.svg');
      assert.equal(kindOf(tree, unknown), 'mods/roster/icons/terminal.svg');
      assert.equal(byId(tree, 'row-kind:' + unknown.key).children[0].attributes.text_color[0], theme.dim);
      for (const i of [shell, claude, unknown]) assert.equal(byId(tree, i.key).children[0].attributes.id[0], 'row-kind:' + i.key, 'the icon leads');
      // Role and runtime stay distinct: Claude Code is the icon, Developer the label.
      assert.equal(byId(tree, 'row-kind:' + claude.key).attributes.accessibility_label[0], 'Claude Code');
      // A plain name, then the task in full contrast; the issue is not repeated in the name.
      assert.equal(textOf(byId(tree, 'row-name:' + claude.key)), 'Developer');
      assert.equal(byId(tree, 'row-name:' + claude.key).attributes.text_color[0], theme.foreground);
      assert.equal(byId(tree, 'row-name:' + claude.key).attributes.font_semibold, undefined, 'names are not bold');
      assert.equal(textOf(byId(tree, 'row-task:' + claude.key)), 'repo #7');
      assert.ok(byId(tree, 'row-task:' + claude.key).attributes.font_semibold);
      assert.equal(byId(tree, 'row-task:' + claude.key).attributes.accessibility_label[0], 'GitHub issue #7 in sample/repo');
      // Tail: the remote machine only; nothing for this computer.
      assert.match(textOf(byId(tree, 'row-machine:' + claude.key)), /edge$/);
      // Locally the tail names only the Space (when the group is not that Space), never the machine.
      if (view === 'status') { assert.equal(textOf(byId(tree, 'row-machine:' + shell.key)), 'Local work'); assert.equal(byId(tree, 'row-machine:' + unknown.key), undefined); }
      for (const i of [shell, claude, unknown]) assert.doesNotMatch(textOf(byId(tree, 'line:' + i.key)), /This computer|\bGH\b|Claude|Task not reported/);
      assert.equal(textOf(byId(tree, 'row-name:' + shell.key)), 't1', 'the shell keeps its own name, not the tab title');
      // Status: no chip repeats its header. Nothing on a row moves.
      if (view === 'status') assert.equal(flatten(byId(tree, 'roster-rows')).filter(e => e.attributes.max_w?.[0] === 104).length, 0);
      // Nothing on a row moves except, in Projects, the status icon of a Working row (#30: Working animates).
      for (const i of [shell, claude, unknown]) assert.deepEqual(moving(byId(tree, 'line:' + i.key)).filter(e => !flatten(byId(tree, 'row-status:' + i.key) ?? []).includes(e)), []);
      for (const i of [shell, claude, unknown]) assert.equal(moving(byId(tree, 'row-status:' + i.key) ?? []).length, view === 'projects' && i.status === 'Working' ? 1 : 0, i.row.address);
      assert.deepEqual(s.f.calls, []);
    }
  });
}

test('a tab title never picks the icon: no program record means the neutral terminal', () => {
  const f = desk();
  f.values.terminals.push(terminal('t5', 'working', { created_ms: 140, labels: { 'herdr.role': 'developer' } }));
  f.values.panes.push({ pane: 'p5', terminal: 't5', tab: 'tab5' });
  f.values.spaces[0].tabs.push({ id: 'tab5', name: 'Claude', named: true });
  const s = setup(f); const tree = s.render(), i = row(s, 't5');
  assert.equal(kindOf(tree, i), 'mods/roster/icons/terminal.svg');
  assert.equal(byId(tree, 'row-kind:' + i.key).attributes.accessibility_label[0], 'Terminal');
  assert.equal(flatten(tree).some(e => /claude/i.test(e.attributes.image?.[0] ?? e.attributes.svg?.[0] ?? '') && flatten(byId(tree, i.key)).includes(e)), false);
});

test('a discreet chevron on hover or keyboard focus, only on rows that open their exact session', () => {
  // t3's pane is in a tab no Space lists: Roster cannot open it (a pane-less one would be peeked).
  const f = desk(); f.values.panes.push({ pane: 'p3', terminal: 't3', tab: 'tab-unlisted' });
  const s = setup(f); let tree = s.render();
  const shell = row(s, 't1'), unknown = row(s, 't3');
  assert.equal(unknown.navigation.enabled, false);
  for (const i of [shell, unknown]) assert.deepEqual(byId(tree, 'row-open:' + i.key).children, [], 'hidden, place reserved');
  assert.equal(byId(tree, 'row-open:' + shell.key).attributes.w[0], 10);
  byId(tree, 'line:' + shell.key).attributes.on_hover[0](true, s.cx); tree = s.render();
  assert.equal(byId(tree, 'row-open:' + shell.key).children[0].attributes.svg[0], 'mods/roster/icons/chevron-right.svg');
  byId(tree, 'line:' + unknown.key).attributes.on_hover[0](true, s.cx); tree = s.render();
  assert.deepEqual(byId(tree, 'row-open:' + unknown.key).children, [], 'no pane to open: no chevron');
  s.view.place(shell.key); s.view.hoverKey = null; tree = s.render();
  assert.equal(byId(tree, 'row-open:' + shell.key).children.length, 1, 'keyboard focus shows it too');
  // Clicking opens the exact local pane; ⓘ keeps the technical details.
  byId(tree, shell.key).attributes.on_click[0]({}, s.cx);
  assert.deepEqual(s.f.calls, [['pane.focus', { pane: 'p1' }]]);
  assert.ok(byId(tree, 'info:' + shell.key));
});

test('status headers: colored icons that also say their status in words; Working turns', () => {
  const f = desk(); f.values.terminals.push(terminal('t4', 'done', { created_ms: 130 }));
  const s = setup(f, { theme: THEMES.light }); const tree = s.render();
  const header = label => byId(tree, s.view.controller.projection.instances.find(i => i.kind === 'section' && i.label === label).key);
  const lead = label => header(label).children[0];
  assert.equal(lead('Working').attributes.svg[0], 'mods/roster/icons/working.svg');
  assert.equal(lead('Working').attributes.text_color[0], THEMES.light.working); assert.equal(lead('Working').attributes.spin[0], 1200);
  assert.equal(lead('Idle').attributes.text_color[0], THEMES.light.idle);
  assert.equal(lead('Done').attributes.text_color[0], THEMES.light.done);
  for (const label of ['Working', 'Idle', 'Done']) assert.equal(textOf(byId(header(label), 'group-label:' + header(label).attributes.id[0])), label);
  assert.equal(moving(tree).length, 1, 'only the Working ring moves');
});

test('reduced motion: nothing moves, from Herdr\'s setting or Roster\'s Options; a broken storage is ignored', () => {
  const store = (value, broken = false) => ({ getItem: () => { if (broken) throw Error('blocked'); return value; }, setItem() { if (broken) throw Error('blocked'); } });
  for (const [storage, settings, still] of [[store('reduce'), null, true], [null, { reduce_motion: true }, true], [store('full'), null, false], [store(null, true), null, false]]) {
    const s = setup(desk(), { storage, settings }); const tree = s.render();
    assert.equal(moving(tree).length, still ? 0 : 1, JSON.stringify(settings));
    if (still) assert.equal(textOf(byId(tree, JSON.stringify(['status', 'Working']))), textOf(byId(setup(desk()).render(), JSON.stringify(['status', 'Working']))), 'the header still names its status');
  }
  assert.equal(reducedMotion({ reduced_motion: true }, null), true);
  // The Options choice is stored and read back.
  const saved = {}; const storage = { getItem: k => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } };
  const s = setup(desk(), { storage }); let tree = s.render();
  byId(tree, 'tools:toggle').attributes.on_click[0]({}, s.cx); tree = s.render();
  assert.equal(textOf(byId(tree, 'motion:toggle')).trim(), 'Motion: on');
  byId(tree, 'motion:toggle').attributes.on_click[0]({}, s.cx); tree = s.render();
  assert.equal(saved['roster.motion'], 'reduce'); assert.equal(textOf(byId(tree, 'motion:toggle')).trim(), 'Motion: reduced');
  assert.equal(moving(tree).length, 0);
  assert.deepEqual(s.f.calls, []);
});

test('a new arrival in Needs you pulses the bell once, then it is still; never at start, never on rows', () => {
  let clock = 1000;
  const make = ({ storage = null } = {}) => {
    const f = desk(); f.host.now = () => clock;
    f.values.terminals.push(terminal('t9', 'blocked', { created_ms: 90 }));
    const c = context(), every = [], after = [];
    c.cx.timer.every = (ms, fn) => every.push({ ms, fn }); c.cx.timer.after = (ms, fn) => after.push({ ms, fn });
    return { ...setup(f, { storage, cx: c }), every, after };
  };
  const s = make(); let tree = s.render();
  assert.deepEqual(s.every.map(e => e.ms), [1000], 'one gentle timer');
  const bell = () => byId(s.render(), 'group-icon:' + JSON.stringify(['attention']));
  s.every[0].fn(s.cx); assert.equal(s.stats.notify, 0, 'already pending at start: no pulse');
  assert.equal(bell().attributes.loop, undefined);
  assert.equal(bell().children[0].attributes.text_color[0], THEMES.dark.blocked);
  // A second session starts needing you.
  s.f.values.terminals = s.f.values.terminals.map(t => t.address === 't1' ? { ...t, status: 'blocked' } : t);
  tree = s.render(); s.every[0].fn(s.cx);
  assert.equal(s.stats.notify, 1);
  assert.deepEqual(bell().attributes.loop[0], 'opacity');
  assert.deepEqual(moving(byId(s.render(), 'roster-needs-rows')), [], 'the rows themselves never move');
  // The same set again: no new pulse. After the pulse: still.
  s.every[0].fn(s.cx); assert.equal(s.stats.notify, 1);
  assert.deepEqual(s.after.map(a => a.ms), [2000]);
  clock += 2000; s.after[0].fn(s.cx); assert.equal(s.stats.notify, 2);
  assert.equal(bell().attributes.loop, undefined);
  // Reduced motion: no pulse at all, and no redraw for one.
  const r = make({ storage: { getItem: () => 'reduce', setItem() {} } }); r.render(); r.every[0].fn(r.cx);
  r.f.values.terminals = r.f.values.terminals.map(t => t.address === 't1' ? { ...t, status: 'blocked' } : t);
  r.render(); r.every[0].fn(r.cx);
  assert.equal(r.stats.notify, 0); assert.deepEqual(moving(r.render()), []);
  // The arrival rule on its own: leaving and coming back is a new arrival.
  const a = new Arrivals(); assert.equal(a.take(['x']), false); assert.equal(a.take(['x', 'y']), true); assert.equal(a.take(['y']), false); assert.equal(a.take(['x', 'y']), true);
});
