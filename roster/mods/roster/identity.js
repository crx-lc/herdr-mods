import { addressParts, list, object, stamp, text, tuple } from './normalize.js';

// Each entry is a current verified assertion, not a hostname heuristic.
export function normalizeCores(input) {
  return list(input).flatMap(value => {
    const r = object(value), id = text(r.id), source = text(r.source);
    if (!id || r.verified !== true || !source || typeof r.alias !== 'string' || /[\s/\x00-\x1f\x7f]/.test(r.alias)) return [];
    return [{ id, alias: r.alias, source, hostLabel: text(r.hostLabel), name: text(r.name) }];
  });
}
export function identify(row, cores) {
  const parts = addressParts(row.address, row.localAlias);
  const matches = cores.filter(c => c.alias === parts.alias);
  const ids = [...new Set(matches.map(c => c.id))];
  const verified = ids.length === 1;
  const evidence = matches.map(c => ({ ...c })).sort((a, b) => tuple(a).localeCompare(tuple(b)));
  const facts = {}, conflicts = [];
  for (const field of ['source', 'hostLabel', 'name']) {
    const values = [...new Set(evidence.map(c => c[field]))];
    facts[field] = values.length === 1 ? values[0] : null;
    if (values.length > 1) conflicts.push(field);
  }
  const core = verified ? { id: ids[0], ...facts } : null;
  const terminalKey = verified ? tuple('core', core.id, parts.terminalId) : tuple('provisional', parts.alias, parts.terminalId);
  return { ...row, terminalId: parts.terminalId, terminalKey,
    associationKey: verified && row.incarnation !== null ? tuple(terminalKey, row.incarnation) : null,
    core: { id: core?.id ?? null, alias: parts.alias, verified, source: core?.source ?? 'unknown',
      hostLabel: core?.hostLabel ?? null, name: core?.name ?? null, conflicts, evidence },
    identityResolution: verified ? 'verified' : ids.length > 1 ? 'ambiguous' : 'provisional',
  };
}

// Qualify every observation before comparing meaning, never the group's newest source.
function qualifyParent(row, cores) {
  const reference = row.parentReference;
  const namespace = row.source === 'hc-full' ? row.parentNamespace
    : { alias: row.localAlias, source: `${row.source}:viewing-namespace` };
  const base = { reference, source: row.source, address: row.address, observedAt: row.observedAt,
    namespace, key: null, resolution: 'none' };
  if (!reference) return { ...base, resolution: row.parentMalformed ? 'malformed' : 'none' };
  const parts = addressParts(reference, namespace?.alias);
  if (!parts || (!reference.includes('/') && !namespace) || !row.core.verified) return { ...base, resolution: 'unresolved' };
  const ids = [...new Set(cores.filter(c => c.alias === parts.alias).map(c => c.id))];
  return ids.length === 1 ? { ...base, key: tuple('core', ids[0], parts.terminalId), resolution: 'qualified' }
    : { ...base, resolution: ids.length ? 'ambiguous' : 'unresolved' };
}

// Deduplicate only matching incarnations. Never enrich a new session from old labels.
export function resolveIdentities(input, coreInput) {
  const cores = normalizeCores(coreInput);
  const groups = new Map();
  for (const row of list(input)) {
    if (!row || !addressParts(row.address, row.localAlias)) continue;
    const r = identify(row, cores), key = tuple(r.terminalKey, r.incarnation);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [...groups.values()].map(group => {
    group.sort((a, b) => (b.observedAt ?? -1) - (a.observedAt ?? -1) || a.address.localeCompare(b.address) || a.source.localeCompare(b.source) || tuple(a).localeCompare(tuple(b)));
    const row = group[0];
    const variants = [...new Set(group.map(r => tuple(r.labels, r.invalidLabels)))];
    return { ...row, identityEvidence: group.map(r => ({ address: r.address, source: r.source, observedAt: r.observedAt })),
      metadataConflict: variants.length > 1,
      metadataEvidence: group.map(r => ({ source: r.source, address: r.address, labels: { ...r.labels }, invalidLabels: [...r.invalidLabels] })),
      parent: { key: null, associationKey: null, resolution: 'none', reference: row.parentReference, source: row.source },
    };
  });
  for (const row of rows) {
    const evidence = groups.get(tuple(row.terminalKey, row.incarnation));
    row.statusEvidence = evidence.map(r => ({ source: r.source, observedAt: r.observedAt,
      lifecycle: r.lifecycle, freshness: r.freshness, rawStatus: r.rawStatus, appStatus: r.appStatus }));
    row.lifecycleConflict = new Set(evidence.map(r => r.lifecycle)).size > 1;
    row.freshnessConflict = new Set(evidence.map(r => r.freshness)).size > 1;
    row.statusConflict = new Set(evidence.map(r => r.rawStatus)).size > 1;
    if (row.lifecycleConflict) row.lifecycle = 'unknown';
    if (row.freshnessConflict) row.freshness = 'unknown';
    if (row.lifecycle !== 'live' || row.freshness !== 'current' || row.statusConflict
      || new Set(evidence.map(r => r.appStatus)).size > 1) row.appStatus = 'unknown';
    const parent = row.parent;
    parent.evidence = evidence.map(r => qualifyParent(r, cores));
    const qualified = parent.evidence.filter(p => p.resolution === 'qualified');
    const keys = [...new Set(qualified.map(p => p.key))];
    const conditions = new Set(parent.evidence.map(p => p.resolution));
    if (keys.length > 1 || (conditions.has('none') && conditions.size > 1)) { parent.resolution = 'conflict'; continue; }
    if (conditions.size === 1 && conditions.has('none')) continue;
    if (conditions.has('malformed')) { parent.resolution = 'malformed'; continue; }
    if (conditions.has('ambiguous')) { parent.resolution = 'ambiguous'; continue; }
    if (conditions.has('unresolved')) { parent.resolution = 'unresolved'; continue; }
    const candidates = rows.filter(r => r.core.verified && r.terminalKey === keys[0]);
    if (candidates.length !== 1) { parent.resolution = candidates.length ? 'ambiguous' : 'orphan'; continue; }
    const target = candidates[0];
    if (target === row) { parent.resolution = 'self'; continue; }
    // Lifetime references have no incarnation: do not attach to a parent born later.
    if (stamp(row.incarnation) === null || stamp(target.incarnation) === null || target.incarnation > row.incarnation) {
      parent.resolution = 'incarnation-unknown'; continue;
    }
    parent.key = target.terminalKey; parent.associationKey = target.associationKey; parent.resolution = 'verified';
  }
  const byAssociation = new Map(rows.filter(r => r.associationKey).map(r => [r.associationKey, r]));
  const cyclic = new Set();
  for (const start of rows) {
    const path = [], seen = new Map(); let r = start;
    while (r && r.parent.resolution === 'verified') {
      if (seen.has(r)) { for (const member of path.slice(seen.get(r))) cyclic.add(member); break; }
      seen.set(r, path.length); path.push(r); r = byAssociation.get(r.parent.associationKey);
    }
  }
  for (const row of cyclic) Object.assign(row.parent, { key: null, associationKey: null, resolution: 'cycle' });
  return rows.sort((a, b) => a.terminalKey.localeCompare(b.terminalKey) || (a.incarnation ?? -1) - (b.incarnation ?? -1));
}
