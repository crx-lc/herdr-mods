import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { folderSuggestions, matchingSpace } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const ok = stdout => ({ code: 0, stdout, stderr: '' });
const NO_REPO = { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const settle = () => new Promise(r => setTimeout(r, 0));
// Folders Git knows: a main clone on edge that a Space already shows, and a local checkout.
const REPOS = { '/srv/repo': ['/srv/repo', '/srv/repo/.git'], '/srv/repo/sub': ['/srv/repo', '/srv/repo/.git'], '/home/sample/work': ['/home/sample/work', '/home/sample/work/.git'] };
function setup({ picked = '/home/sample/work', git = REPOS, hang = false } = {}) {
  const f = fakeHost([terminal('edge/t1', 'idle'), terminal('t2', 'idle')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  f.values.spaces = [{ id: 's-local', name: 'Local', machine: null, active: true, tabs: [{ id: 'tab-l' }] },
    { id: 'edge/s-repo', name: 'Repo', machine: 'edge', tabs: [{ id: 'edge/tab-r' }] }];
  f.values.panes = [{ pane: 'edge/p1', terminal: 'edge/t1', tab: 'edge/tab-r', cwd: '/srv/repo' }, { pane: 'p2', terminal: 't2', tab: 'tab-l', cwd: '/home/sample/other' }];
  f.host.run = (command, args) => f.calls.push([command, args]);
  const execs = [], picks = [];
  const exec = (cmd, args, options) => { execs.push([cmd, args, options]); if (hang) return new Promise(() => {});
    const known = git[options.cwd]; if (!known) return Promise.resolve(NO_REPO);
    return Promise.resolve(ok((args.includes('--show-toplevel') ? known[0] : known[1]) + '\n')); };
  const app = { ...appOf(f.host), home: () => '/home/sample' };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, exec, pickFolder: async o => { picks.push(o); return picked; } });
  const view = new Type(), c = context(), every = [];
  c.cx.timer.every = (ms, fn) => every.push(fn); c.cx.timer.after = () => {};
  c.cx.spawn = fn => { c.tasks.push(Promise.resolve().then(() => fn(c.cx))); };
  view.init({}, c.cx);
  return { f, view, ...c, execs, picks, every, render: () => view.render(c.cx), click: (tree, id) => byId(tree, id).attributes.on_click[0]({}, c.cx),
    learn: async () => { every.forEach(fn => fn(c.cx)); await settle(); await settle(); } };
}
// Let the picker, the spawned check and Git answers settle (the view also runs an endless command loop).
const flush = async () => { for (let n = 0; n < 6; n++) await settle(); };

test('suggestions are folders Herdr reports on that machine and verified checkouts; a match needs the same machine and checkout', () => {
  assert.deepEqual(folderSuggestions('edge', [{ pane: 'edge/p', cwd: '/a' }, { pane: 'p', cwd: '/local' }, { pane: 'other/p', cwd: '/b' }, { pane: 'edge/q', cwd: '/a' }], ['/srv/repo']), ['/srv/repo', '/a']);
  assert.deepEqual(folderSuggestions(null, [{ pane: 'p', cwd: 'C:/w' }, { pane: 'edge/p', cwd: '/a' }]), ['C:/w']);
  const spaces = [{ id: 'x', name: 'X', machine: 'edge', tabs: [{ id: 't' }] }], panes = [{ tab: 't', cwd: '/srv/repo/sub' }];
  const lookup = (m, f) => m === 'edge' && f === '/srv/repo/sub' ? { status: 'repo', top: '/srv/repo' } : null;
  assert.equal(matchingSpace('edge', '/srv/repo', spaces, panes, lookup).id, 'x');
  assert.equal(matchingSpace(null, '/srv/repo', spaces, panes, lookup), null, 'another machine is a different checkout');
  assert.equal(matchingSpace('edge', '/srv/other', spaces, panes, lookup), null);
});

test('this computer: the native picker, then machine and folder shown before anything is created', async () => {
  const s = setup(); let tree = s.render();
  s.click(tree, 'machine-add:spaces:machine:local'); tree = s.render();
  assert.equal(textOf(byId(tree, 'new-space:machine')), 'Machine: This computer');
  assert.equal(byId(tree, 'new-space:path'), undefined, 'no typed path on this computer');
  s.click(tree, 'new-space:pick'); await flush(s); tree = s.render();
  assert.deepEqual(s.picks, [{ prompt: 'Open as Space' }]);
  assert.equal(textOf(byId(tree, 'new-space:folder')), 'Folder: ~/work', 'home-relative on this computer');
  assert.match(textOf(byId(tree, 'new-space:status')), /Verified checkout: ~\/work/);
  assert.deepEqual(s.f.calls, [], 'nothing created yet');
  s.click(tree, 'new-space:create');
  assert.deepEqual(s.f.calls, [['space.new', { machine: '', folder: '/home/sample/work' }]]);
  assert.equal(s.view.newSpace, null);
});

test('a remote machine takes a typed path or a suggestion, checked on that machine', async () => {
  const s = setup(); let tree = s.render();
  s.click(tree, 'machine-add:spaces:machine:edge'); tree = s.render();
  assert.equal(textOf(byId(tree, 'new-space:machine')), 'Machine: edge');
  assert.ok(byId(tree, 'new-space:path').attributes.input, 'a path field');
  assert.equal(textOf(byId(tree, 'new-space:suggest:0')), '/srv/repo');
  assert.equal(flatten(tree).some(e => /new-space:suggest/.test(e.attributes.id?.[0] ?? '') && textOf(e) === '/home/sample/other'), false, 'no folders from another machine');
  s.view.pathInput.set_value('  /srv/brand-new  '); s.click(tree, 'new-space:check'); await flush(s); tree = s.render();
  // Git's "not a git repository" on the first command is the answer: the second is not sent.
  assert.deepEqual(s.execs.map(e => [e[2].cwd, e[2].on]), [['/srv/brand-new', 'edge']]);
  assert.equal(textOf(byId(tree, 'new-space:folder')), 'Folder: /srv/brand-new', 'remote paths as typed, trimmed');
  // Enter in the field checks too.
  s.view.pathInput.handlers.submit({}, s.cx); await flush(s);
  assert.equal(s.execs.length, 2);
});

test('Not verified never creates on the first click: a separate explicit confirmation is required', async () => {
  const s = setup(); let tree = s.render();
  s.click(tree, 'machine-add:spaces:machine:edge'); s.view.pathInput.set_value('/srv/scratch'); tree = s.render();
  s.click(tree, 'new-space:check'); await flush(s); tree = s.render();
  assert.match(textOf(byId(tree, 'new-space:status')), /^Not verified: .*may still exist/);
  assert.equal(byId(tree, 'new-space:create'), undefined);
  s.click(tree, 'new-space:unverified'); tree = s.render();
  assert.deepEqual(s.f.calls, [], 'the first click only asks');
  assert.match(textOf(byId(tree, 'new-space:confirm-text')), /Create a Space on edge in \/srv\/scratch anyway\?/);
  s.click(tree, 'new-space:confirm');
  assert.deepEqual(s.f.calls, [['space.new', { machine: 'edge', folder: '/srv/scratch' }]]);
});

test('a hung check ends at its deadline as Not verified, never a quiet create', async () => {
  const s = setup({ hang: true }); let tree = s.render();
  s.click(tree, 'machine-add:spaces:machine:edge'); s.view.pathInput.set_value('/srv/slow'); tree = s.render();
  s.cx.timer.after = (_ms, fn) => fn(); // the deadline fires; Git never answers
  s.click(tree, 'new-space:check'); await settle(); await settle(); tree = s.render();
  assert.equal(s.view.newSpace.check.status, 'unsure');
  assert.match(textOf(byId(tree, 'new-space:status')), /^Not verified/);
  assert.equal(byId(tree, 'new-space:create'), undefined); assert.deepEqual(s.f.calls, []);
});

test('an existing Space for the same machine and verified checkout is offered first; a duplicate is a separate choice', async () => {
  const s = setup(); await s.learn(); await s.learn(); let tree = s.render(); // Roster has verified the Repo Space's checkout
  s.click(tree, 'machine-add:spaces:machine:edge'); tree = s.render();
  s.click(tree, 'new-space:suggest:0'); await flush(s); tree = s.render();
  assert.equal(textOf(byId(tree, 'new-space:open-existing')).trim(), 'Open existing Space “Repo”');
  assert.equal(byId(tree, 'new-space:create'), undefined);
  const order = flatten(byId(tree, 'roster-new-space')).map(e => e.attributes.id?.[0]).filter(id => /open-existing|duplicate/.test(id ?? ''));
  assert.deepEqual(order, ['new-space:open-existing', 'new-space:duplicate'], 'open existing comes first');
  s.click(tree, 'new-space:open-existing');
  assert.deepEqual(s.f.calls, [['space.select', { id: 'edge/s-repo' }]]);
  // Again, choosing the explicit duplicate creates one.
  tree = s.render(); s.click(tree, 'machine-add:spaces:machine:edge'); tree = s.render();
  s.click(tree, 'new-space:suggest:0'); await flush(s); tree = s.render(); s.click(tree, 'new-space:duplicate');
  assert.deepEqual(s.f.calls.at(-1), ['space.new', { machine: 'edge', folder: '/srv/repo' }]);
  // A distinct worktree or another machine is not a match: plain Create Space.
  tree = s.render(); s.click(tree, 'machine-add:spaces:machine:local'); tree = s.render();
  s.click(tree, 'new-space:pick'); await flush(s); tree = s.render();
  assert.ok(byId(tree, 'new-space:create'));
});

test('Cancel, × and Esc change nothing; typing in the dialog never triggers Roster keys', async () => {
  const s = setup(); let tree = s.render();
  s.click(tree, 'machine-add:spaces:machine:edge'); tree = s.render();
  const cursor = s.view.controller.cursor, state = JSON.stringify(s.view.controller.state);
  for (const key of ['d', 'down', 'enter', 'up']) s.view.key({ keystroke: key }, s.cx);
  assert.equal(s.view.reader, null); assert.equal(s.view.controller.cursor, cursor); assert.equal(JSON.stringify(s.view.controller.state), state);
  // Surrounding rows remain usable; the form does not block Space navigation.
  s.click(tree, 'space:s-local'); assert.deepEqual(s.f.calls, [['space.select', { id: 's-local' }]]); s.f.calls.length = 0;
  s.click(tree, 'new-space:cancel'); assert.equal(s.view.newSpace, null);
  tree = s.render(); s.click(tree, 'spaces:new'); s.view.key({ keystroke: 'escape' }, s.cx);
  assert.equal(s.view.newSpace, null); assert.deepEqual(s.f.calls, []); assert.deepEqual(s.execs, []);
});
