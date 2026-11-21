import { addressParts, tuple } from './normalize.js';

export const rowIdentity = row => tuple(row.terminalKey, row.incarnation);

// Evidence is a current host assertion, not a new App API. It must be invalidated
// on every acquisition generation, disconnect, alias change or pane change.
export function navigationTarget(row, rows, { generation = null, routes = [] } = {}) {
  const disabled = reason => ({ enabled: false, reason, target: null });
  if (!row?.core?.verified || !row.associationKey) return disabled('unverified-identity');
  if (row.lifecycle !== 'live' || row.freshness !== 'current') return disabled('not-current-live');
  if (rows.filter(r => r.terminalKey === row.terminalKey && r.lifecycle !== 'finished').length !== 1) return disabled('ambiguous-incarnation');
  const parts = addressParts(row.address, row.localAlias);
  if (!parts || parts.terminalId !== row.terminalId || parts.alias !== row.core.alias
    || !row.identityEvidence.some(e => e.address === row.address)) return disabled('invalid-route');
  const matches = routes.filter(e => e?.associationKey === row.associationKey);
  if (matches.length !== 1) return disabled('missing-or-ambiguous-route-evidence');
  const e = matches[0];
  if (generation == null || e.generation !== generation || e.verified !== true
    || typeof e.source !== 'string' || !e.source.trim() || e.coreId !== row.core.id
    || e.address !== row.address || !['pane', 'pane-less'].includes(e.presentation)) return disabled('invalid-route-evidence');
  return { enabled: true, reason: null, target: { coreId: row.core.id, terminalId: row.terminalId,
    associationKey: row.associationKey, incarnation: row.incarnation, address: row.address,
    action: e.presentation === 'pane' ? 'focus' : 'peek' } };
}

// Only visible terminal instances enter here. Headers and context rows cannot win.
export function navigationOrder(instances) {
  const seen = new Set();
  return instances.filter(i => {
    if (i.kind !== 'terminal' || !i.navigation?.enabled || i.outsideFilters.length || i.contextOnly) return false;
    if (seen.has(i.identity)) return false;
    seen.add(i.identity); return true;
  }).map(i => ({ key: i.key, identity: i.identity, target: { ...i.navigation.target } }));
}

// Roster-local cursor movement is data only, including when the old row vanished.
export function moveCursor(order, key, direction = 'next') {
  if (!order.length) return null;
  const index = order.findIndex(i => i.key === key);
  const step = direction === 'previous' ? -1 : 1;
  return order[index < 0 ? (step > 0 ? 0 : order.length - 1) : (index + step + order.length) % order.length].key;
}

// Caller must pass a newly projected list and current evidence at activation time.
// This returns an intention plan; it never executes a command.
export function actionIntent(reduced, projection, key, evidence = {}) {
  const instance = projection.instances.find(i => i.key === key && i.kind === 'terminal');
  if (!instance || instance.contextOnly || instance.outsideFilters.length) return { enabled: false, reason: 'not-actionable-instance', intent: null };
  const rows = reduced.rows.filter(r => rowIdentity(r) === instance.identity);
  if (rows.length !== 1) return { enabled: false, reason: 'identity-changed', intent: null };
  const check = navigationTarget(rows[0], reduced.rows, evidence);
  return check.enabled ? { enabled: true, reason: null, intent: { type: 'navigate', ...check.target } }
    : { enabled: false, reason: check.reason, intent: null };
}
