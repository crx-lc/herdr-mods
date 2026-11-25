// Parity with the project catalog contract, herdr-agents/projects v1 (crx-lc/herdr-agents#141 S5), pinned at
// crx-lc/herdr-agents b129202ea92699c88ecc42c1e9c8aca80eabc301 (contracts/projects/v1). The fixtures in
// fixtures/projects-v1/ are that folder's data with only the sample machine and project names neutralized.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assessCatalog, mergeCatalogs, FLAGS, checkPalette, contrast, catalogIcon, sha256, remoteCatalogRead, utf8, githubBoard, catalogPath, ICON_MAX } from '../catalog.js';

const V1 = new URL('./fixtures/projects-v1/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, V1), 'utf8'));
const textOf = file => (Object.hasOwn(file, 'text') ? file.text : readFileSync(new URL(file.file, V1), 'utf8'));

for (const testCase of json('reader-cases.json').cases) {
  test(`reader case: ${testCase.name}`, () => {
    // The mod's own SHA-256 is the default: each icon's hash is checked, as the contract's reader-cases require.
    const results = testCase.files.map(file => ({ machine: file.machine, result: assessCatalog({ text: textOf(file), lastRevision: file.lastRevision }) }));
    testCase.expect.files.forEach((expected, index) => {
      const { result } = results[index];
      assert.equal(result.status, expected.status, `file ${index}: ${JSON.stringify(result)}`);
      if (expected.why) assert.equal(result.why, expected.why);
      if (expected.revision !== undefined) assert.equal(result.revision, expected.revision);
      for (const [id, want] of Object.entries(expected.projects ?? {})) {
        const entry = result.projects.find(project => project.id === id);
        assert.ok(entry, `file ${index}: ${id} is listed`);
        assert.equal(entry.state, want.state, id);
        assert.deepEqual(entry.problems, want.problems, id);
        if (entry.state === 'invalid') assert.equal(entry.presentation, null, id);
      }
      if (expected.dropped) assert.deepEqual(result.dropped.map(item => item.id), expected.dropped);
    });
    const merged = mergeCatalogs(results).projects.map(group => ({ id: group.id, primary: group.primary, state: group.state, flags: group.flags,
      icon: group.presentation?.icon?.sha256 ?? null, palette: Boolean(group.presentation?.palette), cores: group.cores.map(core => core.machine) }));
    assert.deepEqual(merged, testCase.expect.merged);
    for (const group of merged) assert.deepEqual(group.flags, FLAGS.filter(flag => group.flags.includes(flag)), 'flags in FLAGS order');
  });
}

test('the pure SHA-256 agrees with node:crypto, and without a hash a wrong sha256 is not detected', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'é ∑ 𝄞', readFileSync(new URL('icons/valid-pilot.svg', V1), 'utf8')])
    assert.equal(sha256(text), createHash('sha256').update(Buffer.from(utf8(text))).digest('hex'));
  const text = readFileSync(new URL('catalogs/bad-entry.catalog.json', V1), 'utf8');
  assert.equal(assessCatalog({ text, sha256: null }).projects.find(entry => entry.id === 'wrong-hash').state, 'ok');
  assert.equal(assessCatalog({ text }).projects.find(entry => entry.id === 'wrong-hash').state, 'invalid');
});

test('palette cases: WCAG contrast and checkPalette', () => {
  const cases = json('palette-cases.json');
  for (const pair of cases.pairs) assert.equal(Math.round(contrast(pair.foreground, pair.background) * 100) / 100, pair.ratio, JSON.stringify(pair));
  for (const item of cases.palettes) assert.equal(checkPalette(item.palette).problem?.code ?? null, item.problem, item.name);
});

test('icon cases: the catalog reader agrees with the producer, including what Roster\'s wider check alone accepts', () => {
  for (const item of json('icon-cases.json').cases) {
    if (item.mode && item.mode !== '100644') continue; // a Git tree mode is the producer's concern, not a reader's
    const bytes = new Uint8Array(readFileSync(new URL(item.file, V1)));
    assert.equal(catalogIcon(bytes) === null, item.valid, item.file);
  }
  const big = utf8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' + ' '.repeat(ICON_MAX) + '</svg>');
  assert.notEqual(catalogIcon(big), null, 'above 64 KiB');
});

for (const item of json('remote-read-cases.json').cases) {
  test(`remote read (D8): ${item.name}`, async () => {
    const calls = { isReady: 0, read: 0 };
    const readiness = [...item.readiness];
    const isReady = () => { calls.isReady++; const next = readiness.shift(); if (next && typeof next === 'object' && next.throws) throw Error(next.throws); return next; };
    const read = async () => { calls.read++; if (item.read.throws) throw Error(item.read.throws); return Object.hasOwn(item.read, 'returns') ? item.read.returns : item.read.text; };
    const result = await remoteCatalogRead({ machine: 'host-b', isReady, read });
    assert.equal(result.state, item.expect.state);
    if (item.expect.reason) assert.equal(result.reason, item.expect.reason);
    assert.deepEqual(calls, item.calls);
  });
}

test('a GitHub board is used only when its URL is exactly the one its fields build', () => {
  const board = { provider: 'github-project', owner: 'sample-org', ownerType: 'organization', number: 7, url: 'https://github.com/orgs/sample-org/projects/7' };
  assert.deepEqual(githubBoard(board), { owner: 'sample-org', ownerType: 'organization', number: 7, url: board.url });
  assert.equal(githubBoard({ ...board, ownerType: 'user' }), null, 'users/… URL expected');
  assert.equal(githubBoard({ ...board, url: 'https://example.com/orgs/sample-org/projects/7' }), null);
  assert.equal(githubBoard({ ...board, number: '7' }), null);
  assert.equal(githubBoard({ ...board, provider: 'azure-boards' }), null);
  assert.equal(githubBoard(null), null);
});

test('the fixed catalog paths, by platform; none without a home', () => {
  assert.equal(catalogPath('windows', 'C:\\Users\\sample'), 'C:/Users/sample/AppData/Local/herdr-agents-data/published/projects.v1.json');
  assert.equal(catalogPath('linux', '/home/sample/'), '/home/sample/.local/share/herdr-agents/published/projects.v1.json');
  assert.equal(catalogPath('macos', '/Users/sample'), null);
  assert.equal(catalogPath('linux', ''), null);
});
