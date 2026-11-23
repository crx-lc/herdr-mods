import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterView } from '../view.js';
import { parseOsRelease, machineOs, MachineOs, OS_RELEASE } from '../spaces.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const UBUNTU = 'PRETTY_NAME="Ubuntu 24.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\nLOGO=ubuntu-logo\n';
const DEBIAN = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nID=debian\n';

test('os-release parses as plain KEY=VALUE lines; nothing else is trusted', () => {
  assert.deepEqual(parseOsRelease('# comment\nID=ubuntu\r\nPRETTY_NAME="Ubuntu 24.04"\nNAME=\'Ubuntu\'\nbad line\nlower=x\nEMPTY=\nCTRL="a\u0007b"\n'),
    { ID: 'ubuntu', PRETTY_NAME: 'Ubuntu 24.04', NAME: 'Ubuntu' });
  for (const text of [null, 7, '', 'no fields here', 'x'.repeat(70000)]) assert.equal(parseOsRelease(text), null);
});

test('LOGO is only a key into the bundled map, then ID; ID_LIKE never picks the icon', () => {
  assert.deepEqual(machineOs({ release: UBUNTU }), { icon: 'os-ubuntu', tooltip: 'Ubuntu 24.04.5 LTS' });
  assert.deepEqual(machineOs({ release: DEBIAN }), { icon: 'os-debian', tooltip: 'Debian GNU/Linux 12 (bookworm)' });
  assert.equal(machineOs({ release: 'ID=ubuntu\nLOGO=debian-logo' }).icon, 'os-debian', 'a matching LOGO wins');
  for (const logo of ['../../etc/passwd', 'https://example.org/x.svg', '__proto__', 'constructor', 'os-ubuntu', 'ubuntu'])
    assert.equal(machineOs({ release: 'ID=fedora\nLOGO=' + logo }).icon, 'os-linux', logo);
  assert.equal(machineOs({ release: 'ID=linuxmint\nID_LIKE="ubuntu debian"\nPRETTY_NAME=Mint' }).icon, 'os-linux', 'ID_LIKE ignored');
  assert.deepEqual(machineOs({ release: 'ID=arch' }), { icon: 'os-linux', tooltip: 'Linux' }, 'Linux known, distro not bundled');
  assert.deepEqual(machineOs({ platform: 'windows' }), { icon: 'os-windows', tooltip: 'Windows' });
  assert.equal(machineOs({ platform: 'macos' }), null, 'no bundled icon: keep the machine icon');
  assert.equal(machineOs({}), null);
});

function cache(read) {
  const reads = [], timers = []; let now = 0;
  const os = new MachineOs({ now: () => now, readTextFile: (path, options) => { reads.push([path, options.on]); return read(path, options); } }, { retryMs: 1000, deadlineMs: 50 });
  return { os, reads, timers, after: (ms, fn) => timers.push(fn), tick: ms => { now += ms; } };
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('reads os-release once per machine, ready machines only; this computer uses its platform', async () => {
  const c = cache((_p, { on }) => Promise.resolve(on === 'edge' ? UBUNTU : on === 'deb' ? DEBIAN : null));
  c.os.request([null, 'edge', 'deb', 'plain'], 'windows', c.after); await settle();
  assert.deepEqual(c.reads, [[OS_RELEASE, 'edge'], [OS_RELEASE, 'deb'], [OS_RELEASE, 'plain']], 'never reads this Windows computer');
  assert.deepEqual([c.os.lookup(null)?.icon, c.os.lookup('edge')?.icon, c.os.lookup('deb')?.icon, c.os.lookup('plain')], ['os-windows', 'os-ubuntu', 'os-debian', null]);
  assert.equal(c.os.takeChanged(), true);
  c.tick(5000); c.os.request([null, 'edge', 'deb', 'plain'], 'windows', c.after); await settle();
  assert.equal(c.reads.length, 3, 'known and unknown answers are cached');
  const linux = cache(() => Promise.resolve(DEBIAN)); linux.os.request([null], 'linux', linux.after); await settle();
  assert.deepEqual(linux.reads, [[OS_RELEASE, null]]); assert.equal(linux.os.lookup(null).icon, 'os-debian');
  const mac = cache(() => Promise.resolve(UBUNTU)); mac.os.request([null], 'macos', mac.after); assert.deepEqual(mac.reads, []); assert.equal(mac.os.lookup(null), null);
});

test('a refused, failing or hung read keeps the machine icon and is retried later or on reconnect', async () => {
  const hung = cache(() => new Promise(() => {}));
  hung.os.request(['edge'], 'windows', hung.after); hung.timers[0](); await settle();
  assert.equal(hung.os.lookup('edge'), null);
  hung.os.request(['edge'], 'windows', hung.after); await settle(); assert.equal(hung.reads.length, 1, 'not before retryMs');
  hung.os.retry('edge'); hung.os.request(['edge'], 'windows', hung.after); await settle(); assert.equal(hung.reads.length, 2, 'reconnect retries');
  const thrown = cache(() => { throw Error('refused'); }); thrown.os.request(['edge'], 'windows', thrown.after); await settle();
  assert.equal(thrown.os.lookup('edge'), null);
  thrown.tick(1500); thrown.os.request(['edge'], 'windows', thrown.after); await settle(); assert.equal(thrown.reads.length, 2, 'retried after retryMs');
});

function view({ checking = false, read = (_p, { on }) => Promise.resolve(on === 'edge' ? UBUNTU : null) } = {}) {
  const f = fakeHost([terminal('t1')]);
  f.values.machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }, { name: 'zed', layout: 'loading' }, { name: 'plain', layout: 'ready' }];
  f.values.spaces = [{ id: 's1', name: 'Alpha', machine: null, active: true, tabs: [] }, { id: 'edge/s2', name: 'Beta', machine: 'edge', tabs: [] }];
  const reads = [];
  const app = { ...appOf(f.host), checking: () => checking, window: () => ({ platform: 'windows' }) };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, exec: null,
    readTextFile: (path, options) => { reads.push([path, options.on]); return read(path, options); } });
  const v = new Type(), c = context(), every = []; c.cx.timer.every = (ms, fn) => every.push(fn); c.cx.timer.after = () => {}; v.init({}, c.cx);
  return { v, ...c, every, reads, render: () => v.render(c.cx), poll: () => every.forEach(fn => fn(c.cx)) };
}
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
const iconOf = (tree, key) => byId(tree, 'group-icon:spaces:machine:' + key).attributes.svg[0].split('/').pop();

test('machine headers show the OS icon with PRETTY_NAME in the tooltip; +, dot and chevron unchanged', async () => {
  const s = view();
  let tree = s.render();
  assert.deepEqual(['local', 'edge', 'zed', 'plain'].map(k => iconOf(tree, k)), ['monitor.svg', 'server.svg', 'server.svg', 'server.svg'], 'before any answer');
  s.poll(); await settle(); await settle(); s.poll(); tree = s.render();
  assert.deepEqual(s.reads, [[OS_RELEASE, 'edge'], [OS_RELEASE, 'plain']], 'not this Windows computer, not the loading machine');
  assert.deepEqual(['local', 'edge', 'zed', 'plain'].map(k => iconOf(tree, k)), ['os-windows.svg', 'os-ubuntu.svg', 'server.svg', 'server.svg']);
  assert.equal(byId(tree, 'spaces:machine:edge').attributes.tooltip[0], 'edge · Ubuntu 24.04.5 LTS · connected');
  assert.equal(byId(tree, 'spaces:machine:local').attributes.tooltip[0], 'This computer · Windows');
  const ids = el => el.children.map(e => e.attributes.id?.[0]);
  assert.deepEqual(ids(byId(tree, 'spaces:machine:edge')), ['group-icon:spaces:machine:edge', 'group-label:spaces:machine:edge',
    'machine-add:spaces:machine:edge', 'machine-state:spaces:machine:edge', 'group-chevron:spaces:machine:edge']);
  assert.deepEqual(s.f?.calls ?? [], []);
});

test('no reads under herdr-app check or outside Spaces', async () => {
  const k = view({ checking: true }); assert.equal(k.every.length, 0); k.render(); assert.deepEqual(k.reads, []);
  const p = view(); p.v.controller.change({ type: 'view', view: 'projects' }); p.poll(); await settle(); assert.deepEqual(p.reads, []);
});
