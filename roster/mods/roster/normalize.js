// Pure adapters: the caller supplies observations and time, never a live host.
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const list = value => Array.isArray(value) ? value : [];
export const text = value => typeof value === 'string' && value.trim() && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
export const stamp = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const tuple = (...values) => JSON.stringify(values);
export function addressParts(value, localAlias = '') {
  if (typeof value !== 'string') return null;
  const match = /^(?:([^/\s]+)\/)?(t[1-9][0-9]*)$/.exec(value);
  return match ? { alias: match[1] ?? localAlias, terminalId: match[2] } : null;
}
const words = ['working', 'blocked', 'done', 'idle', 'error'];

export function freshness(evidence = {}, now) {
  const e = object(evidence), at = stamp(e.observedAt), clock = stamp(now);
  if (e.connection === 'offline') return 'offline';
  if (e.refresh === 'loading') {
    const start = stamp(e.startedAt), limit = stamp(e.loadingLimitMs) ?? 15000;
    if (clock !== null && start !== null && clock >= start && clock - start <= limit) return 'loading';
    return at !== null ? 'stale' : 'unknown';
  }
  if (e.refresh === 'error') return at !== null ? 'stale' : 'unknown';
  const ttl = stamp(e.ttlMs) ?? 90000;
  if (at === null || clock === null || at > clock) return 'unknown';
  if (clock - at > ttl || e.present === false) return 'stale';
  return e.refresh === 'success' ? 'current' : 'unknown';
}

function adapt(source, input, observation, now) {
  const r = object(input), o = object(observation);
  const address = typeof r.address === 'string' ? r.address : null;
  if (!addressParts(address, text(o.localAlias) ?? '')) return null;
  const full = source === 'hc-full', compact = source === 'hc-compact';
  const status = full ? object(r.status).state : r.status;
  const rawStatus = words.includes(status) ? status : 'unknown';
  const createdMs = compact ? null : stamp(r.created_ms);
  const finishedMs = compact ? null : stamp(r.finished_ms);
  let lifecycle = ['live', 'finished'].includes(r.state) ? r.state : 'unknown';
  if ((lifecycle === 'live' && finishedMs !== null) || (finishedMs !== null && createdMs !== null && finishedMs < createdMs)) lifecycle = 'unknown';
  const fresh = freshness(o, now);
  const labels = {};
  const invalidLabels = [];
  if (!compact) {
    for (const key of ['herdr.role', 'herdr.project', 'herdr.issue', 'herdr.pr']) {
      if (Object.hasOwn(object(r.labels), key)) {
        const value = text(r.labels[key]);
        if (value) labels[key] = value;
        else invalidLabels.push(key);
      }
    }
  }
  return {
    source, address, localAlias: text(o.localAlias) ?? '',
    parentNamespace: full && typeof o.parentNamespace?.alias === 'string' && text(o.parentNamespace.source)
      && !/[\s/\x00-\x1f\x7f]/.test(o.parentNamespace.alias)
      ? { alias: o.parentNamespace.alias, source: text(o.parentNamespace.source) } : null,
    parentReference: text(r.parent), parentMalformed: r.parent != null && !text(r.parent),
    name: text(r.name), tabTitle: text(o.tabTitle), tabNamed: o.tabNamed === true,
    labels, invalidLabels, incarnation: createdMs,
    lifecycle, rawStatus,
    appStatus: fresh === 'current' && lifecycle === 'live' && ['working', 'blocked', 'done', 'idle'].includes(rawStatus) ? rawStatus : 'unknown',
    freshness: fresh, observedAt: stamp(o.observedAt), statusChangedAt: stamp(r.status_ms),
    provenance: { status: source, labels: compact ? 'unavailable' : source, lifecycle: `${source}:state` },
  };
}
export const normalizeApp = (record, observation, now) => adapt('app', record, observation, now);
export const normalizeCompact = (record, observation, now) => adapt('hc-compact', record, observation, now);
export const normalizeFull = (record, observation, now) => adapt('hc-full', record, observation, now);
