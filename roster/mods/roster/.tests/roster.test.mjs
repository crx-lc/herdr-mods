import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApp, normalizeCompact, normalizeFull, freshness } from '../normalize.js';
import { resolveIdentities } from '../identity.js';
import { enrichMetadata, normalizeConfig, parseWorkItem } from '../metadata.js';

const now = 100000;
const observation = { observedAt: now, refresh: 'success' };
const cores = [
  { alias: '', id: 'core-a', verified: true, source: 'server-status', hostLabel: 'build-host' },
  { alias: 'edge', id: 'core-b', verified: true, source: 'machine-list', hostLabel: 'build-host' },
  { alias: 'alias', id: 'core-a', verified: true, source: 'machine-list', hostLabel: 'build-host' },
];
const app = (address = 't7', extra = {}, obs = observation) => normalizeApp({ address, state: 'live', created_ms: 100, status: 'working', ...extra }, obs, now);
const identify = (rows, cs = cores) => resolveIdentities(rows, cs);
const enrich = (rows, config) => enrichMetadata(identify(rows), config).rows;
const config = {
  projects: [{ id: 'project-7f42', displayName: 'Sample project' }, { id: 'project-other', displayName: 'Other project' }],
  projectBindings: [
    { coreId: 'core-a', token: 'sample', projectId: 'project-7f42' },
    { coreId: 'core-b', token: 'remote-token', projectId: 'project-7f42' },
    { coreId: 'core-a', token: 'other', projectId: 'project-other' },
  ],
};
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}

test('three source adapters retain distinct status and label contracts', () => {
  const raw = { address: 't7', state: 'live', created_ms: 10, status: { state: 'idle' }, labels: { 'herdr.role': 'developer' } };
  assert.equal(normalizeFull(raw, observation, now).appStatus, 'idle');
  assert.equal(normalizeApp(raw, observation, now).appStatus, 'unknown');
  const compact = normalizeCompact({ ...raw, status: 'idle' }, observation, now);
  assert.equal(compact.appStatus, 'idle'); assert.equal(compact.incarnation, null);
  assert.deepEqual(compact.labels, {}); assert.equal(compact.provenance.labels, 'unavailable');
});
test('malformed records and optional fields never manufacture status', () => {
  for (const raw of [null, [], {}, { address: 7 }, { address: 'friendly-name' }, { address: 'edge/t7/extra' }]) assert.equal(normalizeApp(raw, observation, now), null);
  for (const status of [null, {}, [], 4, true, 'Working', 'other']) assert.equal(app('t7', { status }).appStatus, 'unknown');
  const row = app('t7', { labels: { 'herdr.role': {}, 'herdr.project': 7, 'herdr.issue': '\nsecret' }, parent: {} });
  assert.equal(identify([row])[0].parent.resolution, 'malformed');
  assert.deepEqual(row.invalidLabels, ['herdr.role', 'herdr.project', 'herdr.issue']);
});
test('equal IDs and names across cores remain distinct; verified aliases deduplicate', () => {
  const rows = identify([app('t7', { name: 'Equal' }), app('edge/t7', { name: 'Equal' }), app('alias/t7', { name: 'Equal' })]);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].terminalKey, rows[1].terminalKey);
  assert.equal(rows.find(r => r.core.id === 'core-a').identityEvidence.length, 2);
});
test('rebuilt cores and changed incarnation never inherit identity associations', () => {
  const old = identify([app()])[0];
  const rebuilt = identify([app()], [{ ...cores[0], id: 'core-new' }])[0];
  assert.notEqual(old.terminalKey, rebuilt.terminalKey);
  const sessions = identify([app(), app('alias/t7', { created_ms: 200 })]);
  assert.equal(sessions.length, 2); assert.notEqual(sessions[0].associationKey, sessions[1].associationKey);
  const child = identify([app(), app('alias/t7', { created_ms: 200 }), app('t8', { parent: 't7', created_ms: 300 })]).find(r => r.terminalId === 't8');
  assert.equal(child.parent.resolution, 'ambiguous');
});
test('unknown and ambiguous core identity is provisional with no persistent association', () => {
  for (const cs of [[], [{ ...cores[0], verified: false }], [cores[0], { ...cores[0], id: 'core-new' }]]) {
    const row = identify([app()], cs)[0]; assert.equal(row.core.verified, false); assert.equal(row.associationKey, null);
  }
});
test('bare and mapped remote parents resolve with verified identity', () => {
  const rows = identify([app(), app('edge/t8', { parent: 'alias/t7', created_ms: 200 })]);
  const child = rows.find(r => r.terminalId === 't8');
  assert.equal(child.parent.resolution, 'verified'); assert.equal(child.parent.associationKey, rows.find(r => r.terminalId === 't7').associationKey);
});
for (const [reference, expected] of [['missing/t7', 'unresolved'], ['t9', 'orphan'], ['t7', 'self'], ['core-a/t7', 'unresolved'], ['bad ref', 'unresolved']]) {
  test(`parent ${reference} preserves ${expected} evidence`, () => {
    const row = identify([app('t7', { parent: reference })])[0]; assert.equal(row.parent.resolution, expected); assert.equal(row.parent.reference, reference); assert.equal(row.parent.key, null);
  });
}
test('ambiguous parent aliases do not guess a target', () => {
  const row = identify([app('t8', { parent: 'edge/t7' })], [...cores, { ...cores[1], id: 'core-c' }])[0];
  assert.equal(row.parent.resolution, 'ambiguous');
});
test('cycles are cut and descendant processing remains bounded', () => {
  const rows = identify([app('t7', { parent: 't8' }), app('t8', { parent: 't7' }), app('t9', { parent: 't8' })]);
  assert.equal(rows.filter(r => r.parent.resolution === 'cycle').length, 2);
  assert.equal(enrichMetadata(rows, config).rows.length, 3);
});
test('newer or unknown parent incarnation cannot receive a lifetime relationship', () => {
  for (const created_ms of [null, 200]) {
    const rows = identify([app('t7', { created_ms }), app('t8', { parent: 't7', created_ms: 100 })]);
    assert.equal(rows.find(r => r.terminalId === 't8').parent.resolution, 'incarnation-unknown');
  }
});
test('contradictory aliases retain evidence but suppress hierarchy and metadata claims', () => {
  const rows = identify([app('t7', { labels: { 'herdr.role': 'developer' }, parent: 't8' }), app('alias/t7', { labels: { 'herdr.role': 'reviewer' }, status: 'idle', parent: 't9' })]);
  assert.equal(rows.length, 1); assert.equal(rows[0].appStatus, 'unknown'); assert.equal(rows[0].metadataConflict, true);
  assert.equal(rows[0].parent.resolution, 'conflict');
  assert.equal(enrichMetadata(rows).rows[0].role, 'unknown');
});
for (const [role, kind, number, expected] of [['planner', 'issue', 12, 'Planner #12'], ['developer', 'issue', 8, 'Developer #8'], ['reviewer', 'pr', 9, 'Reviewer PR #9']]) {
  test(`validated labels format ${expected}`, () => {
    const row = enrich([app('t7', { labels: { 'herdr.role': role, [`herdr.${kind}`]: `example/repo#${number}` } })])[0];
    assert.equal(row.displayLabel, expected); assert.equal(row.providerBadge.id, 'github');
  });
}
test('unlabeled sessions use meaningful named tab, core terminal name, core name, address', () => {
  assert.equal(enrich([app('t7', { name: 'Worker name' }, { ...observation, tabNamed: true, tabTitle: 'Review changes' })])[0].displayLabel, 'Review changes');
  assert.equal(enrich([app('t7', { name: 'Planner #99', template: 'developer', model: 'codex' }, { ...observation, tabNamed: false, tabTitle: '1' })])[0].role, 'unknown');
  assert.equal(enrich([app('t7', { name: 'Terminal name' }, { ...observation, tabNamed: true, tabTitle: '1' })])[0].displayLabel, 'Terminal name');
  assert.equal(enrichMetadata(identify([app()], [{ ...cores[0], name: 'Core name' }])).rows[0].displayLabel, 'Core name');
  assert.equal(enrichMetadata(identify([app()], [])).rows[0].displayLabel, 't7');
});
test('project bindings join exact tokens across cores and survive display renames', () => {
  const inputs = [app('t7', { labels: { 'herdr.project': 'sample' } }), app('edge/t7', { labels: { 'herdr.project': 'remote-token' } })];
  const rows = enrich(inputs, config); assert.deepEqual(rows.map(r => r.project.id), ['project-7f42', 'project-7f42']);
  const renamed = enrich(inputs, { ...config, projects: [{ id: 'project-7f42', displayName: 'Renamed' }] });
  assert.deepEqual(renamed.map(r => r.project.id), rows.map(r => r.project.id)); assert.equal(renamed[0].project.displayName, 'Renamed');
  assert.equal(enrichMetadata(identify(inputs, [{ ...cores[0], id: 'core-new' }]), config).rows[0].project.id, null);
});
test('equal project slugs and shared spaces do not merge unbound projects', () => {
  const rows = enrich([app('t7', { labels: { 'herdr.project': 'sample', 'herdr.space': 'same' } }), app('edge/t7', { labels: { 'herdr.project': 'sample', 'herdr.space': 'same' } })], config);
  assert.equal(rows.find(r => r.core.id === 'core-b').project.id, null);
});
test('only unlabeled children inherit verified project membership with provenance', () => {
  const rows = enrich([app('t7', { labels: { 'herdr.project': 'sample' } }), app('t8', { parent: 't7', created_ms: 200 }), app('t9', { parent: 't7', created_ms: 200, labels: { 'herdr.project': 'other' } }), app('t10', { parent: 't7', created_ms: 200, labels: { 'herdr.project': 'unbound' } })], config);
  const child = rows.find(r => r.terminalId === 't8'); assert.equal(child.project.source, 'parent:verified-membership');
  assert.equal(child.project.id, 'project-7f42');
  assert.equal(rows.find(r => r.terminalId === 't9').project.resolution, 'parent-conflict');
  assert.equal(rows.find(r => r.terminalId === 't10').project.id, null);
});
test('conflicting project bindings and malformed project labels remain unassigned', () => {
  const cfg = { ...config, projectBindings: [...config.projectBindings, { coreId: 'core-a', token: 'sample', projectId: 'project-other' }] };
  assert.equal(enrich([app('t7', { labels: { 'herdr.project': 'sample' } })], cfg)[0].project.resolution, 'conflict');
  assert.equal(enrich([app('t7', { labels: { 'herdr.project': [] } })], config)[0].project.id, null);
});
test('two contexts on one host remain independent from machine identity', () => {
  const rows = enrich([app(), app('edge/t7')], { contexts: [
    { coreId: 'core-a', id: 'context-a', label: 'Build context', source: 'explicit-map', exclusive: true },
    { coreId: 'core-b', id: 'context-b', label: 'Test context', source: 'verified', exclusive: true },
  ] });
  assert.equal(rows[0].core.hostLabel, rows[1].core.hostLabel); assert.notEqual(rows[0].executionContext.id, rows[1].executionContext.id);
});
test('ambiguous core context is unknown; exact incarnation mapping distinguishes contexts in one core', () => {
  const contexts = [
    { coreId: 'core-a', id: 'context-a', label: 'A', source: 'explicit-map', exclusive: true },
    { coreId: 'core-a', id: 'context-b', label: 'B', source: 'explicit-map', exclusive: true },
    { coreId: 'core-a', terminalId: 't8', incarnation: 100, id: 'context-c', label: 'C', source: 'verified' },
  ];
  const rows = enrich([app(), app('t8')], { contexts });
  assert.equal(rows.find(r => r.terminalId === 't7').executionContext.label, 'Context unknown');
  assert.equal(rows.find(r => r.terminalId === 't8').executionContext.id, 'context-c');
  assert.equal(enrich([app('t8', { created_ms: 200 })], { contexts })[0].executionContext.id, null);
  assert.equal(enrich([app()], { contexts: [{ ...contexts[0], exclusive: false }], viewingHost: 'context-a', model: 'context-a', login: 'context-a' })[0].executionContext.id, null);
});
test('mixed linked providers win over project defaults and preserve per-task provenance', () => {
  const rows = enrich([app('t7', { labels: { 'herdr.project': 'sample', 'herdr.issue': 'example/repo#12' } }), app('t8', { labels: { 'herdr.project': 'sample', 'herdr.issue': 'https://dev.azure.com/example/team/_workitems/edit/8' } })], { ...config, projectProviders: [{ projectId: 'project-7f42', provider: 'github', applicable: true }] });
  assert.deepEqual(rows.map(r => r.providerBadge.id), ['github', 'azure-devops']); assert.ok(rows.every(r => r.providerBadge.source === 'label:herdr.issue'));
});
test('bare, malformed, and conflicting tasks block provider defaults', () => {
  const cfg = { ...config, projectProviders: [{ projectId: 'project-7f42', provider: 'github', applicable: true }] };
  for (const issue of ['12', '#12', 'https://github.com/example/repo/issues/0', {}, 'http://github.com/example/repo/issues/12']) {
    const row = enrich([app('t7', { labels: { 'herdr.project': 'sample', 'herdr.issue': issue } })], cfg)[0]; assert.equal(row.workItem, null); assert.equal(row.providerBadge, null);
  }
  const row = enrich([app('t7', { labels: { 'herdr.issue': 'example/repo#8', 'herdr.pr': 'example/repo#9' } })], cfg)[0]; assert.equal(row.workItemResolution, 'conflict'); assert.equal(row.providerBadge, null);
});
test('explicit provider mappings require applicable project or exact process incarnation', () => {
  const cfg = { ...config, processProviders: [{ coreId: 'core-a', terminalId: 't7', incarnation: 100, provider: 'azure-devops' }] };
  assert.equal(enrich([app()], cfg)[0].providerBadge.source, 'config:process');
  assert.equal(enrich([app('t7', { created_ms: 200 })], cfg)[0].providerBadge, null);
  assert.equal(enrich([app('t7', { labels: { 'herdr.project': 'sample' } })], { ...config, projectProviders: [{ projectId: 'project-7f42', provider: 'github', applicable: false }] })[0].providerBadge, null);
});
test('full work item URL kind validation and safe positive IDs', () => {
  assert.equal(parseWorkItem('https://github.com/example/repo/pull/9', 'pr').numberOrId, 9);
  assert.equal(parseWorkItem('https://github.com/example/repo/pull/9', 'issue'), null);
  assert.equal(parseWorkItem('https://dev.azure.com/example/team/_git/repo/pullrequest/9', 'pr').provider, 'azure-devops');
  for (const value of ['example/repo#9007199254740992', 'example/repo#0', 'https://github.com/example/repo/issues/1?x=2', 'https://github.com.evil/example/repo/issues/1']) assert.equal(parseWorkItem(value), null);
});
test('old status timestamp is not a stale heartbeat and done is not finished lifecycle', () => {
  const row = app('t7', { status_ms: 1, status: 'done' }); assert.equal(row.freshness, 'current'); assert.equal(row.lifecycle, 'live'); assert.equal(row.appStatus, 'done');
});
test('offline, stale, loading, future and absent freshness suppress current status claims', () => {
  for (const [extra, expected] of [[{ connection: 'offline' }, 'offline'], [{ observedAt: 1 }, 'stale'], [{ refresh: 'loading', startedAt: now }, 'loading'], [{ refresh: 'loading', startedAt: 1 }, 'stale'], [{ refresh: 'error' }, 'stale'], [{ observedAt: now + 1 }, 'unknown'], [{ present: false }, 'stale'], [{ observedAt: null }, 'unknown']]) {
    const row = app('t7', {}, { ...observation, ...extra }); assert.equal(row.freshness, expected); assert.equal(row.appStatus, 'unknown'); assert.equal(row.lifecycle, 'live');
  }
  assert.equal(freshness({ refresh: 'loading' }, now), 'unknown');
  assert.equal(app('t7', {}, { ...observation, layout: 'unavailable' }).freshness, 'current');
});
test('explicit finished state is separate from stale, unknown and contradictory lifecycle', () => {
  const row = normalizeCompact({ address: 't7', state: 'finished', status: 'working' }, observation, now);
  assert.equal(row.lifecycle, 'finished'); assert.equal(row.appStatus, 'unknown');
  assert.equal(app('t7', { state: 'missing' }).lifecycle, 'unknown');
  assert.equal(app('t7', { finished_ms: 200 }).lifecycle, 'unknown');
  assert.equal(app('t7', { state: 'finished', finished_ms: 10 }).lifecycle, 'unknown');
});
test('all public pipeline stages leave deeply frozen fixtures/config untouched', () => {
  const raw = freeze({ address: 't7', state: 'live', created_ms: 100, labels: { 'herdr.project': 'sample', 'herdr.role': 'developer' }, status: 'idle' });
  const obs = freeze({ ...observation });
  const normalized = freeze(normalizeApp(raw, obs, now));
  const identified = freeze(resolveIdentities(freeze([normalized]), freeze(cores)));
  const cfg = freeze(config);
  const before = JSON.stringify({ raw, obs, normalized, identified, cfg });
  enrichMetadata(identified, cfg); normalizeConfig(cfg);
  assert.equal(JSON.stringify({ raw, obs, normalized, identified, cfg }), before);
});
test('valid task plus malformed competing task retains unresolved evidence', () => {
  const row = enrich([app('t7', { labels: { 'herdr.issue': 'example/repo#8', 'herdr.pr': {} } })])[0];
  assert.equal(row.workItemResolution, 'conflict'); assert.equal(row.providerBadge, null); assert.equal(row.workItemEvidence.length, 1);
});
test('invalid config is reported without accepting partial selectors', () => {
  const cfg = normalizeConfig({ projects: [null, {}, { id: 'good', displayName: 'Valid' }], projectBindings: [null], contexts: [{ coreId: 'core-a', terminalId: 't7', id: 'context-a', label: 'A', source: 'explicit-map' }], processProviders: [{ coreId: 'core-a', provider: 'github' }] });
  assert.equal(cfg.projects.length, 1); assert.equal(cfg.rejected.length, 5); assert.deepEqual(cfg.contexts, []); assert.deepEqual(cfg.processProviders, []);
  for (const value of [null, [], 8, 'bad']) assert.deepEqual(normalizeConfig(value).projects, []);
});
test('parent and metadata results remain stable when fixture order changes', () => {
  const fixtures = [app('t7', { labels: { 'herdr.project': 'sample' } }), app('t8', { parent: 't7', created_ms: 200 }), app('edge/t7')];
  assert.deepEqual(enrich(fixtures, config), enrich([...fixtures].reverse(), config));
});
test('App and compact bare parents use viewing namespace; full requires explicit evidence', () => {
  const parents = [app('t7'), app('edge/t7')];
  for (const adapter of [normalizeApp, normalizeCompact, normalizeFull]) {
    const raw = { address: 'edge/t8', state: 'live', created_ms: 200, parent: 't7' };
    const child = identify([...parents, adapter(raw, observation, now)]).find(r => r.terminalId === 't8');
    assert.equal(child.parent.evidence[0].key, adapter === normalizeFull ? null : identify([parents[0]])[0].terminalKey);
    assert.equal(child.parent.resolution, adapter === normalizeFull ? 'unresolved' : adapter === normalizeCompact ? 'incarnation-unknown' : 'verified');
  }
  const raw = { address: 'edge/t8', state: 'live', created_ms: 200, parent: 't7' };
  for (const alias of ['', 'edge']) {
    const full = normalizeFull(raw, { ...observation, parentNamespace: { alias, source: 'caller:tested-contract' } }, now);
    const child = identify([...parents, full]).find(r => r.terminalId === 't8');
    assert.equal(child.parent.key, identify([parents[alias ? 1 : 0]])[0].terminalKey);
  }
});
test('malformed repository identifiers cannot establish a provider', () => {
  for (const value of ['./repo#1', 'example/..#1', '-example/repo#1', 'example_/repo#1', 'https://github.com/./repo/issues/1']) assert.equal(parseWorkItem(value), null);
});

const permutations = values => values.length ? values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j)).map(tail => [v, ...tail])) : [[]];
test('mixed parent namespaces never invent project inheritance under timestamps or permutations', () => {
  const parents = [app('t7', { labels: { 'herdr.project': 'sample' } }),
    app('edge/t7', { labels: { 'herdr.project': 'remote-token' } })];
  const projectConfig = { projects: config.projects, projectBindings: [config.projectBindings[0],
    { coreId: 'core-b', token: 'remote-token', projectId: 'project-other' }] };
  for (const parentNamespace of [undefined, { alias: '', source: 'caller:tested-contract' },
    { alias: 'edge', source: 'caller:tested-contract' }, { alias: 'missing', source: 'caller:tested-contract' }, { alias: '' }]) {
    for (const [appTime, fullTime] of [[now, now - 1], [now - 1, now], [now, now]]) {
      const raw = { address: 'edge/t9', state: 'live', created_ms: 200, parent: 't7' };
      const children = [normalizeApp(raw, { ...observation, observedAt: appTime }, now),
        normalizeFull(raw, { ...observation, observedAt: fullTime, parentNamespace }, now)];
      const expected = parentNamespace?.source ? parentNamespace.alias === '' ? 'verified' : parentNamespace.alias === 'edge' ? 'conflict' : 'unresolved' : 'unresolved';
      let baseline;
      for (const input of permutations([...parents, ...children])) {
        const rows = enrich(input, projectConfig), child = rows.find(r => r.terminalId === 't9');
        assert.equal(child.parent.resolution, expected);
        assert.equal(child.project.id, expected === 'verified' ? 'project-7f42' : null);
        assert.equal(child.parent.evidence.length, 2);
        if (baseline) assert.deepEqual(rows, baseline); else baseline = rows;
      }
    }
  }
});
test('qualified equivalent parent references agree semantically, conflicting viewing namespaces do not', () => {
  const raw = { address: 'edge/t9', state: 'live', created_ms: 200 };
  const parents = [app('t7'), app('edge/t7')];
  const a = normalizeApp({ ...raw, parent: 't7' }, observation, now);
  const f = normalizeFull({ ...raw, parent: 'alias/t7' }, observation, now);
  assert.equal(identify([...parents, a, f]).find(r => r.terminalId === 't9').parent.resolution, 'verified');
  const other = normalizeApp({ ...raw, parent: 't7' }, { ...observation, localAlias: 'edge' }, now);
  assert.equal(identify([...parents, a, other]).find(r => r.terminalId === 't9').parent.resolution, 'conflict');
  for (const adapter of [normalizeApp, normalizeCompact]) {
    const child = adapter({ ...raw, parent: 't7' }, { ...observation, localAlias: 'edge' }, now);
    assert.equal(identify([...parents, child]).find(r => r.terminalId === 't9').parent.evidence[0].key, identify([parents[1]])[0].terminalKey);
  }
});
test('compact history remains separate from richer incarnations with no label transfer', () => {
  const current = app('t7', { labels: { 'herdr.role': 'developer', 'herdr.project': 'sample' } });
  const history = normalizeCompact({ address: 't7', state: 'live', status: 'working' }, observation, now);
  const child = app('t8', { parent: 't7', created_ms: 200 });
  const rows = enrich([current, history, child], config);
  assert.equal(rows.length, 3);
  const unknownSession = rows.find(r => r.incarnation === null);
  assert.equal(unknownSession.associationKey, null); assert.equal(unknownSession.role, 'unknown');
  assert.equal(unknownSession.project.id, null); assert.deepEqual(unknownSession.labels, {});
  assert.equal(rows.find(r => r.terminalId === 't8').parent.resolution, 'ambiguous');
  assert.equal(enrich([current, child], config).find(r => r.terminalId === 't8').project.id, 'project-7f42');
});
test('lifecycle, freshness and activity disagreements are handled independently', () => {
  for (const lifeA of ['live', 'finished', 'unknown']) for (const lifeB of ['live', 'finished', 'unknown']) {
    for (const statusA of ['working', 'idle', 'blocked', 'done', 'error', 'unknown']) for (const statusB of ['working', 'idle', 'blocked', 'done', 'error', 'unknown']) {
      const freshnessCases = [{}, { observedAt: 1 }, { connection: 'offline' }, { refresh: 'loading', startedAt: now }, { observedAt: null }];
      for (const freshA of freshnessCases) for (const fresh of freshnessCases) {
        const a = app('t7', { state: lifeA, status: statusA }, { ...observation, ...freshA });
        const b = normalizeFull({ address: 't7', state: lifeB, created_ms: 100, status: { state: statusB } }, { ...observation, ...fresh }, now);
        const row = identify([a, b])[0];
        assert.equal(row.lifecycle, lifeA === lifeB ? lifeA : 'unknown');
        assert.equal(row.freshness, a.freshness === b.freshness ? a.freshness : 'unknown');
        assert.equal(row.appStatus, lifeA === 'live' && lifeB === 'live' && a.freshness === b.freshness && statusA === statusB ? a.appStatus : 'unknown');
        assert.equal(row.lifecycleConflict, lifeA !== lifeB);
        assert.equal(row.freshnessConflict, a.freshness !== b.freshness);
        assert.equal(row.statusConflict, statusA !== statusB);
        assert.equal(row.statusEvidence.length, 2);
        assert.deepEqual(identify([b, a]), [row]);
      }
    }
  }
});
test('duplicate verified core assertions preserve identity but expose conflicting facts deterministically', () => {
  const duplicateCores = [cores[1], { ...cores[1], source: 'server-status', hostLabel: 'other-host', name: 'Other name' },
    { ...cores[1], name: 'Build core' }];
  let baseline;
  for (const cs of permutations(duplicateCores)) {
    const rows = identify([app('edge/t7')], cs), core = rows[0].core;
    assert.equal(core.id, 'core-b'); assert.equal(core.verified, true);
    assert.equal(core.hostLabel, null); assert.equal(core.name, null); assert.equal(core.source, 'unknown');
    assert.deepEqual(core.conflicts, ['source', 'hostLabel', 'name']); assert.equal(core.evidence.length, 3);
    if (baseline) assert.deepEqual(rows, baseline); else baseline = rows;
  }
  const agreeing = identify([app('edge/t7')], [cores[1], { ...cores[1] }])[0];
  assert.deepEqual(agreeing.core.conflicts, []); assert.equal(agreeing.core.hostLabel, 'build-host');
  const partial = identify([app('edge/t7')], [cores[1], { ...cores[1], name: 'Other name' }])[0];
  assert.equal(partial.core.hostLabel, 'build-host'); assert.deepEqual(partial.core.conflicts, ['name']);
});
test('config selectors reject nonstring IDs for contexts and process providers', () => {
  const invalid = [['t7'], { toString: () => 't7' }, 7, true, {}, [], null, undefined];
  for (const terminalId of invalid) {
    const cfg = normalizeConfig({ contexts: [{ coreId: 'core-a', terminalId, incarnation: 100, id: 'context-a', label: 'A', source: 'explicit-map' }],
      processProviders: [{ coreId: 'core-a', terminalId, incarnation: 100, provider: 'github' }] });
    assert.deepEqual(cfg.contexts, []); assert.deepEqual(cfg.processProviders, []); assert.equal(cfg.rejected.length, 2);
  }
  const row = enrich([app()], { contexts: [{ coreId: 'core-a', exclusive: true, id: 'context-a', label: 'A', source: 'explicit-map' }] })[0];
  assert.equal(row.executionContext.id, 'context-a');
});

test('App, compact and full child observations retain safe separate incarnation evidence', () => {
  const parents = [app('t7', { labels: { 'herdr.project': 'sample' } }), app('edge/t7')];
  const raw = { address: 'edge/t9', state: 'live', created_ms: 200, parent: 't7' };
  for (const parentNamespace of [undefined, { alias: '', source: 'caller:tested-contract' }, { alias: 'edge', source: 'caller:tested-contract' }]) {
    const input = [...parents, normalizeApp(raw, observation, now), normalizeCompact(raw, observation, now),
      normalizeFull(raw, { ...observation, parentNamespace }, now)];
    const rows = enrich(input, config), children = rows.filter(r => r.terminalId === 't9');
    assert.equal(children.length, 2);
    assert.equal(children.find(r => r.incarnation === null).parent.resolution, 'incarnation-unknown');
    assert.equal(children.find(r => r.incarnation === null).project.id, null);
    const known = children.find(r => r.incarnation === 200);
    assert.equal(known.parent.resolution, !parentNamespace ? 'unresolved' : parentNamespace.alias ? 'conflict' : 'verified');
    assert.equal(known.project.id, parentNamespace?.alias === '' ? 'project-7f42' : null);
    assert.deepEqual(rows, enrich([...input].reverse(), config));
  }
});
