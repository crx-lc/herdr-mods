import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../controller.js';
import { publishedLocalPath } from '../local-reader.js';
import { fakeHost, fixture, prove, expanded } from './sidebar-fixtures.mjs';
function admitted() {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]), calls = [];
  const evidence = prove(f.host, { admissions: [{ address: 't1', coreId: 'core-a', verified: true, continuity: true, generation: 2,
    producer: JSON.stringify(world.producer), source: 'independent-process-and-connection' }] });
  f.host.readTextFile = async (path, options) => { assert.equal(path, '/sample/delegations.json'); assert.deepEqual(options, { on: null }); calls.push(path); return JSON.stringify(world.doc); };
  const c = new Controller(f.host, expanded); c.render(); return { ...f, ...world, c, calls, evidence };
}
test('published path permits only exact bounded local absolute paths', () => {
  for (const p of ['/sample/contract.json', 'C:/sample/contract.json']) assert.equal(publishedLocalPath(p), true);
  for (const p of ['', '/', '../contract', 'https://sample/contract', 'file:///sample/contract', '//server/share/file', '\\\\server\\file', '/sample/\nfile', 'C:\\sample\\file', 'a'.repeat(4097)]) assert.equal(publishedLocalPath(p), false, p);
});
test('admitted read uses actual reader and reducer and becomes known waiting', async () => {
  const { c, calls } = admitted(); assert.equal(await c.refresh(), true); assert.equal(calls.length, 1);
  assert.equal(c.feed.reduced.rows.find(r => r.address === 't1').roster.state, 'waiting'); assert.equal(c.feed.history[0].revision, 1);
});
test('missing identity/process/continuity/path admission causes zero reads', async () => {
  for (const mutate of [e => e.cores = [], e => e.admissions[0].continuity = false, e => e.admissions[0].producer = '{}', e => e.admissions[0].generation = 0]) {
    const { c, evidence, calls } = admitted(); mutate(evidence); c.render(); await c.refresh(); assert.equal(calls.length, 0);
  }
  const f = fakeHost([fixture().producer]), c = new Controller(f.host, expanded); c.render(); await c.refresh(); assert.equal(c.reader.outstanding, 0);
});
test('remote native file reader is never called even with verified readiness and admission', async () => {
  const { c, values, producer, evidence, calls } = admitted(); values.terminals[0].address = 'edge/t1';
  evidence.admissions[0] = { ...evidence.admissions[0], address: 'edge/t1', coreId: 'core-b', producer: JSON.stringify({ ...producer, address: 'edge/t1' }) };
  c.render(); await c.refresh(); assert.equal(calls.length, 0);
});
test('error, null, malformed, oversize text all produce no waiting and release settled slots', async () => {
  for (const value of [null, 17, '{broken', 'x'.repeat(1048577), '😀'.repeat(300000), Error('native-error')]) {
    const { host, c } = admitted(); host.readTextFile = async () => { if (value instanceof Error) throw value; return value; };
    await c.refresh(); assert.notEqual(c.feed.reduced.rows.find(r => r.address === 't1').roster.state, 'waiting'); assert.equal(c.reader.outstanding, 0);
  }
});
test('hung native calls retain slots after deadline across repeated refreshes, at most two outstanding', async () => {
  const { c, host, evidence, values } = admitted(); let calls = 0; const settles = [];
  host.readTextFile = () => { calls++; return new Promise(resolve => settles.push(resolve)); };
  host.deadline = async p => { p.catch(() => {}); throw Error('deadline'); };
  await c.refresh(); assert.equal(c.reader.outstanding, 1);
  // Admit same producer in next generation, but never allow timeout to free its native slot.
  for (let i = 1; i <= 8; i++) {
    host.now = () => 1000 + i * 10000; evidence.admissions[0].generation = i + 2; await c.refresh();
  }
  assert.equal(calls, 2); assert.equal(c.reader.outstanding, 2); assert.notEqual(c.feed.reduced.rows[0].roster.state, 'waiting');
  settles.forEach(resolve => resolve(null)); await Promise.resolve(); await Promise.resolve(); assert.equal(c.reader.outstanding, 0);
});
test('superseded generation/fingerprint and disconnect completion never resurrect documents', async () => {
  for (const kind of ['disconnect', 'producer', 'pane']) {
    const { c, host, values, doc } = admitted(); let complete;
    host.readTextFile = () => new Promise(resolve => complete = resolve);
    const read = c.refresh(); await Promise.resolve(); await Promise.resolve();
    if (kind === 'disconnect') values.machines[0].layout = 'unavailable';
    if (kind === 'producer') values.terminals[0].labels['herdr.delegations'] = '/sample/new.json';
    if (kind === 'pane') values.panes.push({ pane: 'new', terminal: 't2' });
    c.render(); complete(JSON.stringify(doc)); assert.equal(await read, false); assert.equal(c.feed.documents.length, 0);
    assert.ok(c.feed.reduced.rows.every(r => r.roster.state !== 'waiting'));
  }
});
test('reader refresh throttle creates no automatic retries', async () => {
  const { c, calls } = admitted(); await c.refresh(); await c.refresh(); assert.equal(calls.length, 1);
});

test('refresh advances generation and removes prior waiting immediately while replacement read is unsettled', async () => {
  const { c, host, evidence } = admitted(); await c.refresh(); const generation = c.feed.generation;
  assert.equal(c.feed.reduced.rows.find(r => r.address === 't1').roster.state, 'waiting');
  let complete; host.now = () => 11000; evidence.admissions[0].generation = generation + 1;
  host.readTextFile = () => new Promise(resolve => complete = resolve);
  const read = c.refresh(); assert.equal(c.feed.generation, generation + 1); assert.equal(c.feed.documents.length, 0);
  assert.ok(c.feed.reduced.rows.every(r => r.roster.state !== 'waiting')); assert.deepEqual(c.feed.navigation.routes, []);
  await Promise.resolve(); await Promise.resolve(); complete(null); await read;
  assert.equal(c.feed.history[0].revision, 1);
});
