// Issue #36: "Open folder as Space…" on This computer could stay at "Checking…". The folder picker answers after the
// click's handler has returned, and the old code began the check with that ended cx. These tests click with a cx that
// dies when its handler returns (eventCx), as Herdr's does, and cover every outcome of the check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView, FOLDER_CHECK_LIMIT_MS } from '../view.js';
import { verifyFolder, folderReason } from '../spaces.js';
import { spawnNow, fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, eventCx } from './sidebar-fixtures.mjs';

const ok = stdout => ({ code: 0, stdout, stderr: '' });
const NO_REPO = { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' };
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const settle = () => new Promise(r => setTimeout(r, 0));
const flush = async () => { for (let n = 0; n < 8; n++) await settle(); };
// A neutral Windows checkout: the picker gives backslashes, Git answers with forward slashes.
const PICKED = 'C:\\work\\sample';
const REPO = { top: 'C:/work/sample', common: 'C:/work/sample/.git' };
const KNOWN = new Set([PICKED, REPO.top]);

function setup({ picked = PICKED, spaceHere = false } = {}) {
  const f = fakeHost([terminal('t2', 'idle')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }]; // the + beside This computer needs a machine header
  f.values.spaces = [{ id: 's-local', name: 'Sample', machine: null, active: true, tabs: [{ id: 'tab-l' }] }];
  f.values.panes = [{ pane: 'p2', terminal: 't2', tab: 'tab-l', cwd: spaceHere ? REPO.top : 'C:/work/other' }];
  f.host.run = (command, args) => f.calls.push([command, args]);
  let clock = 1000; f.host.now = () => clock;
  // mode: 'git' answers like Git; 'hang' never answers; or a function(cmd, args, options) for one-off answers.
  const s = { mode: 'git', execs: [], pending: [] };
  const exec = (cmd, args, options) => {
    s.execs.push([cmd, args, options]);
    if (s.mode === 'hang') return new Promise(resolve => s.pending.push(resolve));
    if (typeof s.mode === 'function') return s.mode(cmd, args, options);
    if (!KNOWN.has(options.cwd)) return Promise.resolve(NO_REPO);
    return Promise.resolve(ok((args.includes('--show-toplevel') ? REPO.top : REPO.common) + '\n'));
  };
  const app = { ...appOf(f.host), home: () => 'C:\\Users\\sample' };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, exec,
    pickFolder: async () => { await settle(); return picked; } });
  const view = new Type(), c = context(), every = [], afters = [];
  c.cx.timer.every = (ms, fn) => every.push(fn);
  // The check's own race timer: kept, fired only when a test says so.
  c.cx.timer.after = (ms, fn) => afters.push(fn);
  c.cx.spawn = fn => { c.tasks.push(spawnNow(fn, c.cx)); };
  view.init({}, c.cx);
  const render = () => view.render(c.cx);
  // A click as Herdr delivers it: the handler's cx ends when the handler returns.
  const click = id => { const cx = eventCx(c.cx); const el = byId(render(), id); assert.ok(el, 'no control ' + id); el.attributes.on_click[0]({}, cx); cx.end(); };
  const tick = () => { const cx = eventCx(c.cx); every.forEach(fn => fn(cx)); cx.end(); };
  const status = () => textOf(byId(render(), 'new-space:status'));
  return Object.assign(s, { f, view, ...c, every, afters, render, click, tick, status,
    advance: ms => { clock += ms; }, learn: async () => { tick(); await flush(); } });
}
const open = async s => { s.click('machine-add:spaces:machine:local'); s.click('new-space:pick'); await flush(); };

test('valid local checkout picked on Windows: the check finishes and offers Create Space (failed before #36)', async () => {
  const s = setup(); s.render();
  await open(s);
  assert.equal(s.view.newSpace.check.status, 'repo', 'not stuck at Checking…');
  assert.deepEqual(s.execs.map(e => [e[2].cwd, e[2].on]), [[PICKED, null], [PICKED, null]], 'both identity queries ran here');
  assert.match(s.status(), /^Verified checkout: C:\/work\/sample/);
  assert.deepEqual(s.f.calls, [], 'nothing created before the explicit choice');
  s.click('new-space:create');
  assert.deepEqual(s.f.calls, [['space.new', { machine: '', folder: PICKED }]]);
  assert.equal(s.view.newSpace, null);
});

test('valid local checkout that a Space already shows: Open existing Space comes first', async () => {
  const s = setup({ spaceHere: true }); s.render();
  await s.learn(); await s.learn(); // Roster has verified the Space's own folder
  await open(s);
  assert.equal(textOf(byId(s.render(), 'new-space:open-existing')).trim(), 'Open existing Space “Sample”');
  assert.equal(byId(s.render(), 'new-space:create'), undefined);
  s.click('new-space:open-existing');
  assert.deepEqual(s.f.calls, [['space.select', { id: 's-local' }]]);
});

test('a folder that is not a checkout: says so, offers Check again, and creates only after confirmation', async () => {
  const s = setup({ picked: 'C:\\work\\plain' }); s.render();
  await open(s);
  assert.equal(s.status(), 'Not verified: Git says this folder is not a checkout. The folder may still exist.');
  assert.ok(byId(s.render(), 'new-space:retry')); assert.ok(byId(s.render(), 'new-space:cancel'));
  assert.equal(byId(s.render(), 'new-space:create'), undefined);
  s.click('new-space:unverified'); assert.deepEqual(s.f.calls, []);
  s.click('new-space:confirm');
  assert.deepEqual(s.f.calls, [['space.new', { machine: '', folder: 'C:\\work\\plain' }]]);
});

test('a check that never settles leaves Checking… within the limit, says why, and Check again can succeed (failed before #36)', async () => {
  const s = setup(); s.render(); s.mode = 'hang';
  await open(s);
  assert.equal(s.status(), 'Checking…');
  s.advance(FOLDER_CHECK_LIMIT_MS - 1000); s.tick(); await flush();
  assert.equal(s.status(), 'Checking…', 'not before the limit');
  // Neither Git nor the check's own timer ever answers: the view's clock ends it.
  s.advance(1000); s.tick(); await flush();
  assert.equal(s.status(), 'Not verified: Git did not answer in time. The folder may still exist.');
  assert.ok(FOLDER_CHECK_LIMIT_MS <= 15000, 'bounded');
  assert.equal(byId(s.render(), 'new-space:create'), undefined); assert.deepEqual(s.f.calls, []);
  // The hung answer arriving late changes nothing.
  const hung = s.pending.splice(0); hung.forEach(r => r(ok(REPO.top + '\n'))); await flush();
  assert.equal(s.view.newSpace.check.status, 'unsure');
  // Retry, with Git answering now.
  s.mode = 'git'; s.click('new-space:retry'); await flush();
  assert.equal(s.view.newSpace.check.status, 'repo');
  assert.ok(byId(s.render(), 'new-space:create'));
});

test('the check\'s own deadline ends a hung Git call as "did not answer in time"', async () => {
  const s = setup(); s.render(); s.mode = 'hang';
  await open(s);
  assert.equal(s.afters.length, 1, 'one race timer'); s.afters[0](); await flush();
  assert.equal(s.status(), 'Not verified: Git did not answer in time. The folder may still exist.');
});

test('errors say why and leave Checking…: Git missing, Herdr\'s exec timeout, a Git refusal, a malformed answer', async () => {
  const cases = [
    [() => Promise.reject(Error('running `git` failed: executable was not found on the host PATH')), 'Git did not run (is Git installed?)'],
    [() => Promise.reject(Error('`git` timed out after 12000 ms')), 'Git did not answer in time'],
    [() => Promise.resolve({ code: 128, stdout: '', stderr: "fatal: detected dubious ownership in repository at 'C:/work/sample'\nTo add an exception…\n" }),
      "Git could not read this folder (fatal: detected dubious ownership in repository at 'C:/work/sample')"],
    [() => Promise.resolve(ok('')), 'Git gave an answer Roster could not read'],
    [() => Promise.resolve(null), 'Git gave an answer Roster could not read'],
    [() => { throw Error('exec threw'); }, 'Git did not run (is Git installed?)'],
  ];
  for (const [answer, why] of cases) {
    const s = setup(); s.render(); s.mode = answer;
    await open(s);
    assert.equal(s.status(), 'Not verified: ' + why + '. The folder may still exist.', why);
    assert.ok(byId(s.render(), 'new-space:retry'), why); assert.ok(byId(s.render(), 'new-space:cancel'), why);
    assert.deepEqual(s.f.calls, [], why);
  }
});

test('Cancel while checking creates and opens nothing, and a late answer does not bring the panel back', async () => {
  const s = setup(); s.render(); s.mode = 'hang';
  await open(s);
  assert.equal(s.status(), 'Checking…');
  s.click('new-space:cancel');
  assert.equal(s.view.newSpace, null);
  s.pending.splice(0).forEach(r => r(ok(REPO.top + '\n'))); s.advance(FOLDER_CHECK_LIMIT_MS); s.tick(); await flush();
  assert.equal(s.view.newSpace, null); assert.deepEqual(s.f.calls, []);
  assert.equal(byId(s.render(), 'roster-new-space'), undefined);
});

test('a retry replaces the earlier check: only the newest answer is shown', async () => {
  const s = setup({ picked: 'C:\\work\\plain' }); s.render();
  await open(s);
  s.mode = 'hang'; s.click('new-space:retry'); await flush();
  const first = s.pending.splice(0);
  s.mode = 'git'; s.view.checkFolder(PICKED, eventCx(s.cx)); await flush();
  assert.equal(s.view.newSpace.check.status, 'repo');
  first.forEach(r => r(NO_REPO)); await flush();
  assert.equal(s.view.newSpace.check.status, 'repo', 'the stale answer is ignored');
});

test('verifyFolder always settles with a reason when it cannot verify', async () => {
  const after = () => {};
  assert.deepEqual(await verifyFolder(() => Promise.resolve(NO_REPO), null, 'C:\\x', after, 50), { status: 'none' });
  assert.equal((await verifyFolder(() => Promise.reject(Error('boom')), null, 'C:\\x', after, 50)).reason, 'git-unavailable');
  let t = 0; const late = () => { t += 60; return Promise.reject(Error('closed')); };
  assert.equal((await verifyFolder(late, null, 'C:\\x', after, 50, null, () => t)).reason, 'timeout', 'a rejection at the call\'s own timeout');
  assert.equal(folderReason({ status: 'unsure' }), 'Git did not confirm a checkout here');
  assert.equal(folderReason({ status: 'none' }), 'Git says this folder is not a checkout');
});
