import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { gitIdentity, GitIdentities, nestWorktrees, spacePlace, spaceRows, GIT_TOP, GIT_COMMON, GIT_STATUS, GIT_COUNTS, GIT_BRANCH, gitState, repoName, spaceTail } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const ok = stdout => ({ code: 0, stdout, stderr: '' });
const repo = (top, common = top + '/.git') => ({ status: 'repo', top, common, linked: common !== top + '/.git' });

test('identity is verified only from two clean answers; Git\'s own "no" is none, anything else unsure', () => {
  assert.deepEqual(gitIdentity(ok('/r/main\n'), ok('/r/main/.git\n')), repo('/r/main'));
  assert.deepEqual(gitIdentity(ok('/r/wt\n'), ok('/r/main/.git\n')), repo('/r/wt', '/r/main/.git'));
  assert.deepEqual(gitIdentity({ code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' }, ok('x')), { status: 'none' });
  for (const [top, common] of [[null, ok('/c')], [{ code: 1, stdout: '', stderr: 'error: cannot run git' }, ok('/c')],
    [ok(''), ok('/c')], [ok('/a\n/b\n'), ok('/c')], [ok('/a'), ok('/c\u0007')], [ok(42), ok('/c')]])
    assert.deepEqual(gitIdentity(top, common), { status: 'unsure' });
});

function prober({ atOnce = 2, answer, ready = () => true } = {}) {
  const calls = [], timers = [], pending = [];
  let now = 0;
  const host = { now: () => now, isReady: machine => ready(machine), exec: (cmd, args, options) => { calls.push([cmd, args, options]);
    const r = answer?.(args, options); if (r) return Promise.resolve(r);
    return new Promise((resolve, reject) => pending.push({ resolve, reject, args, options })); } };
  const ids = new GitIdentities(host, { atOnce, retryMs: 1000, deadlineMs: 50 });
  const after = (ms, fn) => timers.push({ ms, fn });
  return { ids, calls, timers, pending, after, tick: ms => { now += ms; }, settle: () => new Promise(r => setTimeout(r, 0)) };
}

test('probes run exactly the two read-only queries in the folder on its machine, cached and capped', async () => {
  const p = prober({ answer: (args, o) => args.includes('--show-toplevel') ? ok(o.cwd + '\n') : ok('/r/main/.git\n') });
  p.ids.request([{ machine: null, folder: '/r/main' }, { machine: 'edge', folder: '/r/main' }, { machine: null, folder: '/r/main' }, { machine: null, folder: null }], p.after);
  for (let n = 0; n < 4; n++) await p.settle();
  // Each place asks its two commands one after the other (D8 is checked before each).
  const per = on => p.calls.filter(c => c[2].on === on).map(c => [c[0], c[1], c[2].cwd]);
  assert.equal(p.calls.length, 4);
  for (const on of [null, 'edge']) assert.deepEqual(per(on), [['git', [...GIT_TOP], '/r/main'], ['git', [...GIT_COMMON], '/r/main']]);
  assert.deepEqual(GIT_TOP, ['rev-parse', '--show-toplevel']); assert.deepEqual(GIT_COMMON, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  assert.ok(p.calls.every(c => c[2].timeout > 0));
  assert.equal(p.ids.lookup(null, '/r/main').status, 'repo'); assert.equal(p.ids.lookup('edge', '/r/main').linked, false);
  assert.equal(p.ids.takeChanged(), true); assert.equal(p.ids.takeChanged(), false);
  // Identity is cached; the next request reads the checkout's state once, then nothing until stateMs.
  p.ids.request([{ machine: null, folder: '/r/main' }], p.after); for (let n = 0; n < 4; n++) await p.settle();
  assert.deepEqual(p.calls.slice(4).map(c => [c[1], c[2].cwd, c[2].on]), [[[...GIT_STATUS], '/r/main', null], [[...GIT_COUNTS], '/r/main', null], [[...GIT_BRANCH], '/r/main', null]]);
  p.ids.request([{ machine: null, folder: '/r/main' }], p.after); await p.settle();
  assert.equal(p.calls.length, 7);
});

test('a hung probe times out to unsure on the host timer; at most N run at once; unsure retries, none does not', async () => {
  const p = prober({ atOnce: 2 });
  p.ids.request(['/a', '/b', '/c'].map(folder => ({ machine: null, folder })), p.after);
  assert.equal(p.calls.length, 2, 'two places at once, one command each at a time');
  assert.equal(p.ids.lookup(null, '/c').status, 'probing', 'flat while probing');
  p.timers[0].fn(); await p.settle(); await p.settle();
  assert.equal(p.ids.lookup(null, '/a').status, 'unsure');
  assert.equal(p.calls.length, 3, 'the next place starts when one ends');
  // /b: Git says no repo (each command answers as it is asked).
  for (let n = 0; n < 4; n++) { p.pending.filter(x => x.options.cwd === '/b' && !x.done).forEach(x => { x.done = true; x.resolve({ code: 128, stdout: '', stderr: 'fatal: not a git repository' }); }); await p.settle(); await p.settle(); }
  assert.equal(p.ids.lookup(null, '/b').status, 'none');
  const sent = p.calls.length;
  p.ids.request([{ machine: null, folder: '/a' }, { machine: null, folder: '/b' }], p.after);
  assert.equal(p.calls.length, sent, 'nothing retried before retryMs');
  p.tick(1500); p.ids.request([{ machine: null, folder: '/a' }, { machine: null, folder: '/b' }], p.after);
  assert.equal(p.calls.filter(c => c[2].cwd === '/a').length, 2, 'unsure asked again'); assert.equal(p.calls.filter(c => c[2].cwd === '/b').length, 2, 'none is remembered');
  // A rejected exec (machine unreachable) is unsure too.
  const q = prober({ answer: () => null }); q.ids.request([{ machine: 'edge', folder: '/x' }], q.after);
  q.pending[0].reject(Error('unreachable')); await q.settle(); await q.settle();
  assert.equal(q.ids.lookup('edge', '/x').status, 'unsure');
  // D8: no retry through a reconnect; the unsure answer is asked again only on the schedule.
  q.ids.request([{ machine: 'edge', folder: '/x' }], q.after); assert.equal(q.calls.length, 1, 'a failed command sends no other; not before retryMs');
  q.tick(1500); q.ids.request([{ machine: 'edge', folder: '/x' }], q.after); assert.equal(q.calls.length, 2, 'asked again after retryMs');
});

const sp = (id, name, extra = {}) => ({ id, name, machine: null, active: false, branch: null, tabs: [{ id: 'tab-' + id }], ...extra });
test('worktrees nest under the first main checkout with the same verified common dir; saved order otherwise kept', () => {
  const ids = { main: repo('/r/main'), wt1: repo('/r/wt1', '/r/main/.git'), wt2: repo('/r/wt2', '/r/main/.git'), other: repo('/o'),
    orphan: repo('/q/wt', '/q/main/.git'), probing: { status: 'probing' }, none: { status: 'none' } };
  const list = ['wt1', 'other', 'main', 'orphan', 'wt2', 'probing', 'none'].map(id => sp(id, id));
  const out = nestWorktrees(list, s => ids[s.id]);
  assert.deepEqual(out.map(r => r.space.id + (r.tree ? ':' + r.tree : '')), ['other', 'main', 'wt1:middle', 'wt2:last', 'orphan', 'probing', 'none']);
  // Same common dir path on another machine never nests: spaceRows groups by machine first.
  const rows = spaceRows({ spaces: [sp('m', 'main'), sp('edge/w', 'wt', { machine: 'edge' })], machines: [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }] },
    { identityOf: s => s.id === 'm' ? repo('/r/main') : repo('/r/wt', '/r/main/.git') });
  assert.deepEqual(rows.filter(r => r.kind === 'space').map(r => [r.id, r.tree]), [['m', null], ['edge/w', null]]);
});

test('a Space\'s place is its first pane\'s live folder, else the folder it was made with', () => {
  const space = { tabs: [{ id: 'a' }, { id: 'b' }], folder: '/made' };
  assert.equal(spacePlace(space, [{ tab: 'x', cwd: '/elsewhere' }, { tab: 'b', cwd: '/live' }, { tab: 'a', cwd: '/first' }]), '/live');
  assert.equal(spacePlace(space, [{ tab: 'a', cwd: null }]), '/made');
  assert.equal(spacePlace({ tabs: [], folder: '' }, []), null);
});

function desk() {
  const f = fakeHost([terminal('t1')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'loading' }];
  f.values.spaces = [sp('s-main', 'Main', { active: true }), sp('s-other', 'Other'), sp('s-wt', 'Feature'), sp('edge/s-r', 'Remote', { machine: 'edge' })];
  f.values.panes = [{ pane: 'p1', terminal: 't1', tab: 'tab-s-main', cwd: '/r/main' }, { pane: 'p2', terminal: null, tab: 'tab-s-wt', cwd: '/r/wt' },
    { pane: 'p3', terminal: null, tab: 'tab-s-other', cwd: '/o' }, { pane: 'edge/p4', terminal: null, tab: 'tab-edge/s-r', cwd: '/r/main' }];
  f.host.run = (command, args) => f.calls.push([command, args]);
  const execs = [], answers = { '/r/main': ['/r/main', '/r/main/.git'], '/r/wt': ['/r/wt', '/r/main/.git'], '/o': ['/o', '/o/.git'] };
  const exec = (cmd, args, options) => { execs.push([cmd, args, options]);
    const [top, common] = answers[options.cwd]; return Promise.resolve(ok((args.includes('--show-toplevel') ? top : common) + '\n')); };
  return { f, exec, execs };
}
function view(d, { checking = false, initialView } = {}) {
  const app = { ...appOf(d.f.host), checking: () => checking };
  const Type = createRosterView(kit, app, { host: d.f.host, layoutHost: layoutHostUnused, exec: d.exec, ...(initialView ? { initialView } : {}) });
  const v = new Type(), c = context(); const every = [];
  c.cx.timer.every = (ms, fn) => every.push({ ms, fn }); c.cx.timer.after = () => {};
  v.init({}, c.cx);
  return { v, ...c, every, render: () => v.render(c.cx), poll: () => every.forEach(e => e.fn(c.cx)) };
}
const settle = () => new Promise(r => setTimeout(r, 0));
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);

test('the view probes from its timer only, on ready machines, in Spaces; render never runs Git', async () => {
  const d = desk(), s = view(d);
  assert.deepEqual(s.every.map(e => e.ms), [1000]);
  s.render(); s.render(); assert.equal(d.execs.length, 0, 'render runs nothing');
  s.poll(); await settle(); await settle();
  assert.deepEqual([...new Set(d.execs.map(e => e[2].cwd + '@' + e[2].on))].sort(), ['/o@null', '/r/main@null', '/r/wt@null'], 'not on the loading machine');
  assert.ok(d.execs.every(e => e[0] === 'git'));
  const notifies = s.stats.notify; s.poll(); assert.equal(s.stats.notify, notifies + 1, 'answers ask for one redraw');
  s.poll(); assert.equal(s.stats.notify, notifies + 1);
  // Not in agent views, and never under herdr-app check.
  const quiet = desk(), p = view(quiet, { initialView: 'projects' }); p.poll(); await settle();
  assert.equal(p.every.length, 1); assert.equal(quiet.execs.length, 0, 'no Git while an agent view is shown');
  const checked = desk(), k = view(checked, { checking: true }); assert.equal(k.every.length, 0); assert.equal(checked.execs.length, 0);
});

test('a verified worktree is drawn indented under its main checkout; others stay as they were', async () => {
  const d = desk(), s = view(d);
  let tree = s.render();
  const order = tree => flatten(byId(tree, 'roster-rows')).filter(e => /^space:/.test(e.attributes.id?.[0] ?? '')).map(e => e.attributes.id[0]);
  assert.deepEqual(order(tree), ['space:s-main', 'space:s-other', 'space:s-wt', 'space:edge/s-r'], 'flat while probing');
  s.poll(); await settle(); await settle(); tree = s.render();
  assert.deepEqual(order(tree), ['space:s-main', 'space:s-wt', 'space:s-other', 'space:edge/s-r']);
  const wt = byId(tree, 'space:s-wt');
  assert.equal(wt.attributes.h[0], 28); assert.deepEqual(wt.attributes.pl, [30]);
  assert.equal(byId(wt, 'space-tree:s-wt').attributes.svg[0], 'mods/roster/icons/branch.svg');
  assert.equal(byId(wt, 'space-avatar:s-wt'), undefined);
  assert.match(wt.attributes.accessibility_label[0], /Feature, worktree/);
  assert.equal(byId(tree, 'space-tree:s-other'), undefined, 'its own repository: a regular row');
  assert.equal(byId(tree, 'space-tree:edge/s-r'), undefined, 'another machine is never nested');
  assert.deepEqual(d.f.calls, [], 'the saved order is never written');
});

test('a worktree whose main checkout has no Space stays a regular row', async () => {
  const d = desk(); d.f.values.spaces = d.f.values.spaces.filter(x => x.id !== 's-main');
  const s = view(d); s.poll(); await settle(); await settle(); const tree = s.render();
  assert.equal(byId(tree, 'space-tree:s-wt'), undefined); assert.ok(byId(tree, 'space-avatar:s-wt'));
});

test('the active Space is brought into view once when it or its place changes', () => {
  const d = desk(), s = view(d);
  s.render();
  assert.deepEqual(s.v.rowScroll.requests, [1], 'header, then Main');
  s.render(); assert.deepEqual(s.v.rowScroll.requests, [1], 'unchanged: no new request');
  d.f.values.spaces = d.f.values.spaces.map(x => ({ ...x, active: x.id === 'edge/s-r' })); s.render();
  assert.deepEqual(s.v.rowScroll.requests, [1, 5], 'machine headers count as rows');
  const notifies = s.stats.notify; s.render(); assert.equal(s.stats.notify, notifies);
});

test('state queries are read-only and fetch nothing; each answer only counts when its query succeeded', () => {
  for (const args of [GIT_STATUS, GIT_COUNTS, GIT_BRANCH, GIT_TOP, GIT_COMMON])
    assert.ok(!args.some(a => /^(fetch|pull|push|commit|add|reset|checkout|switch|gc|update-index|remote|config)$/.test(a)), args.join(' '));
  assert.equal(GIT_STATUS[0], '--no-optional-locks', 'status must not rewrite the index');
  assert.deepEqual(GIT_COUNTS, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  assert.deepEqual(gitState(ok(' M a.js\n?? b.js\n'), ok('2\t3\n'), ok('feature\n')), { dirty: true, ahead: 2, behind: 3, branch: 'feature' });
  assert.deepEqual(gitState(ok(''), { code: 128, stdout: '', stderr: 'fatal: no upstream configured for branch' }, { code: 1, stdout: '' }),
    { dirty: false, ahead: null, behind: null, branch: null }, 'no upstream: no arrows; detached: no branch');
  for (const counts of [ok('2'), ok('a\tb'), ok('2\t3\t4'), null, { code: 0, stdout: 7 }])
    assert.deepEqual([gitState(null, counts, null).ahead, gitState(null, counts, null).behind], [null, null]);
  assert.equal(gitState({ code: 1, stdout: ' M x' }, null, null).dirty, null, 'a failed status shows no ●');
  assert.deepEqual(['/r/herdr-mods/.git', '/r/x.git', '/r/proj/.bare', 'C:/r/Win/.git'].map(repoName), ['herdr-mods', 'x', 'proj', 'Win']);
});

test('the tail names repository and branch where useful, and only the indicators that need action', () => {
  const g = (extra = {}) => ({ status: 'repo', common: '/r/herdr-mods/.git', branch: 'feature', dirty: false, ahead: 0, behind: 0, ...extra });
  assert.deepEqual(spaceTail({ name: 'Work' }, g(), null), { text: 'herdr-mods · feature', dirty: false, ahead: 0, behind: 0, tooltip: '' });
  assert.equal(spaceTail({ name: 'herdr-mods' }, g({ branch: 'main' }), null).text, '', 'repo named like the Space, main branch');
  assert.equal(spaceTail({ name: 'Feature' }, g(), 'last').text, '', 'nested row: no repo; branch named like the Space');
  assert.deepEqual(spaceTail({ name: 'Work' }, g({ dirty: true, ahead: 2, behind: 3 }), null),
    { text: 'herdr-mods · feature', dirty: true, ahead: 2, behind: 3, tooltip: 'Uncommitted changes in this checkout · 2 local commits to push · 3 upstream commits to pull' });
  assert.equal(spaceTail({ name: 'Work' }, g({ ahead: 1 }), null).tooltip, '1 local commit to push');
  assert.equal(spaceTail({ name: 'Work' }, g({ behind: 1 }), null).tooltip, '1 upstream commit to pull');
  assert.deepEqual(spaceTail({ name: 'Work' }, g({ dirty: null, ahead: null, behind: null }), null).tooltip, '', 'unknown hides everything');
  // Before Git answers, the tail is Herdr's own branch, as before.
  assert.equal(spaceTail({ name: 'Work', branch: 'feature' }, null, null).text, 'feature');
});

test('state refreshes in the background every stateMs; a failed refresh hides the indicators', async () => {
  let states = [ok(' M a\n'), ok('1\t0\n'), ok('topic\n')];
  const p = prober({ answer: (args, o) => args.includes('--show-toplevel') ? ok('/r\n') : args.includes('--git-common-dir') ? ok('/r/.git\n')
    : states[[GIT_STATUS, GIT_COUNTS, GIT_BRANCH].findIndex(q => q.join() === args.join())] });
  const ask = async () => { p.ids.request([{ machine: null, folder: '/r' }], p.after); await p.settle(); await p.settle(); };
  await ask(); await ask();
  assert.deepEqual(['dirty', 'ahead', 'behind', 'branch'].map(k => p.ids.lookup(null, '/r')[k]), [true, 1, 0, 'topic']);
  states = [{ code: 128, stdout: '', stderr: 'fatal' }, { code: 128, stdout: '', stderr: 'fatal' }, { code: 128, stdout: '' }];
  await ask(); assert.equal(p.ids.lookup(null, '/r').dirty, true, 'not again before stateMs');
  p.tick(1500 * 30); await ask();
  assert.deepEqual(['status', 'dirty', 'ahead', 'behind', 'branch'].map(k => p.ids.lookup(null, '/r')[k]), ['repo', null, null, null, null]);
});

test('Spaces draws ●, ↑ and ↓ as separate colored marks with a spelled-out tooltip; zeros are not drawn', async () => {
  const d = desk();
  const answers = { '/r/main': { dirty: ' M x\n', counts: '2\t3\n', branch: 'main\n' }, '/o': { dirty: '', counts: '0\t0\n', branch: 'topic\n' }, '/r/wt': { dirty: '', counts: '0\t4\n', branch: 'wt-branch\n' } };
  const base = d.exec;
  d.exec = (cmd, args, options) => {
    const a = answers[options.cwd], q = [GIT_STATUS, GIT_COUNTS, GIT_BRANCH].findIndex(x => x.join() === args.join());
    if (q < 0) return base(cmd, args, options);
    d.execs.push([cmd, args, options]); return Promise.resolve(ok([a.dirty, a.counts, a.branch][q]));
  };
  const theme = { surface: '#111111', raised: '#222222', foreground: '#eeeeee', ansi1: '#aa0000', ansi2: '#00aa00', ansi3: '#aaaa00' };
  const app = { ...appOf(d.f.host), checking: () => false, theme: () => theme };
  const Type = createRosterView(kit, app, { host: d.f.host, layoutHost: layoutHostUnused, exec: d.exec });
  const v = new Type(), c = context(), every = []; c.cx.timer.every = (ms, fn) => every.push(fn); c.cx.timer.after = () => {}; v.init({}, c.cx);
  for (let n = 0; n < 2; n++) { every.forEach(fn => fn(c.cx)); await settle(); await settle(); }
  const tree = v.render(c.cx);
  assert.equal(byId(tree, 'space-branch:s-main'), undefined, 'repo "main" is the Space\'s own name and branch main is not shown');
  const mark = e => e.attributes.svg ? e.attributes.svg[0].split('/').pop() : textOf(e);
  assert.deepEqual(byId(tree, 'space-git:s-main').children.map(e => [e.attributes.id[0], mark(e), e.attributes.text_color[0]]),
    [['space-dirty:s-main', 'pencil.svg', '#aaaa00'], ['space-ahead:s-main', '↑2', '#00aa00'], ['space-behind:s-main', '↓3', '#aa0000']]);
  assert.ok(!textOf(byId(tree, 'space-git:s-main')).includes('●'), 'dots are reserved for machine connection state');
  assert.equal(byId(tree, 'space-git:s-main').attributes.tooltip[0], 'Uncommitted changes in this checkout · 2 local commits to push · 3 upstream commits to pull');
  assert.equal(byId(tree, 'space-git:s-other'), undefined, 'clean and level: no marks');
  assert.equal(textOf(byId(tree, 'space-branch:s-other')), 'o · topic');
  assert.deepEqual(byId(tree, 'space-git:s-wt').children.map(e => textOf(e)), ['↓4'], 'only what needs action');
  assert.equal(textOf(byId(tree, 'space-branch:s-wt')), 'wt-branch', 'nested row: branch only, no repo');
  assert.ok(d.execs.every(e => e[0] === 'git'));
});
