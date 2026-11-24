import { addressParts, tuple } from './normalize.js';

export const rowIdentity = row => tuple(row.terminalKey, row.incarnation);

// Evidence is a current host assertion, not a new App API. It must be invalidated
// on every acquisition generation, disconnect, alias change or pane change.
export function navigationTarget(row, rows, { generation = null, routes = [], native = null } = {}) {
  const disabled = reason => ({ enabled: false, reason, target: null });
  if (!row?.core?.verified && native) return nativeTarget(row, rows, native, generation);
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

// The host's own model, without a Core id: the same snapshot must show exactly one live
// terminal at this exact address (local or remote), started at this row's incarnation,
// in at most one pane on its own machine. A pane focuses; a live pane-less terminal peeks.
function nativeTarget(row, rows, native, generation) {
  const disabled = reason => ({ enabled: false, reason, target: null });
  const parts = addressParts(row?.address, row?.localAlias);
  if (!parts || (parts.alias || '') !== (row.core?.alias ?? '')) return disabled('invalid-route');
  if (row.lifecycle !== 'live' || row.freshness !== 'current') return disabled('not-current-live');
  if (!Number.isSafeInteger(row.incarnation)) return disabled('incarnation-unknown');
  if (rows.filter(r => r.terminalKey === row.terminalKey && r.lifecycle !== 'finished').length !== 1) return disabled('ambiguous-incarnation');
  if (native.unavailable) return disabled(native.unavailable);
  const entry = Object.hasOwn(native.byAddress ?? {}, row.address) ? native.byAddress[row.address] : null;
  if (!entry) return disabled('not-current-live');
  if (entry.reason) return disabled(entry.reason);
  if (entry.incarnation !== row.incarnation) return disabled('terminal-changed');
  if (generation == null || entry.generation !== generation || native.generation !== generation) return disabled('pane-evidence-stale');
  return { enabled: true, reason: null, target: { scope: 'native', coreId: null, terminalId: parts.terminalId,
    associationKey: null, incarnation: row.incarnation, address: row.address, pane: entry.pane,
    action: entry.presentation === 'pane' ? 'focus' : 'peek' } };
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
