import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { GitIdentities, MachineOs, verifyFolder, readyNow, OS_RELEASE } from '../spaces.js';
import { spawnNow, fakeHost, terminal, kit, context, appOf, flatten, layoutHostUnused } from './sidebar-fixtures.mjs';

// Regressions for the PR #26 review (round 1): passive remote probes (D8), the folder
// dialog's keyboard, and the first Needs you arrival's pulse. Neutral sample data.
const ok = stdout => ({ code: 0, stdout, stderr: '' });
const settle = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let n = 0; n < 6; n++) await settle(); };
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const UBUNTU = 'ID=ubuntu\nLOGO=ubuntu-logo\nPRETTY_NAME="Ubuntu"\n';

// ---- D8: a remote machine is asked only while ready, re-checked at dispatch and on the answer ----

function prober({ atOnce = 1 } = {}) {
  const state = { ready: true }, calls = [], pending = [];
  const host = { now: () => 0, isReady: m => m === 'edge' && state.ready,
    exec: (cmd, args, options) => { calls.push([cmd, args, options.on]); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } };
  const ids = new GitIdentities(host, { atOnce, retryMs: 1000, deadlineMs: 50 });
  return { state, calls, pending, ids, after: () => {} };
}

test('D8 Git: not ready means no call; readiness is re-checked at dispatch; queued work is dropped on disconnect', async () => {
  // Not ready: nothing is dispatched, the identity is unknown.
  const a = prober(); a.state.ready = false;
  a.ids.request([{ machine: 'edge', folder: '/x' }], a.after);
  assert.deepEqual(a.calls, []); assert.equal(a.ids.lookup('edge', '/x').status, 'unsure');
  // Readiness lost before dispatch: the queued job is never sent.
  const b = prober();
  b.ids.request([{ machine: 'edge', folder: '/x' }, { machine: 'edge', folder: '/y' }], b.after);
  assert.equal(b.calls.length, 1, 'the first job only, its first command');
  b.state.ready = false;
  for (const p of b.pending) p.resolve(ok('/x\n')); await flush();
  assert.equal(b.calls.length, 1, 'neither its next command nor the queued job is sent after readiness is lost');
  assert.equal(b.ids.lookup('edge', '/x').status, 'unsure', 'answers that arrive after readiness was lost are discarded');
  assert.equal(b.ids.lookup('edge', '/y').status, 'unsure');
  // Disconnect cancels queued work even before the running job settles.
  const c = prober();
  c.ids.request([{ machine: 'edge', folder: '/x' }, { machine: 'edge', folder: '/y' }, { machine: 'edge', folder: '/z' }], c.after);
  c.ids.cancel('edge'); c.state.ready = true;
  for (const p of c.pending) p.resolve(ok('/x\n')); await flush();
  for (const p of c.pending) p.resolve(ok('/x/.git\n')); await flush();
  assert.equal(c.calls.length, 1, 'cancelled jobs, queued or running, never dispatch again, even if the machine is ready again');
  assert.equal(c.ids.queue.length, 0);
});

test('D8 Git: a Core that becomes unavailable between two Git calls of the same refresh gets no further call', async () => {
  // Identity: two commands; readiness drops after the first answers.
  const p = prober();
  p.ids.request([{ machine: 'edge', folder: '/x' }], p.after);
  assert.equal(p.calls.length, 1);
  p.state.ready = false; p.pending[0].resolve(ok('/x\n')); await flush();
  assert.equal(p.calls.length, 1, 'the second command is not sent');
  assert.equal(p.ids.lookup('edge', '/x').status, 'unsure', 'shown as unknown');
  // State refresh: three commands; readiness drops after the second.
  const s = prober();
  s.ids.request([{ machine: 'edge', folder: '/x' }], s.after);
  s.pending[0].resolve(ok('/x\n')); await flush(); s.pending[1].resolve(ok('/x/.git\n')); await flush();
  assert.equal(s.ids.lookup('edge', '/x').status, 'repo');
  s.ids.request([{ machine: 'edge', folder: '/x' }], s.after); await flush();
  assert.equal(s.calls.length, 3, 'the state refresh starts with git status');
  s.pending[2].resolve(ok(' M a\n')); await flush();
  assert.equal(s.calls.length, 4, 'then the ahead/behind count');
  s.state.ready = false; s.pending[3].resolve(ok('1\t0\n')); await flush();
  assert.equal(s.calls.length, 4, 'the branch query is not sent');
  const entry = s.ids.lookup('edge', '/x');
  assert.deepEqual([entry.dirty, entry.ahead, entry.behind, entry.branch], [null, null, null, null], 'indicators unknown, not partial');
  // Lost while the last command is out: its answer is discarded.
  const l = prober();
  l.ids.request([{ machine: 'edge', folder: '/x' }], l.after);
  l.pending[0].resolve(ok('/x\n')); await flush();
  assert.equal(l.calls.length, 2);
  l.state.ready = false; l.pending[1].resolve(ok('/x/.git\n')); await flush();
  assert.equal(l.ids.lookup('edge', '/x').status, 'unsure', 'a late answer is not used');
});

test('D8 Git: a failed read is unknown after exactly one call, and coming back does not retry it', async () => {
  const p = prober({ atOnce: 4 });
  p.ids.request([{ machine: 'edge', folder: '/x' }], p.after);
  p.pending[0].reject(Error('unreachable')); await flush();
  assert.equal(p.ids.lookup('edge', '/x').status, 'unsure');
  const sent = p.calls.length;
  p.state.ready = false; p.state.ready = true;
  p.ids.request([{ machine: 'edge', folder: '/x' }], p.after);
  assert.equal(p.calls.length, sent, 'no retry through a reconnect before the schedule');
});

function osCache() {
  const state = { ready: true }, reads = [], timers = []; let now = 0;
  let answer = () => Promise.resolve(UBUNTU);
  const os = new MachineOs({ now: () => now, isReady: m => m === 'edge' && state.ready,
    readTextFile: (path, options) => { reads.push([path, options.on]); return answer(); } }, { retryMs: 1000, deadlineMs: 50 });
  return { state, reads, os, after: (_ms, fn) => timers.push(fn), set answer(fn) { answer = fn; }, tick: ms => { now += ms; } };
}

test('D8 OS: not ready, readiness lost before the read or after it, and a failed read', async () => {
  const notReady = osCache(); notReady.state.ready = false;
  notReady.os.request(['edge'], 'windows', notReady.after); await flush();
  assert.deepEqual(notReady.reads, []); assert.equal(notReady.os.lookup('edge'), null);
  // Lost between the request and the dispatch (the read is sent in a later microtask).
  const before = osCache(); before.os.request(['edge'], 'windows', before.after); before.state.ready = false; await flush();
  assert.deepEqual(before.reads, [], 'no read after readiness is lost');
  assert.equal(before.os.lookup('edge'), null);
  // Lost while the read was out: the answer is discarded.
  const during = osCache(); let resolve;
  during.answer = () => new Promise(r => { resolve = r; });
  during.os.request(['edge'], 'windows', during.after); await flush();
  during.state.ready = false; resolve(UBUNTU); await flush();
  assert.equal(during.reads.length, 1); assert.equal(during.os.lookup('edge'), null, 'unknown: the generic machine icon stays');
  // A failed read: unknown after exactly one call; a reconnect does not retry it.
  const failed = osCache(); failed.answer = () => Promise.reject(Error('refused'));
  failed.os.request(['edge'], 'windows', failed.after); await flush();
  failed.state.ready = false; failed.state.ready = true;
  failed.os.request(['edge'], 'windows', failed.after); await flush();
  assert.deepEqual(failed.reads, [[OS_RELEASE, 'edge']], 'exactly one call');
  assert.equal(failed.os.lookup('edge'), null);
  // Ready throughout: read and shown.
  const fine = osCache(); fine.os.request(['edge'], 'windows', fine.after); await flush();
  assert.equal(fine.os.lookup('edge').icon, 'os-ubuntu');
});

test('D8 folder check: a remote machine that is not ready, or stops being ready, is Not verified', async () => {
  const calls = [], after = () => {};
  const exec = (cmd, args, options) => { calls.push(options.on); return Promise.resolve(ok('/srv/repo\n')); };
  assert.deepEqual(await verifyFolder(exec, 'edge', '/srv/repo', after, 50, () => false), { status: 'unsure', reason: 'not-ready' });
  assert.deepEqual(calls, [], 'no call when not ready');
  let ready = true;
  const flipping = (cmd, args, options) => { calls.push(options.on); ready = false; return Promise.resolve(ok('/srv/repo\n')); };
  assert.deepEqual(await verifyFolder(flipping, 'edge', '/srv/repo', after, 50, () => ready), { status: 'unsure', reason: 'not-ready' });
  assert.deepEqual(calls, ['edge'], 'lost between the two commands: the second is not sent');
  assert.equal((await verifyFolder(exec, null, '/home/sample/work', after, 50, () => false)).status, 'repo', 'this computer needs no remote readiness');
  assert.equal(readyNow(() => { throw Error('x'); }, 'edge'), false, 'a throw is not ready');
  assert.equal(readyNow(undefined, 'edge'), false, 'no readiness check: not ready');
  assert.equal(readyNow(undefined, null), true, 'this computer needs no remote Core');
});

test('D8 view: a machine that stops being ready has its queued Git work cancelled; coming back retries nothing', async () => {
  const f = fakeHost([terminal('edge/t1', 'idle')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  f.values.spaces = [{ id: 'edge/s1', name: 'Remote', machine: 'edge', tabs: [{ id: 'edge/tab' }] }];
  f.values.panes = [{ pane: 'edge/p1', terminal: 'edge/t1', tab: 'edge/tab', cwd: '/srv/repo' }];
  const execs = [];
  const exec = (cmd, args, options) => { execs.push(options.on); return new Promise(() => {}); };
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, exec, readTextFile: () => new Promise(() => {}) });
  const v = new Type(), c = context(), every = [];
  c.cx.timer.every = (ms, fn) => every.push(fn); c.cx.timer.after = () => {};
  v.init({}, c.cx); v.render(c.cx);
  const cancelled = []; const cancel = v.git.cancel.bind(v.git); v.git.cancel = m => { cancelled.push(m); cancel(m); };
  every.forEach(fn => fn(c.cx)); await flush();
  assert.equal(execs.length, 1, 'asked while ready (one command at a time)');
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'loading' }];
  every.forEach(fn => fn(c.cx)); await flush();
  assert.deepEqual(cancelled, ['edge']);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  every.forEach(fn => fn(c.cx)); await flush();
  assert.equal(execs.length, 1, 'no retry through the reconnect');
});

// ---- The folder dialog has its own keyboard order and activation ----

const REPOS = { '/srv/repo': ['/srv/repo', '/srv/repo/.git'], '/home/sample/work': ['/home/sample/work', '/home/sample/work/.git'] };
function dialog() {
  const f = fakeHost([terminal('edge/t1', 'idle')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  f.values.spaces = [{ id: 's-local', name: 'Local', machine: null, active: true, tabs: [{ id: 'tab-l' }] }];
  f.values.panes = [];
  f.host.run = (command, args) => f.calls.push([command, args]);
  const exec = (cmd, args, options) => { const known = REPOS[options.cwd];
    return Promise.resolve(known ? ok((args.includes('--show-toplevel') ? known[0] : known[1]) + '\n') : { code: 128, stdout: '', stderr: 'fatal: not a git repository' }); };
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, exec, pickFolder: async () => '/home/sample/work' });
  const v = new Type(), c = context();
  c.cx.timer.every = () => {}; c.cx.timer.after = () => {};
  c.cx.spawn = fn => { c.tasks.push(spawnNow(fn, c.cx)); };
  v.init({}, c.cx);
  // The fake input reports focus like gpui-base: focus() fires its focus handler.
  let inputFocus = 0;
  const mount = () => {
    if (v.pathInput && !v.pathInput.simulatedFocus) {
      v.pathInput.simulatedFocus = true;
      const input = v.pathInput; input.focus = () => { inputFocus++; input.handlers.focus?.({}, c.cx); };
    }
    return v.render(c.cx);
  };
  const key = k => { const before = c.stats.stop; v.key({ keystroke: k }, c.cx); v.render(c.cx); return c.stats.stop > before; };
  return { f, v, c, key, render: mount, inputFocus: () => inputFocus };
}
const tabTo = (d, target, max = 12) => { for (let n = 0; n < max && d.v.newSpaceCursor !== target; n++) d.key('tab'); return d.v.newSpaceCursor; };

test('keyboard only: open on a remote machine, type a path, check it and create the Space', async () => {
  const d = dialog(); d.render();
  d.v.handle.focus(); d.v.openNewSpace('edge', d.c.cx); d.render(); await flush();
  assert.equal(d.inputFocus(), 1, 'the path field takes the keyboard on open');
  assert.equal(d.v.newSpaceCursor, 'new-space:path'); assert.equal(d.v.inputFocused, true);
  // The field keeps its own keys: arrows, Home/End and Enter are not taken by Roster.
  for (const k of ['left', 'right', 'home', 'end', 'up', 'down', 'backspace']) assert.equal(d.key(k), false, k);
  d.v.pathInput.set_value('/srv/repo');
  d.v.pathInput.handlers.submit({}, d.c.cx); await flush(); d.render();
  assert.equal(d.v.newSpace.check.status, 'repo');
  // Tab leaves the field and walks the dialog's controls; Enter activates.
  assert.equal(d.key('tab'), true); assert.equal(d.v.inputFocused, false);
  assert.equal(tabTo(d, 'new-space:create'), 'new-space:create');
  d.key('enter');
  assert.deepEqual(d.f.calls, [['space.new', { machine: 'edge', folder: '/srv/repo' }]]);
  assert.equal(d.v.newSpace, null, 'closed after creating');
});

test('keyboard only on this computer: Choose folder, then Create; Shift-Tab and arrows move back', async () => {
  const d = dialog(); d.render();
  d.v.openNewSpace(null, d.c.cx); d.render();
  assert.equal(d.v.newSpaceCursor, 'new-space:pick'); assert.equal(d.inputFocus(), 0);
  d.key('enter'); await flush(); d.render();
  assert.equal(d.v.newSpace.folder, '/home/sample/work'); assert.equal(d.v.newSpace.check.status, 'repo');
  assert.equal(tabTo(d, 'new-space:create'), 'new-space:create');
  d.key('shift-tab'); assert.notEqual(d.v.newSpaceCursor, 'new-space:create');
  d.key('down'); assert.equal(d.v.newSpaceCursor, 'new-space:create');
  // The selected control is drawn as selected.
  assert.notEqual(byId(d.render(), 'new-space:create').attributes.bg.at(-1), byId(d.render(), 'new-space:pick').attributes.bg.at(-1));
  d.key('space');
  assert.deepEqual(d.f.calls, [['space.new', { machine: '', folder: '/home/sample/work' }]]);
});

test('keyboard only: Cancel and Esc close the dialog and change nothing', async () => {
  for (const how of ['cancel', 'escape', 'escape-in-field']) {
    const d = dialog(); d.render();
    d.v.openNewSpace('edge', d.c.cx); d.render();
    if (how === 'cancel') { d.key('shift-tab'); assert.equal(d.v.newSpaceCursor, 'new-space:cancel'); d.key('enter'); }
    else { if (how === 'escape') d.key('tab'); d.key('escape'); }
    assert.equal(d.v.newSpace, null, how); assert.deepEqual(d.f.calls, [], how);
  }
});

// ---- The first arrival pulses even before the first timer tick ----

test('the reviewer timing: empty at 0 ms, a new item at 500 ms, the first tick at 1000 ms pulses; no replay', async () => {
  const f = fakeHost([terminal('t1', 'idle', { created_ms: 100, labels: { 'herdr.role': 'developer' } })]);
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, initialView: 'status', storage: null });
  const v = new Type(), c = context(), every = [], after = [];
  c.cx.timer.every = (ms, fn) => every.push(fn); c.cx.timer.after = (ms, fn) => after.push(fn);
  v.init({}, c.cx);
  const bell = () => byId(v.render(c.cx), 'group-icon:' + JSON.stringify(['attention']));
  v.render(c.cx); await flush();                                   // 0 ms: nothing pending
  f.values.terminals = f.values.terminals.map(t => ({ ...t, status: 'blocked' }));
  v.render(c.cx);                                   // 500 ms: the item arrives and is drawn
  assert.equal(c.stats.notify, 0, 'render asked for no redraw');
  every[0](c.cx);                                   // 1000 ms: the first tick
  assert.equal(c.stats.notify, 1); assert.ok(bell().attributes.loop, 'it pulses');
  for (let n = 0; n < 3; n++) { v.render(c.cx); every[0](c.cx); }
  assert.equal(c.stats.notify, 1, 'no replay on refresh'); assert.equal(after.length, 1);
});
