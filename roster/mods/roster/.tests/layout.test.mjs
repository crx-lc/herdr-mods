import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutOptIn, slots } from '../layout.js';
import { desktopLayoutHost } from '../desktop.js';
function fixture() {
  const tree = { id: 'root', type: 'row', colors: { accent: '#aabbcc' }, children: [
    { id: 'agents-a', type: 'block', size: { px: 240 }, content: { mod: 'agents', props: { sample: true } } },
    { id: 'agents-b', type: 'block', content: { mod: 'agents' } },
    { id: 'quotes', type: 'block', content: { mod: 'quotr', props: { sample: 'preserve' } } }] };
  const files = new Map([['main', JSON.stringify(tree)]]), records = new Map(), calls = [];
  let current = { name: 'main', tree: structuredClone(tree) };
  const host = { current: () => structuredClone(current), readLayout: async name => files.get(name) ?? null,
    writeLayout: async (name, text, expected) => { calls.push(['write', name, expected]); assert.equal(files.get(name) ?? null, expected, 'concurrent-edit'); files.set(name, text); },
    save: async (token, text) => { calls.push(['save', token]); assert.ok(!records.has(token)); records.set(token, text); }, load: async token => records.get(token),
    switchLayout: name => { calls.push(['switch', name]); current = { name, tree: JSON.parse(files.get(name)) }; } };
  return { tree, host, files, records, calls, get current() { return current; }, set current(value) { current = value; } };
}
test('only explicitly selected Agents slot changes; CURRENT effective layout preserved before activation; source and Quotr untouched', async () => {
  const f = fixture(); f.current.tree.children[2].size = { px: 333 }; const original = structuredClone(f.current.tree);
  const a = new LayoutOptIn(f.host), selection = a.inspect(); const record = await a.enable(selection, 'agents-b', 'sample');
  assert.deepEqual(JSON.parse(f.files.get('roster-preserved-sample')), original); assert.deepEqual(JSON.parse(f.files.get('main')), f.tree);
  const next = JSON.parse(f.files.get('roster-sample')); assert.deepEqual(next.children[0], original.children[0]); assert.deepEqual(next.children[2], original.children[2]);
  assert.equal(next.children[1].content.mod, 'roster'); assert.equal(next.children[1].content.props.rosterToken, 'sample');
  assert.deepEqual(f.calls.map(c => c[0]), ['write', 'save', 'write', 'switch']); assert.equal(record.slot, 'agents-b');
});
test('undo after restart merges still-owned slot into latest tree, preserving concurrent unrelated edits', async () => {
  const f = fixture(), a = new LayoutOptIn(f.host); await a.enable(a.inspect(), 'agents-a', 'sample');
  const latest = JSON.parse(f.files.get('roster-sample')); latest.children[2].size = { px: 444 }; latest.colors.accent = '#ddeeff';
  f.files.set('roster-sample', JSON.stringify(latest)); f.current.tree = structuredClone(latest);
  await new LayoutOptIn(f.host).undo('sample'); const result = JSON.parse(f.files.get('roster-sample'));
  assert.deepEqual(result.children[0].content, f.tree.children[0].content); assert.deepEqual(result.children[2], latest.children[2]); assert.deepEqual(result.colors, latest.colors);
  assert.deepEqual(JSON.parse(f.files.get('main')), f.tree);
});
test('changed/duplicate/missing selected slot, changed layout and invalid tokens never activate', async () => {
  for (const mutate of [f => f.current.tree.children[0].content.mod = 'other', f => f.current.tree.children.push(structuredClone(f.current.tree.children[0])), f => f.current.name = 'other']) {
    const f = fixture(), a = new LayoutOptIn(f.host), selected = a.inspect(); mutate(f);
    await assert.rejects(a.enable(selected, 'agents-a', 'sample')); assert.equal(f.calls.length, 0);
  }
  const f = fixture(), a = new LayoutOptIn(f.host); await assert.rejects(a.enable(a.inspect(), 'no-slot', 'sample')); await assert.rejects(a.enable(a.inspect(), 'agents-a', '../invalid')); assert.equal(f.calls.length, 0);
});
test('concurrent disk edits during enable are detected before switch; backups remain reviewable', async () => {
  const f = fixture(), a = new LayoutOptIn(f.host), save = f.host.save;
  f.host.save = async (...args) => { await save(...args); f.files.set('main', '{"changed":true}'); };
  await assert.rejects(a.enable(a.inspect(), 'agents-a', 'sample'), /layout-changed/);
  assert.equal(f.calls.some(c => c[0] === 'switch'), false); assert.ok(f.files.has('roster-preserved-sample'));
});
test('undo refuses changed owned slot and guards expected text against concurrent write', async () => {
  for (const change of ['slot', 'disk', 'layout']) {
    const f = fixture(), a = new LayoutOptIn(f.host); await a.enable(a.inspect(), 'agents-a', 'sample');
    if (change === 'slot') f.current.tree.children[0].content.props = { changed: true };
    if (change === 'layout') f.current.name = 'main';
    if (change === 'disk') { const write = f.host.writeLayout; f.host.writeLayout = async (...args) => { f.files.set(args[0], '{"concurrent":true}'); await write(...args); }; }
    await assert.rejects(a.undo('sample')); if (change === 'disk') assert.equal(f.files.get('roster-sample'), '{"concurrent":true}');
  }
});
test('preservation failure stops before restoration record, working copy or switch', async () => {
  const f = fixture(), a = new LayoutOptIn(f.host); f.host.writeLayout = async () => { throw Error('write-error'); };
  await assert.rejects(a.enable(a.inspect(), 'agents-a', 'sample'), /write-error/); assert.equal(f.calls.length, 0);
});
test('native layout adapter uses only exact local layout filenames and private record namespace on explicit calls', async () => {
  const calls = [], host = desktopLayoutHost({ appHome: () => '/sample/app', shared: () => 'main', layout: () => ({ id: 'root' }),
    readTextFile: (...args) => calls.push(['read', ...args]), writeTextFile: (...args) => calls.push(['write', ...args]), run: (...args) => calls.push(['run', ...args]) },
  { setItem: (...args) => calls.push(['save', ...args]), getItem: (...args) => calls.push(['load', ...args]) });
  assert.equal(calls.length, 0); await host.readLayout('main'); await host.writeLayout('roster-sample', '{}', null); host.save('sample', '{}'); host.switchLayout('roster-sample');
  assert.deepEqual(calls[0], ['read', '/sample/app/layouts/main.json', { on: null }]); assert.deepEqual(calls[1], ['write', '/sample/app/layouts/roster-sample.json', '{}', null]);
  assert.deepEqual(calls[2], ['write', '/sample/app/data/roster/restoration-sample.json', '{}', null]); assert.deepEqual(calls[3], ['run', 'layout.switch', { name: 'roster-sample' }]);
});

test('layout change during final asynchronous source read is detected before switch', async () => {
  const f = fixture(), a = new LayoutOptIn(f.host), read = f.host.readLayout; let reads = 0;
  f.host.readLayout = async name => { const text = await read(name); if (++reads === 3) f.current.name = 'other'; return text; };
  await assert.rejects(a.enable(a.inspect(), 'agents-a', 'sample'), /layout-changed/); assert.equal(f.calls.some(c => c[0] === 'switch'), false);
});

test('two-second deadline failure on an unsettled preservation write prevents activation', async () => {
  const f = fixture(), a = new LayoutOptIn(f.host); let calls = 0;
  f.host.writeLayout = () => { calls++; return new Promise(() => {}); };
  const deadline = async p => { if (calls) throw Error('deadline'); return p; };
  await assert.rejects(a.enable(a.inspect(), 'agents-a', 'sample', deadline), /deadline/);
  assert.equal(f.records.size, 0); assert.equal(f.calls.some(c => c[0] === 'switch'), false);
});
