import test from 'node:test';
import assert from 'node:assert/strict';
import { detailPages, detailFields } from '../detail.js';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
function setup() {
  const f = fakeHost([terminal('t1', 'blocked', { name: 'Sample' }), terminal('t2', 'blocked', { name: 'Sample' })]);
  const Type = createRosterView(kit, appOf(f.host), { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx);
  const render = () => view.render(c.cx), key = k => view.key({ keystroke: k }, c.cx);
  const click = (tree, id) => byId(tree, id).attributes.on_click[0]({}, c.cx);
  render(); return { ...c, f, view, render, key, click };
}
for (const id of ['mode:status', 'mode:projects', 'tools:toggle']) test('reader toolbar preserves clicked cursor and highlight: ' + id, () => {
  for (const pending of [false, true]) {
    const s = setup(), origin = s.view.controller.projection.instances.find(i => i.row?.address === 't2');
    s.view.controller.cursor = origin.key; s.render(); s.key('d');
    const tree = s.render();
    if (pending) { s.key('escape'); assert.ok(s.view.returnControl); }
    s.click(tree, id); s.key('enter'); // no stale action before render
    const result = s.render();
    assert.equal(s.view.reader, null); assert.equal(s.view.returnControl, null);
    assert.equal(s.view.controller.cursor, id);
    assert.equal(byId(result, id).attributes.bg[0], appOf(s.f.host).theme().raised);
    assert.equal(s.view.controller.state.view, id === 'mode:status' ? 'status' : 'projects');
    assert.equal(s.view.toolsOpen, id === 'tools:toggle');
    assert.equal(s.f.calls.length, 0); assert.equal(s.stats.focus, 1, 'only clicked sidebar control requests focus');
  }
});
test('Back/Esc keep exact duplicate instance; pending return is cleared by external state change', () => {
  const s = setup(), rows = s.view.controller.projection.instances.filter(i => i.row?.address === 't2');
  for (const origin of rows) for (const close of ['escape', 'back']) {
    let tree = s.render(); s.click(tree, 'info:' + origin.key); tree = s.render();
    s.f.values.terminals.splice(1, 1); s.render(); // disappear then reappear before return
    s.f.values.terminals.push(terminal('t2', 'blocked', { name: 'Sample' })); s.render();
    if (close === 'escape') s.key('escape'); else s.click(tree, 'details:back');
    s.key('enter'); s.render();
    assert.equal(s.view.controller.cursor, 'info:' + origin.key);
    assert.equal(s.view.rowScroll.requests.at(-1), s.view.controls.find(c => c.key === 'info:' + origin.key).rowIndex);
  }
  s.view.controller.cursor = rows[0].key; s.key('d'); s.render();
  s.key('escape'); assert.ok(s.view.returnControl);
  s.view.controller.change({ type: 'view', view: 'status' }); s.render();
  assert.equal(s.view.returnControl, null); assert.equal(s.view.reader, null); assert.equal(s.f.calls.length, 0);
});
const pagesOf = value => detailPages([{ id: 'x', label: 'X', value }]);
function coverage(value, pages) {
  assert.equal(pages.map(p => p.text).join(''), value);
  let offset = 0;
  for (const p of pages) {
    assert.equal(p.start, offset); assert.equal(p.end, offset + p.text.length);
    assert.equal(value.slice(p.start, p.end), p.text); offset = p.end;
    assert.ok(Array.from(p.text).length <= 64); assert.ok((p.text.match(/\r\n|[\r\n]/g) ?? []).length <= 3);
    if (value.length) assert.ok(p.text.length, 'progress, no empty continuation');
    const a = value.charCodeAt(p.end - 1), b = value.charCodeAt(p.end);
    assert.ok(!(a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff));
  }
  assert.equal(offset, value.length);
}
// Test-only independent Unicode oracle. Production remains independent of Intl.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
function feasibleBoundaries(value) {
  const pages = pagesOf(value); coverage(value, pages);
  const boundaries = new Set([...segmenter.segment(value)].map(s => s.index)); boundaries.add(value.length);
  for (const p of pages) assert.ok(boundaries.has(p.end), 'split supported grapheme at UTF-16 offset ' + p.end);
}
const tag = '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}';
test('63/64/65 boundaries preserve flags, RI parity and odd tails, tags, CRLF, combining and ZWJ', () => {
  for (const n of [0, 1, 2, 3, 62, 63, 64, 65]) for (const unit of ['🇧🇷', tag, '\r\n', 'e\u0301', '👩🏽‍💻', '❤\ufe0f']) {
    feasibleBoundaries('a'.repeat(n) + unit.repeat(40) + 'END');
  }
  for (const n of [63, 64, 65]) feasibleBoundaries('🇦'.repeat(n) + 'END');
  assert.equal(Array.from(pagesOf('a' + '🇧🇷'.repeat(40))[0].text).length, 63);
  for (const value of ['\r\n'.repeat(20), 'a\rb\rc\rd\re', 'a\nb\nc\nd\ne', 'a\r\nb\nc\rd\r\ne', 'x'.repeat(63) + '\r\nEND']) feasibleBoundaries(value);
});
test('seeded adversarial lossless fuzz and independent feasible-boundary oracle', () => {
  let seed = 7189;
  const rand = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const atoms = ['a', ' ', '\t', '界', '😀', '🇧🇷', '🇦', tag, '\r\n', '\r', '\n', 'e\u0301', '👩🏽‍💻', '❤\ufe0f'];
  for (let run = 0; run < 1500; run++) {
    let value = '';
    for (let n = rand(180); n > 0; n--) value += atoms[rand(atoms.length)];
    feasibleBoundaries(value + 'FINAL-SENTINEL');
    coverage(value + '\ud800\udc00\ud800END\udc00', pagesOf(value + '\ud800\udc00\ud800END\udc00'));
  }
});
test('oversized combining, tag and ZWJ runs use bounded lossless fallback and terminate', () => {
  for (const value of ['e' + '\u0301'.repeat(10000), '\u{1f3f4}' + '\u{e0067}'.repeat(10000) + '\u{e007f}', '👩‍'.repeat(10000)]) {
    const source = value + 'FINAL'; coverage(source, pagesOf(source)); assert.ok(pagesOf(source).at(-1).text.endsWith('FINAL'));
  }
});
test('compact row shows a bounded machine name and no unknown context; full diagnostic stays in Details/hover', () => {
  const s = setup();
  for (const mode of ['projects', 'status']) for (const alias of ['', 'edge', 'route'.repeat(200)]) {
    s.view.controller.change({ type: 'view', view: mode });
    const original = s.view.controller.render.bind(s.view.controller);
    s.view.controller.render = () => {
      const p = original(); for (const i of p.instances) if (i.row) { i.row.core.alias = alias; i.row.executionContext.label = ''; } return p;
    };
    const tree = s.render(), i = s.view.controller.projection.instances.find(i => i.row);
    const row = byId(tree, i.key);
    assert.equal(row.attributes.h[0], 24);
    const machine = byId(row, 'row-machine:' + i.key);
    assert.equal(textOf(machine), alias || 'This computer');
    assert.deepEqual(machine.attributes.max_w, [84]); assert.deepEqual(machine.attributes.min_w, [0]); assert.ok(machine.attributes.truncate);
    assert.equal(byId(row, 'row-execution-context:' + i.key), undefined, 'unknown context is not drawn');
    assert.doesNotMatch(textOf(row), /Context unknown|Route|host unknown/);
    assert.match(row.attributes.accessibility_label[0], /host unknown.*identity unverified/);
    assert.match(detailFields(i).find(f => f.id === 'machine').value, /host unknown.*identity unverified/);
    assert.equal(detailFields(i).find(f => f.id === 'provider').value, 'Unknown');
    s.view.controller.render = original;
  }
  assert.equal(s.f.calls.length, 0);
});
