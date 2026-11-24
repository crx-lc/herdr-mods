import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { detailFields, rowContext, detailLabel } from '../detail.js';
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
test('pure presentation runs without Intl or host globals', () => {
  const source = readFileSync(new URL('../detail.js', import.meta.url), 'utf8').replaceAll('export ', '');
  const sandbox = vm.createContext({ Intl: undefined });
  const out = vm.runInContext(source + "\n[hoverText({ row: { displayLabel: '界😀'.repeat(30) + 'END' }, navigation: { enabled: true } }, 'Working'), homeRelative('/home/sample/x', '/home/sample', true), workItemUrl({ provider: 'github', repositoryIdentity: 'o/r', kind: 'issue', numberOrId: 2, reference: 'o/r#2' })]", sandbox);
  assert.ok(out[0].split('\n').every(line => Array.from(line).length <= 40));
  assert.deepEqual([out[1], out[2]], ['~/x', 'https://github.com/o/r/issues/2']);
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
    // A pending row is pinned above the tabs: its index is in the pinned list, not the tabs' list.
    if (control.pinned) assert.ok(byId(byId(tree, 'roster-needs-rows').children[control.pinnedIndex], control.key));
    else assert.ok(byId(body.children[control.rowIndex], control.key));
    click(s, tree, control.key); assert.equal(s.view.reader.sourceKey, i.key);
    assert.equal(textOf(byId(s.view.render(s.cx), 'detail:project')), 'Project Sample project');
    assert.equal(f.calls.length, 0); key(s, 'escape'); s.view.render(s.cx);
  }
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
    // A state change behind the view's back: render shows the list without closing anything,
    // and the next key event drops the stale Details.
    s.view.controller.change(event); const tree = s.view.render(s.cx);
    assert.equal(s.view.activeReader(), null); assert.equal(flatten(tree).some(e => e.attributes.id?.[0] === 'roster-details'), false);
    key(s, 'escape'); assert.equal(s.view.reader, null); assert.equal(s.f.calls.length, 0);
  }
  const s = setup(); s.view.controller.cursor = item(s.view).key; key(s, 'd');
  click(s, s.view.render(s.cx), 'tools:toggle'); s.view.render(s.cx);
  assert.equal(s.view.reader, null); assert.ok(s.view.toolsOpen); assert.equal(s.f.calls.length, 0);
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
