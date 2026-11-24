import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { GitIdentities, verifyFolder, GIT_TOP, GIT_COMMON, GIT_STATUS, GIT_BRANCH, GIT_COUNTS } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, layoutHostUnused } from './sidebar-fixtures.mjs';

// Regressions for the PR #26 review (round 2): stale or partial remote work. Simulated
// state and mocked host calls only; nothing reaches a real machine.
const ok = stdout => ({ code: 0, stdout, stderr: '' });
const fail = (code, stderr = 'fatal: something else') => ({ code, stdout: '', stderr });
const settle = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let n = 0; n < 6; n++) await settle(); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function prober({ atOnce = 1 } = {}) {
  const state = { ready: true }, calls = [], pending = [], timers = [];
  const host = { now: () => 0, isReady: m => m === null || state.ready,
    exec: (cmd, args, options) => { calls.push(args); return new Promise((resolve, reject) => pending.push({ resolve, reject, args })); } };
  const ids = new GitIdentities(host, { atOnce, retryMs: 1000, deadlineMs: 50 });
  return { state, calls, pending, timers, ids, after: (ms, fn) => timers.push(fn) };
}
const answer = async (p, i, result) => { p.pending[i].resolve(result); await flush(); };
const repoAt = async p => { p.ids.request([{ machine: 'edge', folder: '/x' }], p.after); await answer(p, 0, ok('/x\n')); await answer(p, 1, ok('/x/.git\n')); };

// ---- 1. Every result is checked before the next command ----

test('a resolved nonzero rev-parse stops the identity check: no second command', async () => {
  for (const [first, status] of [[fail(128, 'fatal: not a git repository (or any parent)'), 'none'], [fail(128), 'unsure'], [fail(1), 'unsure'],
    [{ stdout: '/x\n' }, 'unsure'], [{ code: 0 }, 'unsure'], [null, 'unsure']]) {
    const p = prober();
    p.ids.request([{ machine: 'edge', folder: '/x' }], p.after);
    await answer(p, 0, first);
    assert.equal(p.calls.length, 1, JSON.stringify(first));
    assert.equal(p.ids.lookup('edge', '/x').status, status, JSON.stringify(first));
  }
  // The folder check in "Open folder as Space…" too.
  for (const first of [fail(128), fail(128, 'fatal: not a git repository')]) {
    const calls = [];
    const exec = (cmd, args) => { calls.push(args); return Promise.resolve(first); };
    const r = await verifyFolder(exec, 'edge', '/x', () => {}, 50, () => true);
    assert.equal(calls.length, 1); assert.notEqual(r.status, 'repo');
  }
});

test('a failed or malformed status stops the refresh and the whole state is Unknown, never partial', async () => {
  for (const bad of [fail(128), fail(1), { code: 0 }, { stdout: '' }, null]) {
    const p = prober(); await repoAt(p);
    p.ids.request([{ machine: 'edge', folder: '/x' }], p.after); await flush();
    assert.ok(same(p.calls.at(-1), GIT_STATUS));
    await answer(p, 2, bad);
    assert.equal(p.calls.length, 3, 'branch and counts are not sent after a failed status: ' + JSON.stringify(bad));
    const e = p.ids.lookup('edge', '/x');
    assert.deepEqual([e.dirty, e.ahead, e.behind, e.branch], [null, null, null, null]);
  }
  // A later command failing also leaves no partial state.
  const p = prober(); await repoAt(p);
  p.ids.request([{ machine: 'edge', folder: '/x' }], p.after); await flush();
  await answer(p, 2, ok(' M a\n')); await answer(p, 3, fail(128));
  assert.equal(p.calls.length, 4, 'counts not sent after a failed branch query');
  const e = p.ids.lookup('edge', '/x');
  assert.deepEqual([e.dirty, e.ahead, e.behind, e.branch], [null, null, null, null]);
});

test('known answers still count: a detached HEAD and a branch with no upstream', async () => {
  const p = prober(); await repoAt(p);
  p.ids.request([{ machine: 'edge', folder: '/x' }], p.after); await flush();
  await answer(p, 2, ok(' M a\n'));
  assert.ok(same(p.calls.at(-1), GIT_BRANCH));
  await answer(p, 3, { code: 1, stdout: '', stderr: '' });                     // detached HEAD (symbolic-ref -q)
  assert.ok(same(p.calls.at(-1), GIT_COUNTS));
  await answer(p, 4, fail(128, "fatal: no upstream configured for branch 'feature'"));
  const e = p.ids.lookup('edge', '/x');
  assert.deepEqual([e.dirty, e.ahead, e.behind, e.branch], [true, null, null, null], 'dirty shown; no branch name, no arrows');
});

test('a chain cancelled by a disconnect never uses its last answer, even if the machine is back', async () => {
  const p = prober();
  p.ids.request([{ machine: 'edge', folder: '/x' }], p.after);
  await answer(p, 0, ok('/x\n'));
  assert.equal(p.calls.length, 2, 'the last command is out');
  p.ids.cancel('edge'); p.state.ready = true;          // disconnected, then back before the answer
  await answer(p, 1, ok('/x/.git\n'));
  assert.equal(p.ids.lookup('edge', '/x').status, 'unsure', 'the late answer is discarded');
});

// ---- 2. Disconnects drop queued work whatever tab is shown ----

function remoteDesk(n = 5) {
  const f = fakeHost([terminal('t1', 'idle')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  f.values.spaces = Array.from({ length: n }, (_, i) => ({ id: 'edge/s' + i, name: 'Remote ' + i, machine: 'edge', tabs: [{ id: 'edge/tab' + i }] }));
  f.values.panes = Array.from({ length: n }, (_, i) => ({ pane: 'edge/p' + i, terminal: null, tab: 'edge/tab' + i, cwd: '/srv/r' + i }));
  const execs = [];
  const exec = (cmd, args, options) => new Promise((resolve, reject) => execs.push({ cwd: options.cwd, resolve, reject }));
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, exec });
  const v = new Type(), c = context(), every = [];
  c.cx.timer.every = (ms, fn) => every.push(fn); c.cx.timer.after = () => {};
  v.init({}, c.cx); v.render(c.cx);
  return { f, v, c, execs, tick: async () => { every.forEach(fn => fn(c.cx)); await flush(); } };
}

test('the reviewer reproduction: queue, switch to Projects, Core unavailable, reconnect, a running job completes', async () => {
  const d = remoteDesk(5);
  await d.tick();
  assert.equal(d.execs.length, 4, 'four running (one command each), the fifth queued');
  d.v.controller.change({ type: 'view', view: 'projects' }); d.v.render(d.c.cx);
  d.f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'unavailable' }];
  await d.tick();
  d.f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  await d.tick();
  d.execs[0].resolve(ok('/srv/r0\n')); await flush();
  assert.equal(d.execs.length, 4, 'the old queued job does not dispatch, and the running one sends nothing more');
  assert.equal(d.execs.some(e => e.cwd === '/srv/r4'), false);
});

test('a machine missing from machines() counts as disconnected, with Spaces selected', async () => {
  const d = remoteDesk(5);
  await d.tick();
  d.f.values.machines = [{ name: null, layout: 'ready' }];
  await d.tick();
  d.f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  d.execs[1].resolve(ok('/srv/r1\n')); await flush();
  assert.equal(d.execs.some(e => e.cwd === '/srv/r4'), false, 'the queued job was dropped');
  assert.equal(d.execs.filter(e => e.cwd === '/srv/r1').length, 1, 'the running chain stopped');
});

// ---- 3. Nothing continues after the deadline ----

test('a command that answers after the deadline causes no further dispatch; the slot frees when it ends', async () => {
  // Identity: the first command answers after the deadline.
  const p = prober({ atOnce: 1 });
  p.ids.request([{ machine: 'edge', folder: '/x' }, { machine: 'edge', folder: '/y' }], p.after);
  p.timers[0](); await flush();
  assert.equal(p.ids.lookup('edge', '/x').status, 'unsure', 'Unknown at the deadline');
  assert.equal(p.calls.length, 1, 'the next place waits while the native call is still out');
  await answer(p, 0, ok('/x\n'));
  assert.equal(p.calls.filter(a => same(a, GIT_COMMON)).length, 0, 'the late answer sends no second command');
  assert.equal(p.ids.lookup('edge', '/x').status, 'unsure', 'and is not used');
  assert.equal(p.calls.length, 2, 'the next place starts now that the native work has ended');
  // State: status answers in time, the deadline passes, then counts... the reviewer's timing.
  const s = prober(); await repoAt(s);
  s.ids.request([{ machine: 'edge', folder: '/x' }], s.after); await flush();
  await answer(s, 2, ok(''));                        // status answers in time
  s.timers.at(-1)(); await flush();                  // the aggregate deadline expires
  const e = s.ids.lookup('edge', '/x');
  assert.deepEqual([e.dirty, e.ahead, e.behind, e.branch], [null, null, null, null], 'Unknown at once');
  await answer(s, 3, ok('feature\n'));               // the branch answers late
  assert.equal(s.calls.length, 4, 'ahead/behind is never dispatched');
  // The folder check: a late first answer sends no second command.
  const calls = []; let late; const timers = [];
  const exec = (cmd, args) => { calls.push(args); return new Promise(r => { late = r; }); };
  const check = verifyFolder(exec, 'edge', '/srv/repo', (ms, fn) => timers.push(fn), 50, () => true);
  await flush(); timers[0]();
  assert.deepEqual(await check, { status: 'unsure' });
  late(ok('/srv/repo\n')); await flush();
  assert.deepEqual(calls, [[...GIT_TOP]], 'no second command after the deadline');
});
