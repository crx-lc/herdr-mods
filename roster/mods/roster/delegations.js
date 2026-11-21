// Independent consumer of herdr-agents/delegations v1, pinned in README.
// All observations and accepted-revision history belong to the caller.
const launchers = ['codex-auto', 'claude-auto', 'antigravity-auto', 'start-planner'];
const reasons = ['completed', 'cancelled', 'superseded', 'failed'];
const integer = n => Number.isSafeInteger(n) && n > 0;
const string = s => typeof s === 'string' && s.length > 0;
const run = s => s === null || (typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
const incarnation = t => t && string(t.address) && integer(t.created) && integer(t.pid)
  && (t.program === null || launchers.includes(t.program)) && typeof t.keep === 'boolean' && run(t.run);
export const machineOf = address => address.includes('/') ? address.slice(0, address.lastIndexOf('/')) : null;
const localOf = address => address.slice(address.lastIndexOf('/') + 1);
export const qualifyChild = (address, producer) => address.includes('/') || machineOf(producer) === null ? address : `${machineOf(producer)}/${address}`;
const ready = (machines, machine) => machines.some(m => (m?.name ?? null) === machine && m.layout === 'ready');
const root = t => typeof t?.argv?.[0] === 'string' ? t.argv[0].split(/[\\/]/).pop().toLowerCase().replace(/\.(cmd|bat|exe|sh)$/, '') : null;
const continuous = (live, saved) => saved.program !== null && root(live) === saved.program && saved.run !== null && live?.labels?.['herdr.run'] === saved.run;
const same = (live, saved) => live?.state === 'live' && live.created_ms === saved.created && live.pid === saved.pid;
const unknown = why => ({ status: 'unknown', why });
function valid(doc) {
  if (!string(doc?.producer?.core) || !incarnation(doc.producer.terminal) || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || !Array.isArray(doc.assignments)) return false;
  const ids = new Set();
  return doc.assignments.every(a => {
    if (!string(a?.id) || ids.has(a.id) || !incarnation(a.child) || !Number.isSafeInteger(a.revision) || a.revision > doc.revision) return false;
    ids.add(a.id);
    return a.state === 'active' ? a.ended === null : a.state === 'ended' && reasons.includes(a.ended?.reason) && Number.isSafeInteger(a.ended.revision) && a.ended.revision <= doc.revision;
  });
}
export function assessDelegations({ text, producer, terminals = [], machines = [], lastRevision = null, coreId = null }) {
  if (typeof producer?.address !== 'string') return unknown('no-producer');
  if (!ready(machines, machineOf(producer.address))) return unknown('machine-unavailable');
  if (text == null) return unknown('missing');
  if (typeof text !== 'string' || text.length > 1048576) return unknown('unreadable');
  let doc; try { doc = JSON.parse(text); } catch { return unknown('unreadable'); }
  if (doc?.schema !== 'herdr-agents/delegations') return unknown('not-a-contract');
  if (doc.version !== 1) return unknown('version-unknown');
  if (!valid(doc)) return unknown('malformed');
  const saved = doc.producer.terminal;
  if (localOf(producer.address) !== saved.address || !same(producer, saved)) return unknown('producer-mismatch');
  if (!continuous(producer, saved)) return unknown('producer-continuity');
  if (coreId !== null && coreId !== doc.producer.core) return unknown('core-mismatch');
  if (lastRevision !== null && doc.revision < lastRevision) return unknown('revision-backwards');
  const assignments = doc.assignments.map(a => {
    // JSON parsing owns these records; results never alias caller observations.
    const base = { id: a.id, role: a.role ?? null, project: a.project ?? null, item: a.item ?? null, child: a.child };
    if (a.state === 'ended') return { ...base, state: 'ended', reason: a.ended.reason, ...(a.ended.by ? { by: a.ended.by } : {}) };
    const address = qualifyChild(a.child.address, producer.address);
    const fail = why => ({ ...base, state: 'unknown', why });
    if (!ready(machines, machineOf(address))) return fail('child-machine-unavailable');
    if (a.child.address.includes('/')) return fail('child-cross-core');
    const matches = terminals.filter(t => t?.address === address);
    if (!matches.length) return fail('child-missing');
    if (matches.length !== 1) return fail('child-ambiguous');
    const child = matches[0];
    if (child.state !== 'live') return fail('child-finished');
    if (!same(child, a.child)) return fail('child-incarnation');
    if (child.keep !== false || !continuous(child, a.child)) return fail('child-continuity');
    if (child.labels?.['herdr.launch'] !== a.id) return fail('child-launch-label');
    if (child.parent !== producer.address) return fail('child-parent');
    return { ...base, state: 'active' };
  });
  return { status: 'ok', revision: doc.revision, assignments };
}

// A pure history transition, keyed by explicit core evidence when available,
// routing namespace otherwise. Keep history across disconnects; never reuse text.
export function consumeDelegations(input, history = []) {
  const p = input.producer;
  const key = JSON.stringify([input.coreId ?? machineOf(p?.address ?? ''), input.coreId != null ? localOf(p?.address ?? '') : p?.address, p?.created_ms, p?.pid, p?.labels?.['herdr.run']]);
  const previous = history.find(h => h.key === key)?.revision ?? null;
  const result = assessDelegations({ ...input, lastRevision: previous });
  const next = history.map(h => ({ ...h }));
  if (result.status === 'ok') {
    const entry = next.find(h => h.key === key);
    if (entry) entry.revision = Math.max(entry.revision, result.revision);
    else next.push({ key, revision: result.revision });
  }
  return { result, history: next.sort((a, b) => a.key.localeCompare(b.key)) };
}

const absolute = p => typeof p === 'string' && p.length <= 4096 && !/[\x00-\x1f\x7f]/.test(p) && (/^\//.test(p) || /^[A-Za-z]:\//.test(p));
// Caller supplies deadline via cx.timer.after (never cx.sleep), and a generation
// token changed on every refresh/disconnect/reconnect. No cached success fallback.
export async function readDelegations(host, producer, generation) {
  const path = producer?.labels?.['herdr.delegations'];
  if (!absolute(path)) return unknown('invalid-path');
  try {
    const text = await host.deadline(Promise.resolve().then(() => host.readTextFile(path, { on: machineOf(producer.address) })));
    if (host.generation() !== generation) return unknown('superseded-read');
    if (text !== null && (typeof text !== 'string' || text.length > 1048576)) return unknown('unreadable');
    return { status: 'read', text, generation };
  } catch { return unknown('missing'); }
}
