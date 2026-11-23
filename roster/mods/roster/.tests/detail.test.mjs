import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { detailFields, detailPages, rowContext, detailLabel } from '../detail.js';
import { createRosterView } from '../view.js';
import { fakeHost, terminal, fixture, prove, route, settings, kit, context, appOf, flatten, textOf, layoutHostUnused, expanded } from './sidebar-fixtures.mjs';
const byId = (tree, id) => flatten(tree).find(e => e.attributes.id?.[0] === id);
function setup(f = fakeHost(), props = {}) {
  const app = appOf(f.host); app.props = () => props;
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, ...expanded });
  const view = new Type(), c = context(); view.init({}, c.cx); view.render(c.cx);
  return { f, view, ...c };
}
const item = (view, address = 't1') => view.controller.projection.instances.find(i => i.kind === 'terminal' && i.row.address === address);
const key = (s, chord) => s.view.key({ keystroke: chord }, s.cx);
const click = (s, tree, id) => byId(tree, id).attributes.on_click[0]({}, s.cx);
const fieldsOf = reader => Object.fromEntries(reader.fields.map(f => [f.id, f.value]));
function assertPages(fields, pages) {
  for (const [index, field] of fields.entries()) {
    const spans = pages.filter(p => p.fieldIndex === index);
    assert.ok(spans.length, 'missing field ' + field.id);
    assert.equal(spans.map(p => p.text).join(''), field.value, 'lossless field ' + field.id);
    let offset = 0;
    for (const [j, p] of spans.entries()) {
      assert.equal(p.start, offset); assert.equal(p.end, offset + p.text.length);
      assert.equal(field.value.slice(p.start, p.end), p.text);
      assert.equal(p.fieldPage, j + 1); assert.equal(p.fieldPages, spans.length);
      assert.ok(Array.from(p.text).length <= 64);
      assert.ok(p.text.split('\n').length <= 4);
      assert.doesNotMatch(p.text, /^[\udc00-\udfff]|[\ud800-\udbff]$/u);
      offset = p.end;
    }
    assert.equal(offset, field.value.length);
  }
}
test('lossless Unicode, whitespace, empty, newline and unbroken pages preserve each source span and terminal sentinel', () => {
  const values = ['', ' ', '\n'.repeat(20), 'a\n\n\nb\n\n\n\n\n\nEND', '界'.repeat(500) + 'FINAL',
    '👩🏽‍💻'.repeat(100) + 'LAST', 'e\u0301'.repeat(100) + 'END', 'word '.repeat(200) + 'SENTINEL',
    'x'.repeat(4096) + 'TERMINAL', '\r\n'.repeat(12) + 'END', 'اَلْعَرَبِيَّةُ'.repeat(100)];
  const fields = values.map((value, i) => ({ id: String(i), label: String(i), value }));
  assertPages(fields, detailPages(fields));
});
test('pure presentation runs without Intl or host globals', () => {
  const source = readFileSync(new URL('../detail.js', import.meta.url), 'utf8').replaceAll('export ', '');
  const sandbox = vm.createContext({ Intl: undefined });
  const pages = vm.runInContext(source + "\ndetailPages([{id:'sample',label:'Sample',value:'界😀'.repeat(90)+'END'}])", sandbox);
  assert.equal(pages.map(p => p.text).join(''), '界😀'.repeat(90) + 'END');
  assert.ok(pages.every(p => Array.from(p.text).length <= 64));
});
test('truthful project, verified parent, host vs route, context, provider, reason and diagnostic fields', () => {
  const s = setup(), i = item(s.view);
  assert.match(rowContext(i).machine, /Local route \(host unknown\).*identity unverified/);
  assert.equal(rowContext(i).project, 'Unassigned'); assert.equal(rowContext(i).parent, 'Not reported');
  i.row.project = { displayName: '', id: null, resolution: 'unbound' };
  i.context.parentResolution = 'missing'; i.context.parent = null;
  i.row.core = { alias: 'edge', verified: true, hostLabel: null };
  i.row.executionContext.label = '';
  let fields = Object.fromEntries(detailFields(i).map(f => [f.id, f.value]));
  assert.equal(fields.project, 'Unassigned (unbound)'); assert.equal(fields.parent, 'Unknown (missing)');
  assert.equal(fields.machine, 'Route edge (host unknown)'); assert.equal(fields.context, 'Context unknown');
  assert.equal(fields.provider, 'Unknown'); assert.ok(fields.diagnostic);
  i.context.parent = { displayLabel: 'Verified parent' }; i.row.core.hostLabel = 'Sample host';
  i.row.providerBadge = { accessibleName: 'Azure DevOps' };
  i.navigation = { enabled: false, reason: 'context-only' }; i.outsideFilters = ['context-outside-filter'];
  fields = Object.fromEntries(detailFields(i).map(f => [f.id, f.value]));
  assert.equal(fields.parent, 'Verified parent'); assert.equal(fields.machine, 'Sample host · Route edge');
  assert.equal(fields.availability, 'Context for a child that needs you'); assert.equal(fields.filters, 'context-outside-filter');
  assert.equal(fields.provider, 'Azure DevOps'); assert.match(detailLabel(i), /Verified parent/);
  assert.equal(s.f.calls.length, 0);
});
test('compact row keeps known project as a monogram only; parent/project read in Info, a sibling with exact owner and row index', () => {
  const f = fakeHost([terminal('t1', 'idle', { labels: { 'herdr.role': 'coordinator' } }),
    terminal('t2', 'blocked', { parent: 't1', labels: { 'herdr.project': 'sample', 'herdr.role': 'developer' } })]);
  prove(f.host, { settings }); const s = setup(f);
  for (const mode of ['projects', 'status']) {
    s.view.controller.change({ type: 'view', view: mode }); const tree = s.view.render(s.cx), i = item(s.view, 't2');
    const el = byId(tree, i.key), body = byId(tree, 'roster-rows');
    assert.equal(el.attributes.h[0], 24);
    assert.ok(flatten(el).some(e => e.attributes.accessibility_label?.[0] === 'Sample project project icon fallback'));
    assert.doesNotMatch(textOf(el), /Project:|Parent:|Context unknown/);
    assert.match(el.attributes.accessibility_label[0], /Project: Sample project.*Parent: Coordinator/);
    assert.equal(byId(el, 'info:' + i.key), undefined, 'Info must not bubble into terminal activation');
    const control = s.view.controls.find(c => c.key === 'info:' + i.key);
    assert.equal(control.instance.key, i.key);
    assert.ok(byId(body.children[control.rowIndex], control.key));
    click(s, tree, control.key); assert.equal(s.view.reader.sourceKey, i.key);
    assert.equal(fieldsOf(s.view.reader).parent, 'Coordinator');
    assert.equal(f.calls.length, 0); key(s, 'escape'); s.view.render(s.cx);
  }
});
test('keyboard reader walks every field/page, reverses, Home/End and Esc reveal the same enabled row without activation', () => {
  const f = fakeHost(); prove(f.host, { routes: [route('core-a', 't1', 't1')] });
  const s = setup(f), i = item(s.view); assert.ok(i.navigation.enabled);
  // Long literal values include suffixes so losing a final page cannot pass.
  const render = s.view.controller.render.bind(s.view.controller);
  s.view.controller.render = () => {
    const p = render(); const row = p.instances.find(i => i.kind === 'terminal');
    row.row.displayLabel = 'same name '.repeat(30) + 'NAME-END';
    row.row.executionContext.label = '界😀\n\n'.repeat(50) + 'CONTEXT-END';
    return p;
  };
  s.view.render(s.cx); s.view.controller.cursor = i.key; key(s, 'd');
  const reader = s.view.reader; assert.equal(reader.sourceKey, i.key);
  const texts = [];
  for (let n = 0; n < reader.pages.length; n++) {
    const tree = s.view.render(s.cx); assert.match(textOf(tree), /Details at opening/);
    const value = byId(tree, 'roster-detail-value'); assert.equal(textOf(value), reader.pages[n].text);
    assert.ok(value.attributes.w_full); assert.ok(value.attributes.whitespace_normal);
    for (const e of flatten(tree)) if (flatten(e).includes(value)) {
      for (const forbidden of ['truncate', 'text_ellipsis', 'line_clamp', 'overflow_hidden']) assert.equal(e.attributes[forbidden], undefined);
    }
    assert.equal(byId(tree, 'roster-rows'), undefined); assert.equal(s.view.controls.length, 0);
    texts.push({ ...reader.pages[n], text: textOf(value) }); key(s, 'right');
  }
  assertPages(reader.fields, texts); assert.equal(reader.page, reader.pages.length - 1);
  key(s, 'home'); assert.equal(reader.page, 0); key(s, 'left'); assert.equal(reader.page, 0);
  key(s, 'end'); assert.equal(reader.page, reader.pages.length - 1);
  for (let n = reader.pages.length - 1; n > 0; n--) { key(s, 'up'); assert.equal(reader.page, n - 1); }
  s.view.render(s.cx); key(s, 'enter'); assert.equal(reader.page, 1); assert.equal(f.calls.length, 0);
  const before = s.stats.stop; key(s, 'ctrl-c'); assert.equal(s.stats.stop, before);
  key(s, 'escape'); s.view.render(s.cx); assert.equal(s.view.controller.cursor, i.key);
  assert.equal(s.view.rowScroll.requests.at(-1), s.view.controls.find(c => c.key === i.key).rowIndex);
  assert.equal(f.calls.length, 0); key(s, 'enter'); assert.deepEqual(f.calls, [['terminal.peek', { terminal: 't1' }]]);
});
test('pointer paging and footer Details expose the same snapshot and do not activate terminal', () => {
  const s = setup(); const i = item(s.view); s.view.controller.cursor = i.key;
  let tree = s.view.render(s.cx); click(s, tree, 'details:open'); const reader = s.view.reader;
  const texts = [];
  for (let n = 0; n < reader.pages.length; n++) {
    tree = s.view.render(s.cx); texts.push({ ...reader.pages[n], text: textOf(byId(tree, 'roster-detail-value')) });
    click(s, tree, 'details:next');
  }
  assertPages(reader.fields, texts); tree = s.view.render(s.cx);
  click(s, tree, 'details:previous'); assert.equal(reader.page, reader.pages.length - 2);
  click(s, s.view.render(s.cx), 'details:back'); s.view.render(s.cx);
  assert.equal(s.view.controller.cursor, 'details:open'); assert.equal(s.f.calls.length, 0);
  key(s, 'enter'); assert.ok(s.view.reader); assert.equal(s.f.calls.length, 0);
});
test('same-name rows keep distinct instance snapshots, background disappearance never rebinds by label', () => {
  const f = fakeHost([terminal('t1', 'blocked', { name: 'Identical' }), terminal('t2', 'blocked', { name: 'Identical' })]);
  const s = setup(f), first = item(s.view), second = item(s.view, 't2');
  assert.equal(first.row.displayLabel, second.row.displayLabel); assert.notEqual(first.key, second.key);
  let tree = s.view.render(s.cx); click(s, tree, 'info:' + second.key);
  assert.equal(s.view.reader.sourceKey, second.key);
  const snapshot = JSON.stringify(s.view.reader.fields);
  f.values.terminals[1].name = 'Changed'; s.view.render(s.cx);
  assert.equal(JSON.stringify(s.view.reader.fields), snapshot);
  f.values.terminals.splice(1); s.view.render(s.cx); key(s, 'escape'); s.view.render(s.cx);
  assert.equal(s.view.controller.cursor, 'mode:projects'); assert.equal(f.calls.length, 0);
  tree = s.view.render(s.cx); click(s, tree, 'info:' + first.key); key(s, 'escape'); s.view.render(s.cx);
  assert.equal(s.view.controller.cursor, 'info:' + first.key);
  assert.equal(s.view.rowScroll.requests.at(-1), s.view.controls.find(c => c.key === first.key).rowIndex);
});
test('D on Info/fold, Enter on Info, and reader Enter immediately after opening cannot use stale terminal actions', () => {
  const f = fakeHost([terminal('t1'), terminal('t2', 'working', { parent: 't1' })]);
  prove(f.host, { routes: [route('core-a', 't1', 't1')] }); const s = setup(f), i = item(s.view);
  for (const prefix of ['', 'info:', 'fold:']) {
    s.view.render(s.cx); s.view.controller.cursor = prefix + i.key; key(s, 'd');
    assert.equal(s.view.reader.sourceKey, i.key); key(s, 'enter'); assert.equal(f.calls.length, 0);
    s.view.render(s.cx); key(s, 'enter'); assert.equal(f.calls.length, 0);
    key(s, 'escape'); s.view.render(s.cx); assert.equal(s.view.controller.cursor, prefix + i.key);
  }
  s.view.controller.cursor = 'info:' + i.key; key(s, 'enter'); assert.ok(s.view.reader); assert.equal(f.calls.length, 0);
});
test('view, filter, fold and Options changes close locally; normal unhandled keys keep host behavior and no autofocus', () => {
  for (const event of [{type:'view',view:'status'}, {type:'filters',coreIds:[]}, {type:'fold',key:'sample',collapsed:true}]) {
    const s = setup(); const i = item(s.view); assert.equal(s.stats.focus, 0);
    const before = s.stats.stop; key(s, 'd'); key(s, 'left'); assert.equal(s.stats.stop, before);
    s.view.controller.cursor = i.key; key(s, 'd'); s.view.render(s.cx);
    s.view.controller.change(event); s.view.render(s.cx); assert.equal(s.view.reader, null); assert.equal(s.f.calls.length, 0);
  }
  const s = setup(); s.view.controller.cursor = item(s.view).key; key(s, 'd');
  click(s, s.view.render(s.cx), 'tools:toggle'); s.view.render(s.cx);
  assert.equal(s.view.reader, null); assert.ok(s.view.toolsOpen); assert.equal(s.f.calls.length, 0);
});
for (const collapsed of [false, true]) test(`full waiting/context/reason reader and tooltip with children ${collapsed ? 'hidden' : 'expanded compact'}`, () => {
  const world = fixture(), f = fakeHost([world.producer, ...world.children]);
  prove(f.host, { settings, documents: [{ producer: world.producer, text: JSON.stringify(world.doc), generation: 1 }] });
  const s = setup(f); const parent = item(s.view); s.view.controller.change({ type:'fold', key:parent.key, collapsed });
  const render = s.view.controller.render.bind(s.view.controller), waiting = 'waiting '.repeat(100) + 'WAIT-END';
  s.view.controller.render = () => {
    const p = render(); for (const i of p.instances) if (i.row?.roster.state === 'waiting') i.display.detail = waiting; return p;
  };
  const tree = s.view.render(s.cx), i = item(s.view); assert.equal(i.display.compact, !collapsed);
  const tooltip = byId(tree, i.key).attributes.accessibility_label[0];
  for (const value of [waiting, 'Project: Sample project', 'Parent: Not reported', 'Context unknown', 'current route is unverified']) assert.ok(tooltip.includes(value));
  s.view.controller.cursor = i.key; key(s, 'd');
  assert.equal(fieldsOf(s.view.reader).waiting, waiting); assert.match(fieldsOf(s.view.reader).availability, /current route is unverified/);
  assertPages(s.view.reader.fields, s.view.reader.pages); assert.equal(f.calls.length, 0);
});
test('many machine/context options, resets, slot choices and final undo all retain direct indices after shrink', () => {
  const f = fakeHost(Array.from({length:12}, (_, n) => terminal('t' + (n + 1).toString(36))));
  const cfg = JSON.parse(settings); cfg.contexts = f.values.terminals.map(t => ({coreId:'core-a',terminalId:t.address,incarnation:100,id:'ctx-'+t.address,label:'Context '+t.address,source:'verified'}));
  prove(f.host, { settings: JSON.stringify(cfg) }); const s = setup(f, {rosterToken:'neutral-token'});
  s.view.toolsOpen = true; s.view.selection = {slots:Array.from({length:8}, (_,n)=>({id:'slot-'+n}))};
  let tree = s.view.render(s.cx); const tools = byId(tree, 'roster-options'), options = s.view.controls.filter(c=>c.optionIndex != null);
  assert.ok(options.length > 20); assert.equal(options.at(-1).key, 'layout:undo');
  assert.equal(tools.attributes.h[0], 52); assert.equal(tools.attributes.max_h, undefined); assert.ok(tools.attributes.min_h);
  s.view.controller.cursor = null;
  for (const c of s.view.controls) {
    key(s, 'down'); if(c.optionIndex != null) { assert.equal(s.view.optionsScroll.requests.at(-1), c.optionIndex); assert.equal(tools.children[c.optionIndex].attributes.id[0], c.key); }
  }
  s.view.controller.cursor = options.at(-1).key; s.view.selection = null; f.values.terminals = []; tree = s.view.render(s.cx);
  const current = s.view.controls.filter(c=>c.optionIndex != null);
  assert.equal(s.view.controller.cursor, 'layout:undo'); assert.ok(current.length < options.length);
  assert.equal(current.at(-1).optionIndex, current.length - 1); assert.equal(f.calls.length, 0);
});
test('every mandatory field has independent complete pages including suffixes and truthful unresolved parent cases', () => {
  const s = setup(), i = item(s.view);
  i.row.displayLabel = 'name'.repeat(80) + 'NAME-END';
  i.row.project = { displayName: 'project'.repeat(80) + 'PROJECT-END', id:'sample' };
  i.context.parent = { displayLabel: 'parent'.repeat(80) + 'PARENT-END' };
  i.row.core = { alias:'edge', verified:true, hostLabel:'host'.repeat(80) + 'HOST-END' };
  i.row.executionContext.label = 'context'.repeat(80) + 'CONTEXT-END';
  i.row.providerBadge = { accessibleName:'provider'.repeat(80) + 'PROVIDER-END' };
  i.row.roster.state = 'waiting'; i.display.detail = 'waiting'.repeat(80) + 'WAIT-END';
  i.display.error = 'error'.repeat(80) + 'STATE-END';
  i.navigation = { enabled:false, reason:'reason'.repeat(80) + 'REASON-END' };
  i.identityDiagnostic = 'diagnostic'.repeat(80) + 'DIAGNOSTIC-END';
  i.outsideFilters = ['filter'.repeat(80) + 'FILTER-END'];
  const fields = detailFields(i);
  assert.deepEqual(fields.map(f => f.id), ['name','project','repository','parent','machine','context','state','waiting','provider','availability','filters','diagnostic']);
  const values = Object.fromEntries(fields.map(f=>[f.id,f.value]));
  for (const [id, suffix] of [['name','NAME-END'],['project','PROJECT-END'],['parent','PARENT-END'],['machine','HOST-END'],['context','CONTEXT-END'],['state','STATE-END'],['waiting','WAIT-END'],['provider','PROVIDER-END'],['availability','REASON-END'],['filters','FILTER-END'],['diagnostic','DIAGNOSTIC-END']]) assert.ok(values[id].includes(suffix));
  assertPages(fields, detailPages(fields));
  for (const resolution of ['orphan','cycle','self','unresolved','ambiguous']) {
    i.context.parent = null; i.context.parentResolution = resolution;
    assert.equal(rowContext(i).parent, 'Unknown (' + resolution + ')');
  }
  i.display.detail = null; assert.equal(detailFields(i).find(f=>f.id==='waiting').value, 'Waiting detail unavailable');
});
test('two displayed copies of one identity retain distinct exact instance return keys', () => {
  // A blocked project row appears in global Needs you and its ordinary project tree.
  const f = fakeHost([terminal('t1', 'blocked', { labels:{'herdr.project':'sample'} })]);
  prove(f.host, { settings }); const s = setup(f);
  const instances = s.view.controller.projection.instances.filter(i=>i.kind==='terminal');
  assert.ok(instances.length >= 2); assert.equal(instances[0].identity, instances[1].identity);
  assert.notEqual(instances[0].key, instances[1].key);
  for (const i of instances) {
    const tree = s.view.render(s.cx); click(s, tree, 'info:'+i.key);
    assert.equal(s.view.reader.sourceKey, i.key); key(s, 'escape'); s.view.render(s.cx);
    assert.equal(s.view.controller.cursor, 'info:'+i.key);
    assert.equal(s.view.rowScroll.requests.at(-1), s.view.controls.find(c=>c.key==='info:'+i.key).rowIndex);
  }
  assert.equal(f.calls.length,0);
});
