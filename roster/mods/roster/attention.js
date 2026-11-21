import { consumeDelegations, qualifyChild, machineOf } from './delegations.js';

const current = r => r?.lifecycle === 'live' && r.freshness === 'current';
const owns = r => current(r) && r.appStatus === 'blocked';
const working = r => current(r) && r.appStatus === 'working';
const key = r => r.associationKey ?? JSON.stringify([r.terminalKey, r.incarnation]);
// Match through R1 evidence, including aliases, never by terminal address alone.
function match(rows, raw) {
  if (!raw) return null;
  const found = rows.filter(r => r.core.verified && r.associationKey && r.incarnation === raw.created_ms
    && r.identityEvidence.some(e => e.address === raw.address)
    && r.processEvidence?.length > 0 && r.processEvidence.every(p => p?.pid === raw.pid && p?.run != null && p.run === raw.labels?.['herdr.run']));
  return found.length === 1 ? found[0] : null;
}
const detail = delegates => delegates.length === 1
  ? ['developer', 'reviewer'].includes(delegates[0].role)
    ? `Waiting for ${delegates[0].role === 'developer' ? 'Developer' : 'Reviewer'}` : 'Waiting on 1 agent'
  : `Waiting on ${delegates.length} agents`;

// No correlation is inferred from v1, role names, attention wording or ancestry.
// Optional evidence is a trusted host assertion about this exact observation.
function correlated(c, watcher, target, rawWatcher, rawTarget, generation) {
  const same = (e, r, t) => e?.associationKey === r?.associationKey && e?.pid === t?.pid
    && typeof e?.run === 'string' && e.run === t?.labels?.['herdr.run'];
  return c?.verified === true && c.soleCause === true && typeof c.source === 'string' && c.source.length > 0
    && generation != null && c.generation === generation && typeof c.delivery === 'string' && c.delivery.length > 0
    && c.delivery === c.targetDelivery && same(c.watcher, watcher, rawWatcher) && same(c.target, target, rawTarget)
    && rawWatcher?.state === 'live' && rawTarget?.state === 'live' && owns(watcher) && owns(target);
}

export function reduceRoster(rows, { documents = [], terminals = [], machines = [], history = [], correlations = [], generation = null } = {}) {
  const ordered = [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  const assessments = [], byParent = new Map(); let nextHistory = history.map(h => ({ ...h }));
  // Duplicate discoveries fail closed rather than selecting a contract by order.
  for (const row of ordered) {
    const candidates = documents.filter(d => match(ordered, d.producer) === row);
    if (candidates.length !== 1) continue;
    const d = candidates[0];
    const live = terminals.filter(t => t.address === d.producer.address);
    const exact = live.length === 1 && match(ordered, live[0]) === row
      && (generation === null || d.generation === generation);
    const consumed = consumeDelegations({ text: exact ? d.text : null, producer: exact ? live[0] : d.producer,
      terminals, machines, coreId: row.core.id }, nextHistory);
    nextHistory = consumed.history;
    assessments.push({ parent: row.associationKey, ...consumed.result });
    byParent.set(row.associationKey, consumed.result);
  }
  const actionable = ordered.filter(owns);
  const suppressed = new Set();
  for (const watcher of actionable.filter(r => r.role === 'watcher')) {
    const raw = terminals.filter(t => match(ordered, t) === watcher);
    // Multiple alias observations cannot establish one exact correlated event.
    if (raw.length !== 1 || !machines.some(m => (m.name ?? null) === machineOf(raw[0].address) && m.layout === 'ready')) continue;
    for (const target of actionable.filter(t => t !== watcher)) {
      const targetRaw = terminals.filter(t => match(ordered, t) === target);
      if (targetRaw.length === 1 && machines.some(m => (m.name ?? null) === machineOf(targetRaw[0].address) && m.layout === 'ready') && correlations.some(c => correlated(c, watcher, target, raw[0], targetRaw[0], generation))) suppressed.add(key(watcher));
    }
  }
  const targets = actionable.filter(r => !suppressed.has(key(r))).map(r => ({ associationKey: r.associationKey, terminalKey: r.terminalKey, incarnation: r.incarnation, address: r.address }));
  const resultRows = ordered.map(row => {
    const assessment = byParent.get(row.associationKey);
    const delegates = [], unresolved = [];
    if (assessment?.status === 'ok') for (const a of assessment.assignments) {
      if (a.state === 'ended') continue;
      if (a.state !== 'active') { unresolved.push(a.id); continue; }
      const producer = documents.find(d => match(ordered, d.producer) === row).producer;
      const address = qualifyChild(a.child.address, producer.address);
      const raw = terminals.filter(t => t.address === address && t.created_ms === a.child.created && t.pid === a.child.pid);
      const child = raw.length === 1 ? match(ordered, raw[0]) : null;
      if (!child || child.core.id !== row.core.id || child.parent.resolution !== 'verified'
        || child.parent.associationKey !== row.associationKey || !current(child)) { unresolved.push(a.id); continue; }
      if (child.appStatus === 'done') continue;
      delegates.push({ id: a.id, associationKey: child.associationKey, role: child.role, working: working(child) });
    }
    const children = ordered.filter(c => c !== row && c.parent.resolution === 'verified'
      && c.parent.associationKey === row.associationKey && owns(c) && !suppressed.has(key(c)))
      .map(c => ({ associationKey: c.associationKey, address: c.address, terminalKey: c.terminalKey, incarnation: c.incarnation }));
    const waiting = current(row) && row.appStatus === 'idle' && row.role === 'coordinator'
      && delegates.length > 0 && delegates.some(d => d.working);
    const state = owns(row) && !suppressed.has(key(row)) ? 'needs-you' : current(row) && children.length ? 'child-needs-you'
      : waiting ? 'waiting' : working(row) ? 'working' : current(row) ? row.appStatus : 'unknown';
    const waitingDetail = waiting ? detail(delegates) : null;
    return { ...row, roster: { state, group: ['waiting', 'working'].includes(state) ? 'Working'
      : ['needs-you', 'child-needs-you'].includes(state) ? 'Needs you' : 'Other',
      actionable: state === 'needs-you', attentionSuppressed: suppressed.has(key(row)), children,
      delegation: { knowledge: !assessment || assessment.status !== 'ok' ? 'unknown' : unresolved.length ? 'partial' : 'known',
        pendingCount: delegates.length, workingCount: delegates.filter(d => d.working).length, delegates, unresolved },
      display: { collapsedLabel: state === 'waiting' ? 'Waiting for delegate' : state === 'needs-you' ? 'Needs you'
        : state === 'child-needs-you' ? 'Child needs you' : state,
      icon: state === 'waiting' ? 'delegation-waiting' : state,
      tooltip: waitingDetail, detail: waitingDetail } } };
  });
  return { rows: resultRows, targets, counts: { working: ordered.filter(working).length, needsYou: targets.length }, assessments, history: nextHistory };
}
