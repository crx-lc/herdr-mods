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
  const core = verified ? matches.find(c => c.id === ids[0]) : null;
  const terminalKey = verified ? tuple('core', core.id, parts.terminalId) : tuple('provisional', parts.alias, parts.terminalId);
  return { ...row, terminalId: parts.terminalId, terminalKey,
    associationKey: verified && row.incarnation !== null ? tuple(terminalKey, row.incarnation) : null,
    core: { id: core?.id ?? null, alias: parts.alias, verified, source: core?.source ?? 'unknown',
      hostLabel: core?.hostLabel ?? null, name: core?.name ?? null },
    identityResolution: verified ? 'verified' : ids.length > 1 ? 'ambiguous' : 'provisional',
  };
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
    group.sort((a, b) => (b.observedAt ?? -1) - (a.observedAt ?? -1) || a.address.localeCompare(b.address) || a.source.localeCompare(b.source));
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
    if (new Set(evidence.map(r => tuple(r.lifecycle, r.rawStatus, r.freshness))).size > 1) {
      row.appStatus = 'unknown'; row.lifecycle = 'unknown'; row.freshness = 'unknown';
    }
    const refs = [...new Set(evidence.map(r => r.parentReference))];
    const parent = row.parent;
    if (refs.length > 1) { parent.resolution = 'conflict'; continue; }
    if (!parent.reference) { if (row.parentMalformed) parent.resolution = 'malformed'; continue; }
    const parts = addressParts(parent.reference, row.source === 'app' ? row.localAlias : row.core.alias);
    if (!parts || !row.core.verified) { parent.resolution = 'unresolved'; continue; }
    const ids = [...new Set(cores.filter(c => c.alias === parts.alias).map(c => c.id))];
    if (ids.length !== 1) { parent.resolution = ids.length ? 'ambiguous' : 'unresolved'; continue; }
    const candidates = rows.filter(r => r.core.verified && r.core.id === ids[0] && r.terminalId === parts.terminalId);
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
