// #30: reading the project catalog per machine, registered groups by stable ID, and membership. Fixture evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogSource, ProjectIcons, labelPath } from '../catalog-source.js';
import { registeredGroups, catalogMembership, catalogNotice } from '../project-groups.js';
import { sha256 } from '../catalog.js';
import { entry, catalogText, catalogHost, clock, settle, BOARD, pilotFixture } from './projects-fixtures.mjs';

const both = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
const pilot = (overrides = {}) => entry('pilot', { primary: 'sample-org/pilot-app', board: BOARD, repositories: [
  { name: 'sample-org/pilot-app', role: 'app', primary: true, checkout: 'bound' }, { name: 'sample-org/pilot-docs', role: 'docs', primary: false, checkout: 'unbound' }], ...overrides });
async function read(answers, { machines = both, terminals = [] } = {}) {
  const t = clock(), { host, reads, hung } = catalogHost({ answers, machines, terminals, now: () => t.now });
  const source = new CatalogSource(host);
  const advance = t.advance; t.advance = ms => { advance(ms); source.tick(); };
  source.refresh(); await settle();
  return { source, reads, hung, t, sources: source.sources() };
}
const row = (address, token, extra = {}) => ({ address, core: { alias: address.includes('/') ? address.split('/')[0] : '' }, labels: token ? { 'herdr.project': token } : {}, invalidLabels: [], metadataConflict: false, ...extra });

test('this computer at its fixed path; another machine only while ready, checked before and after the one read (D8)', async () => {
  const r = await read({ local: catalogText(null, [pilot()]), edge: catalogText('edge', [pilot({ repositories: [{ name: 'sample-org/pilot-site', role: 'site', primary: false, checkout: 'bound' }, { name: 'Sample-Org/Pilot-App', role: 'app', primary: true, checkout: 'bound' }] })]) },
    { machines: [...both, { name: 'away', layout: 'unavailable' }] });
  assert.deepEqual(r.reads, [['/home/sample/.local/share/herdr-agents/published/projects.v1.json', null], ['~/.local/share/herdr-agents/published/projects.v1.json', 'edge']]);
  assert.deepEqual(r.sources.map(s => [s.machine, s.status, s.why]), [[null, 'ok', null], ['edge', 'ok', null], ['away', 'unavailable', 'not-ready']]);
  // Read again only after the interval.
  r.t.advance(30000); r.source.refresh(); await settle(); assert.equal(r.reads.length, 2);
  r.t.advance(30000); r.source.refresh(); await settle(); assert.equal(r.reads.length, 4);
});

test('one project across repositories and Cores is one group by stable ID; duplicates by name are never merged', async () => {
  const r = await read({ local: catalogText(null, [pilot(), entry('notes', { displayName: 'Pilot', mode: 'manual' })]),
    edge: catalogText('edge', [pilot({ repositories: [{ name: 'sample-org/pilot-site', role: 'site', primary: false, checkout: 'bound' }, { name: 'Sample-Org/Pilot-App', role: 'app', primary: true, checkout: 'bound' }] }),
      entry('atlas', { primary: 'sample-org/atlas-web' })]) });
  const groups = registeredGroups(r.sources);
  assert.deepEqual(groups.map(g => [g.id, g.displayName, g.cores.map(c => c.machine)]), [['atlas', 'Atlas', ['edge']], ['notes', 'Pilot', [null]], ['pilot', 'Pilot', [null, 'edge']]],
    'two projects named Pilot stay two groups; pilot on two Cores is one');
  const p = groups.find(g => g.id === 'pilot');
  assert.deepEqual(p.repositories.map(repo => [repo.name, repo.role, repo.checkouts.map(c => (c.machine ?? 'here') + ':' + c.checkout).join(' ')]),
    [['sample-org/pilot-app', 'app', 'here:bound edge:bound'], ['sample-org/pilot-docs', 'docs', 'here:unbound'], ['sample-org/pilot-site', 'site', 'edge:bound']], 'primary first, once each');
  assert.deepEqual(groups.find(g => g.id === 'notes').board, { state: 'none', board: null }, 'a manual project without a board is valid');
  assert.deepEqual(p.board.state, 'known', 'both Cores name the same board');
  const split = await read({ local: catalogText(null, [pilot()]), edge: catalogText('edge', [pilot({ board: null })]) });
  assert.deepEqual(registeredGroups(split.sources)[0].board, { state: 'unknown', board: null, why: 'cores-disagree' }, 'one Core names the board, the other none');
  // The same ID with another primary: a duplicate identity, flagged, never merged.
  const dup = await read({ local: catalogText(null, [entry('atlas', { primary: 'sample-org/atlas-server' })]), edge: catalogText('edge', [entry('atlas', { primary: 'sample-org/atlas-web' })]) });
  assert.deepEqual(registeredGroups(dup.sources).map(g => [g.primary, g.state, g.flags]), [['sample-org/atlas-server', 'invalid', ['duplicate-identity']], ['sample-org/atlas-web', 'invalid', ['duplicate-identity']]]);
});

test('membership: the terminal\'s own machine, a current catalog and exactly one entry with its token; never a name', async () => {
  const r = await read({ local: catalogText(null, [pilot()]), edge: catalogText('edge', [pilot({ board: BOARD })]) });
  const groups = registeredGroups(r.sources), member = catalogMembership(r.sources, groups);
  assert.equal(member(row('t1', 'pilot')), groups[0].key);
  assert.equal(member(row('edge/t2', 'pilot')), groups[0].key, 'the same project on the other Core joins the same group');
  assert.equal(member(row('t3', 'Pilot')), null, 'tokens are exact');
  assert.equal(member(row('t4', null, { name: 'Pilot', tabTitle: 'pilot' })), null, 'a name or title never joins');
  assert.equal(member(row('t5', 'pilot', { metadataConflict: true })), null);
  assert.equal(member(row('far/t6', 'pilot')), null, 'no catalog read from that machine');
  // A later failed read keeps the project listed (marked stale) but proves no membership.
  r.source.entries.get('edge').status = 'unavailable'; r.source.entries.get('edge').current = false;
  const stale = r.source.sources(), staleGroups = registeredGroups(stale);
  assert.equal(staleGroups[0].stale, true);
  assert.equal(catalogMembership(stale, staleGroups)(row('edge/t2', 'pilot')), null, 'stale data does not establish membership');
  assert.equal(catalogMembership(stale, staleGroups)(row('t1', 'pilot')), staleGroups[0].key);
});

test('a hung read ends at the host timer, a refused or malformed one is unavailable, and the last catalog is kept as stale', async () => {
  const t = clock(), answers = { local: catalogText(null, [pilot()]), edge: catalogText('edge', [pilot()], 4) };
  const { host, reads, hung } = catalogHost({ answers, machines: both, now: () => t.now });
  const source = new CatalogSource(host);
  const advance = t.advance; t.advance = ms => { advance(ms); source.tick(); };
  source.refresh(); await settle();
  answers.edge = 'hang'; answers.local = Error('EACCES');
  t.advance(60000); source.refresh(); await settle();
  assert.deepEqual(source.sources().map(s => [s.status, s.why, s.current, s.result?.revision]), [['unavailable', 'read-failed', false, 20], ['ok', null, true, 4]]);
  t.advance(5000); await settle();
  assert.deepEqual(source.sources().map(s => [s.status, s.why]), [['unavailable', 'read-failed'], ['unavailable', 'timeout']]);
  // Still hung: not read twice.
  answers.local = '{not json';
  t.advance(60000); source.refresh(); await settle();
  assert.equal(reads.filter(r => r[1] === 'edge').length, 2, 'the hung read is never started twice');
  assert.deepEqual(source.sources()[0], { ...source.sources()[0], status: 'unknown', why: 'unreadable', current: false });
  // A late answer from the hung read is discarded.
  hung[0].resolve(catalogText('edge', [], 9)); await settle();
  assert.equal(source.sources()[1].result.revision, 4);
  assert.equal(catalogNotice(source.sources()).kind, 'partial');
  // A revision that goes backwards is unknown; the same one again is accepted.
  answers.local = catalogText(null, [pilot()], 2); answers.edge = catalogText('edge', [pilot()], 4);
  t.advance(60000); source.refresh(); await settle();
  assert.deepEqual(source.sources().map(s => [s.status, s.why]), [['unknown', 'revision-backwards'], ['ok', null]]);
});

test('notices: loading, unavailable (Spaces only) and partial; a machine without a catalog is not an error', async () => {
  assert.equal(catalogNotice([]).kind, 'loading');
  const none = await read({ local: Error('EIO'), edge: 'hang' });
  assert.equal(catalogNotice(none.sources).kind, 'loading', 'a read still running');
  none.t.advance(5000); await settle();
  const off = catalogNotice(none.source.sources());
  assert.equal(off.kind, 'unavailable'); assert.equal(off.text, 'Project catalog unavailable · showing Spaces');
  assert.match(off.detail, /This computer: read failed; its projects are not known until its catalog is read\nedge: no answer in time;/);
  const quiet = await read({ local: catalogText(null, [pilot()]) });
  assert.deepEqual(quiet.sources.map(s => s.status), ['ok', 'unavailable']);
  assert.equal(catalogNotice(quiet.sources).kind, 'partial', 'a ready machine whose read failed');
  const missing = await read({ local: catalogText(null, [pilot()]), edge: undefined }, { machines: [{ name: null, layout: 'ready' }] });
  assert.equal(catalogNotice(missing.sources), null);
});

test('a watcher\'s herdr.projects label names the path only when exactly one valid path is on that machine', () => {
  const t = (address, path, state = 'live') => ({ address, state, labels: { 'herdr.projects': path } });
  assert.equal(labelPath([t('t1', '/data/published/projects.v1.json')], null), '/data/published/projects.v1.json');
  assert.equal(labelPath([t('t1', '/a/projects.v1.json'), t('t2', '/b/projects.v1.json')], null), null);
  assert.equal(labelPath([t('t1', 'relative/projects.v1.json'), t('edge/t2', '/edge/projects.v1.json')], null), null);
  assert.equal(labelPath([t('edge/t2', '/edge/projects.v1.json'), t('edge/t3', '/x.json', 'finished')], 'edge'), '/edge/projects.v1.json');
});

test('catalog icons: written once to the hidden cache, read back and compared before they are shown', async () => {
  const icon = pilotFixture().presentation.icon, files = new Map(), writes = [];
  const icons = new ProjectIcons({ dir: '/app/mods/roster/.cache/icons', rel: 'mods/roster/.cache/icons', mkdir: async () => {},
    readTextFile: async path => files.get(path) ?? null, writeTextFile: async (path, text, expected) => { assert.equal(expected, files.get(path) ?? null); writes.push(path); files.set(path, text); } });
  assert.equal(sha256(icon.svg), icon.sha256);
  assert.equal(icons.lookup(icon), null);
  icons.ensure(icon); icons.ensure(icon); await settle();
  assert.equal(icons.lookup(icon), icon.sha256); assert.deepEqual(writes, ['/app/mods/roster/.cache/icons/' + icon.sha256 + '.svg']);
  // A file that does not read back the same is never shown.
  const broken = new ProjectIcons({ dir: '/d', rel: 'r', mkdir: async () => {}, readTextFile: async () => '<svg/>', writeTextFile: async () => {} });
  broken.ensure(icon); await settle();
  assert.equal(broken.lookup(icon), null);
});

test('native fix (A6): a catalog that goes missing keeps its projects, flagged, with no membership; an unread machine is named', async () => {
  const t = clock(), answers = { local: catalogText(null, [pilot(), entry('notes', { mode: 'manual' })]), edge: catalogText('edge', [entry('atlas', { primary: 'sample-org/atlas-web' })]) };
  const { host } = catalogHost({ answers, machines: both, now: () => t.now });
  const source = new CatalogSource(host);
  source.refresh(); await settle();
  // This computer's file is moved away: same treatment as a remote machine that cannot be read.
  delete answers.local;
  t.now += 60000; source.refresh(); await settle();
  const sources = source.sources(), groups = registeredGroups(sources);
  assert.deepEqual(sources.map(s => [s.machine, s.status, s.current]), [[null, 'missing', false], ['edge', 'ok', true]]);
  assert.deepEqual(groups.map(g => [g.id, g.stale]), [['atlas', false], ['notes', true], ['pilot', true]], 'still listed, flagged stale');
  assert.equal(catalogMembership(sources, groups)(row('t1', 'pilot')), null, 'no membership through it');
  const notice = catalogNotice(sources);
  assert.equal(notice.kind, 'partial'); assert.equal(notice.text, 'Project catalog: This computer unavailable');
  assert.match(notice.detail, /This computer: no catalog published \(showing its last catalog, revision 20\)/);
  // After a restart Roster has no memory of a catalog it has not read in this run: a machine not connected since the
  // start is named, and its projects are not listed (none are known).
  const fresh = await read({ local: catalogText(null, [pilot()]) }, { machines: [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'unavailable' }] });
  assert.deepEqual(registeredGroups(fresh.sources).map(g => g.id), ['pilot']);
  const named = catalogNotice(fresh.sources);
  assert.equal(named.text, 'Project catalog: edge unavailable');
  assert.match(named.detail, /edge: not connected; its projects are not known until its catalog is read/);
  // This computer without a catalog file in this run is not an error (no registered project here). Another machine's
  // absent file reads as a failed read (the contract's remote reader cannot tell them apart), so it is named.
  const none = await read({ edge: catalogText('edge', [pilot()]) });
  assert.deepEqual(none.sources.map(s => [s.status, s.current]), [['missing', true], ['ok', true]]);
  assert.equal(catalogNotice(none.sources), null);
});

test('review 4 (deadline at use): a read that answers after its deadline, before any poll, is a timeout and moves no revision', async () => {
  const t = clock(), answers = { local: catalogText(null, [pilot()], 4) };
  const { host, reads, hung } = catalogHost({ answers, machines: [{ name: null, layout: 'ready' }], now: () => t.now });
  const source = new CatalogSource(host);
  source.refresh(); await settle();
  assert.deepEqual(source.sources().map(s => [s.status, s.current, s.result.revision]), [['ok', true, 4]]);
  // The next read hangs. The clock passes its 5 s deadline with no tick(), then the read answers revision 9.
  answers.local = 'hang';
  t.now += 60000; source.refresh(); await settle();
  t.now += 5001;
  hung[0].resolve(catalogText(null, [pilot(), entry('notes', { mode: 'manual' })], 9)); await settle();
  const [late] = source.sources();
  assert.deepEqual([late.status, late.why, late.current, late.result.revision], ['unavailable', 'timeout', false, 4], 'not accepted as current; the last catalog is kept as stale');
  assert.equal(source.revisions.get(null), 4, 'the revision high-water did not move');
  assert.equal(catalogMembership(source.sources(), registeredGroups(source.sources()))(row('t1', 'pilot')), null, 'no membership through it');
  source.tick();
  assert.deepEqual([source.sources()[0].status, source.sources()[0].why], ['unavailable', 'timeout'], 'the next poll finds it ended');
  // Revision 5 is therefore still a step forward (it would be "backwards" had 9 been taken), read in the freed slot.
  answers.local = catalogText(null, [pilot()], 5);
  t.now += 60000; source.refresh(); await settle();
  assert.equal(reads.length, 3);
  assert.deepEqual(source.sources().map(s => [s.status, s.why, s.current, s.result.revision]), [['ok', null, true, 5]]);
  // The boundary: the last millisecond before the deadline is in time, with no poll needed.
  answers.local = 'hang';
  t.now += 60000; source.refresh(); await settle();
  t.now += 4999;
  hung[1].resolve(catalogText(null, [pilot()], 6)); await settle();
  assert.deepEqual(source.sources().map(s => [s.status, s.current, s.result.revision]), [['ok', true, 6]]);
  assert.equal(source.revisions.get(null), 6);
});

// Review 5: a read's host call begins after an await (a microtask; for another machine, the readiness check). The
// clock is moved between refresh() and that continuation, with nothing awaited in between. Every host read here
// hangs, so a read that was started would also keep its machine's slot.
function delayed(machines) {
  const t = clock(), answers = { local: 'hang', edge: 'hang' };
  const { host, reads, hung } = catalogHost({ answers, machines, now: () => t.now });
  const source = new CatalogSource(host);
  const state = () => source.sources().map(s => [s.machine, s.status, s.why, s.current]);
  const readsOn = on => reads.filter(r => r[1] === on).length;
  return { t, answers, reads, hung, source, state, readsOn };
}
const localOnly = [{ name: null, layout: 'ready' }];

const timedOut = machines => machines.map(m => [m.name, 'unavailable', 'timeout', false]);

for (const [label, machines] of [['this computer\'s read', localOnly], ['a ready machine\'s read', both]]) {
  test(`review 5 (no start past the deadline): ${label}, dispatched an hour late with no poll, makes no host read`, async () => {
    // The app paused before the continuation ran: an hour on, no tick.
    const r = delayed(machines);
    r.source.refresh(); r.t.now += 3600000; await settle();
    assert.deepEqual(r.reads, [], 'no host read an hour past the deadline');
    assert.deepEqual(r.state(), timedOut(machines));
    assert.deepEqual([r.source.busy.size, r.source.deadlines.size], [0, 0], 'nothing was started, so every slot is free at once');
  });

  test(`review 5 (no start past the deadline): ${label}, dispatched after a poll already ended it, makes no host read`, async () => {
    // The timeout is delivered by a tick (the read is settled) before the continuation runs.
    const r = delayed(machines);
    r.source.refresh(); r.t.now += 5001; r.source.tick();
    assert.deepEqual(r.state(), timedOut(machines));
    await settle();
    assert.deepEqual(r.reads, [], 'a settled read starts nothing');
    assert.equal(r.source.busy.size, 0, 'no hung host read holds a slot');
    // The slots are free: the next refresh reads each machine once, and the catalogs are accepted.
    r.answers.local = catalogText(null, [pilot()], 4); r.answers.edge = catalogText('edge', [pilot()], 4);
    r.t.now += 60000; r.source.refresh(); await settle();
    assert.deepEqual(r.reads.map(read => read[1]), machines.map(m => m.name));
    assert.deepEqual(r.source.sources().map(s => [s.machine, s.status, s.current, s.result.revision]), machines.map(m => [m.name, 'ok', true, 4]));
    // Those catalogs are kept as stale when the next read is not started in time. Exactly at the deadline is too late.
    r.answers.local = 'hang'; r.answers.edge = 'hang';
    r.t.now += 60000; r.source.refresh(); r.t.now += 5000; await settle();
    assert.equal(r.reads.length, machines.length, 'no further host read');
    assert.deepEqual(r.source.sources().map(s => [s.machine, s.status, s.why, s.current, s.result.revision]), machines.map(m => [m.name, 'unavailable', 'timeout', false, 4]));
    assert.deepEqual([...r.source.revisions.values()], machines.map(() => 4));
  });
}

test('review 5 (controls): a read dispatched 1 ms before its deadline starts; the readiness checks around a remote read are as before', async () => {
  const machines = [{ name: null, layout: 'ready' }, { name: 'edge', layout: 'ready' }];
  const r = delayed(machines);
  r.answers.local = catalogText(null, [pilot()], 4);
  r.source.refresh(); r.t.now += 4999; await settle();
  assert.deepEqual([r.readsOn(null), r.readsOn('edge'), r.source.busy.size], [1, 1, 1], 'both started; the ready machine\'s read is still running');
  // A machine that stops being ready while its read runs is 'readiness-lost'; one that is not ready is not read.
  machines[1].layout = 'unavailable';
  r.hung[0].resolve(catalogText('edge', [pilot()], 4)); await settle();
  assert.deepEqual(r.state(), [[null, 'ok', null, true], ['edge', 'unavailable', 'readiness-lost', false]]);
  r.t.now += 60000; r.source.refresh(); await settle();
  assert.deepEqual([r.readsOn('edge'), r.state()[1]], [1, ['edge', 'unavailable', 'not-ready', false]], 'not ready: no read');
});
