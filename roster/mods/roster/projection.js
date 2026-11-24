import { tuple } from './normalize.js';
import { rowIdentity, navigationTarget, navigationOrder } from './navigation-rows.js';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sortRows = rows => [...rows].sort((a, b) => compare(rowIdentity(a), rowIdentity(b)));
const distinct = rows => [...new Map(rows.map(r => [rowIdentity(r), r])).values()];
const current = r => r.lifecycle === 'live' && r.freshness === 'current';
const finished = r => r.lifecycle === 'finished';

// Spaces lists Herdr's Spaces (spaces.js); Projects and Status list agents.
export const VIEWS = Object.freeze(['spaces', 'projects', 'status']);
export function viewState(input = {}) {
  return { view: VIEWS.includes(input.view) ? input.view : 'projects',
    coreIds: input.coreIds == null ? null : [...new Set(input.coreIds)].sort((a, b) => compare(tuple(a), tuple(b))),
    contextIds: input.contextIds == null ? null : [...new Set(input.contextIds)].sort((a, b) => compare(tuple(a), tuple(b))),
    folds: Object.fromEntries(Object.entries(input.folds ?? {}).filter(([, v]) => typeof v === 'boolean').sort(([a], [b]) => compare(a, b))) };
}
export function transition(state, event) {
  const next = viewState(state);
  if (event?.type === 'view') next.view = VIEWS.includes(event.view) ? event.view : 'projects';
  if (event?.type === 'filters') {
    if (Object.hasOwn(event, 'coreIds')) next.coreIds = event.coreIds;
    if (Object.hasOwn(event, 'contextIds')) next.contextIds = event.contextIds;
  }
  if (event?.type === 'fold' && typeof event.key === 'string') next.folds[event.key] = event.collapsed === true;
  return viewState(next);
}
export function filterReasons(row, state) {
  const reasons = [];
  if (state.coreIds !== null && !state.coreIds.includes(row.core.verified ? row.core.id : null)) reasons.push('core-outside-filter');
  if (state.contextIds !== null && !state.contextIds.includes(row.executionContext.id)) reasons.push('context-outside-filter');
  return reasons;
}
function status(row) {
  if (row.freshness === 'offline') return 'Offline';
  if (row.freshness === 'stale') return 'Stale';
  if (row.freshness !== 'current') return 'Unknown';
  if (finished(row)) return 'Done';
  if (!current(row)) return 'Unknown';
  if (row.roster.state === 'child-needs-you') return 'Child needs you';
  if (row.roster.group === 'Needs you') return 'Needs you';
  if (row.roster.group === 'Working') return 'Working';
  if (row.appStatus === 'done') return 'Done';
  if (row.appStatus === 'idle') return 'Idle';
  return 'Unknown';
}
// Canonical remote identity: host/owner/repo from an https, ssh:// or scp-like git remote.
// Only an explicitly supplied remote is parsed; nothing is discovered or read here.
export function canonicalRepository(remote) {
  if (typeof remote !== 'string' || remote.length > 512 || /[\s\x00-\x1f\x7f]/.test(remote)) return null;
  const match = /^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[A-Za-z0-9._-]+@)([A-Za-z0-9.-]+)(?::[0-9]+)?[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote);
  if (!match || ['.', '..'].includes(match[2]) || ['.', '..'].includes(match[3])) return null;
  return match[1].toLowerCase() + '/' + match[2] + '/' + match[3];
}
// A repository fact counts only for a verified identity with exactly one verified,
// sourced assertion; a role, folder, tab or machine alias never makes one.
function verifiedRepository(row, repositories) {
  if (!row.core.verified || !row.associationKey) return null;
  const facts = repositories.filter(e => e?.associationKey === row.associationKey);
  const ids = [...new Set(facts.map(e => e?.verified === true && e.coreId === row.core.id
    && typeof e.source === 'string' && e.source.trim() ? canonicalRepository(e.remote) : null))];
  return ids.length === 1 ? ids[0] : null;
}
// Identified: a role label or an agent that reports a status. Plain shells and raw IDs are not.
export const identified = row => row.role !== 'unknown' || row.rawStatus !== 'unknown';
function placement(row, scopes, repositories = [], spaces = {}) {
  if (row.project.id) return { key: tuple('project', row.project.id), label: row.project.displayName, projectId: row.project.id };
  const facts = scopes.filter(e => e?.associationKey === row.associationKey && row.associationKey);
  if (row.core.verified && facts.length === 1 && facts[0].verified === true && facts[0].scope === 'core-wide'
    && facts[0].coreId === row.core.id && typeof facts[0].source === 'string' && facts[0].source.trim()) {
    return { key: tuple('infrastructure'), label: 'Infrastructure', projectId: null };
  }
  // Project first; a verified repository is the fallback.
  const repository = verifiedRepository(row, repositories);
  if (repository) return { key: tuple('repository', repository), label: repository, projectId: null, repository };
  // Unidentified shells and raw IDs wait in their own folded group.
  if (!identified(row)) return { key: tuple('unidentified'), label: 'Unidentified', projectId: null };
  // Then the Herdr Space that shows the terminal, named as a Space: not a project or repo claim.
  const space = Object.hasOwn(spaces, row.address) ? spaces[row.address] : null;
  if (space) return { key: tuple('space', space.machine, space.id), label: space.name, projectId: null, space };
  return { key: tuple('other'), label: 'Other', projectId: null };
}
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
const ROLE_TITLES = { coordinator: 'Coordinator', planner: 'Planner', developer: 'Developer', reviewer: 'Reviewer', watcher: 'Watcher', supervisor: 'Supervisor' };
// What an alert can prove. The project only when the terminal has a verified project (a
// Space is where it is shown, not its project). The recipient is verified only when the alerting terminal names
// a delivery (herdr.delivery) and exactly one other live terminal on the same machine
// carries the same delivery. The issue comes from the alert itself or that recipient; the
// reason only from the terminal's own reported message. Names, folders and tabs never count.
export function alertFacts(row, rows, spaces = {}, navigation = {}) {
  const project = row.project.id ? row.project.displayName : null;
  const delivery = token(row.labels?.['herdr.delivery']);
  const peers = delivery ? rows.filter(r => r !== row && current(r) && r.core.alias === row.core.alias && r.labels?.['herdr.delivery'] === delivery) : [];
  const recipientRow = peers.length === 1 ? peers[0] : null;
  const item = row.workItem ?? recipientRow?.workItem ?? null;
  const reason = typeof row.reportMessage === 'string' && row.reportMessage.trim() ? row.reportMessage.trim() : null;
  const missing = [];
  if (!project) missing.push({ field: 'project', detail: 'no verified project for this terminal' });
  if (!item) missing.push({ field: 'issue', detail: recipientRow ? 'no herdr.issue on this terminal or its recipient' : 'no herdr.issue on this terminal' });
  if (!reason) missing.push({ field: 'reason', detail: 'no status message reported by this terminal' });
  if (!recipientRow) missing.push({ field: 'recipient', detail: !delivery ? 'no herdr.delivery label on this terminal'
    : peers.length ? 'more than one live terminal on this machine shares its herdr.delivery' : 'no other live terminal on this machine shares its herdr.delivery' });
  return { project, issue: item ? (item.kind === 'pr' ? 'PR #' : '#') + item.numberOrId : null, reason, missing,
    recipient: recipientRow ? { identity: rowIdentity(recipientRow), role: recipientRow.role, title: ROLE_TITLES[recipientRow.role] ?? 'agent',
      label: recipientRow.displayLabel, address: recipientRow.address, navigation: navigationTarget(recipientRow, rows, navigation) } : null };
}
// Projects, repositories, Spaces (Herdr's order), Infrastructure, Other, then Unidentified.
const rank = group => group.key === tuple('unidentified') ? 5 : group.key === tuple('other') ? 4 : group.label === 'Infrastructure' ? 3
  : group.space ? 2 : group.repository ? 1 : 0;
function counts(rows) {
  const unique = distinct(rows);
  return { identities: unique.length, working: unique.filter(r => current(r) && r.appStatus === 'working').length,
    waiting: unique.filter(r => r.roster.state === 'waiting').length,
    needsYou: unique.filter(r => r.roster.actionable).length };
}

// Input is the actual R2 result over R1 metadata rows. No acquisition, commands,
// ambient storage, inferred assignments or rewritten native fields live here.
// collapseUnassigned: the Other project group and the Status Unknown group start
// folded (a count stays on the header); an explicit fold in state always wins.
export function projectRoster(reduced, inputState = {}, { scopes = [], repositories = [], spaces = {}, navigation = {}, collapseUnassigned = false } = {}) {
  const state = viewState(inputState), rows = sortRows(reduced.rows), instances = [];
  const filtered = rows.filter(r => !filterReasons(r, state).length);
  const placements = new Map(rows.map(r => [rowIdentity(r), placement(r, scopes, repositories, spaces)]));
  const byAssociation = new Map(rows.filter(r => r.associationKey).map(r => [r.associationKey, r]));
  const open = (key, fallback = false) => !(state.folds[key] ?? fallback);
  function header(path, label, depth, defaultCollapsed = false, extra = {}) {
    const key = tuple(state.view, ...path);
    instances.push({ kind: 'section', key, label, depth, collapsed: !open(key, defaultCollapsed), ...extra });
    return open(key, defaultCollapsed);
  }
  function terminal(row, path, depth, contextOnly = false, extra = {}) {
    const identity = rowIdentity(row), outsideFilters = filterReasons(row, state);
    const parent = row.parent.resolution === 'verified' ? byAssociation.get(row.parent.associationKey) : null;
    // Pinned rows keep one key in every view, so a selection survives a tab switch.
    const key = extra.pinned ? tuple(...path, identity) : tuple(state.view, ...path, identity);
    instances.push({ kind: 'terminal', key, identity, row, depth, contextOnly, outsideFilters,
      placement: placements.get(identity), status: status(row),
      identityDiagnostic: rows.filter(r => r.terminalKey === row.terminalKey && r.lifecycle !== 'finished').length > 1 ? 'ambiguous-incarnation' : row.associationKey ? null : 'unverified-incarnation',
      context: { project: row.project, parent: parent ? { associationKey: parent.associationKey, displayLabel: parent.displayLabel } : null,
        parentResolution: row.parent.resolution, coreId: row.core.id, coreAlias: row.core.alias,
        hostLabel: row.core.hostLabel, executionContext: row.executionContext },
      navigation: outsideFilters.length || contextOnly ? { enabled: false, reason: outsideFilters.length ? 'outside-current-filters' : 'context-only', target: null }
        : navigationTarget(row, rows, navigation),
      health: 'unknown',
      diagnostic: row.role === 'supervisor' && current(row) && row.core.verified
        && distinct(rows.filter(r => r.role === 'supervisor' && current(r) && r.core.verified && r.core.id === row.core.id)).length > 1 ? 'multiple-supervisors' : null,
      space: Object.hasOwn(spaces, row.address) ? spaces[row.address] : null,
      display: { ...row.roster.display, error: row.rawStatus === 'error' && !row.statusConflict ? 'Error' : null }, ...extra });
    return key;
  }
  // Needs you is pinned above the tabs: the same section, rows and keys in every view
  // (Spaces too), each pending session once, local or remote, independent of every fold.
  // Filters still apply to acting on a row, as everywhere else.
  const attention = distinct(rows.filter(r => r.roster.actionable));
  if (attention.length) {
    instances.push({ kind: 'section', key: tuple('attention'), label: 'Needs you', depth: 0, collapsed: false, pinned: true, counts: counts(attention) });
    for (const row of attention) terminal(row, ['attention'], 1, false, { pinned: true, alert: alertFacts(row, rows, spaces, navigation) });
  }
  if (state.view === 'spaces') {
    // No agent rows here.
  } else if (state.view === 'status') {
    for (const label of ['Child needs you', 'Working', 'Done', 'Idle', 'Offline', 'Stale', 'Unknown']) {
      const members = filtered.filter(r => status(r) === label && !r.roster.actionable);
      if (!members.length) continue;
      const path = ['status', label];
      if (header(path, label, 0, label === 'Done' || (collapseUnassigned && label === 'Unknown'), { counts: counts(members) })) for (const row of members) terminal(row, path, 1, row.roster.state === 'child-needs-you');
    }
  } else {
    const groups = [...new Map(filtered.map(r => [placements.get(rowIdentity(r)).key, placements.get(rowIdentity(r))])).values()]
      .sort((a, b) => rank(a) - rank(b) || (a.space && b.space ? compare(tuple(a.space.machine ?? ''), tuple(b.space.machine ?? '')) || a.space.order - b.space.order : 0) || compare(a.key, b.key));
    for (const group of groups) {
      const members = filtered.filter(r => placements.get(rowIdentity(r)).key === group.key), memberKeys = new Set(members.map(rowIdentity));
      const parentOf = new Map();
      for (const row of members) {
        const p = row.parent.resolution === 'verified' ? byAssociation.get(row.parent.associationKey) : null;
        // Lift live branches to this placement's roots across a finished edge.
        // Keep the exact original parent in context; never invent a new edge.
        // This applies even when history is expanded, so no identity duplicates.
        if (p && p !== row && memberKeys.has(rowIdentity(p)) && !(finished(p) && !finished(row))) parentOf.set(rowIdentity(row), rowIdentity(p));
      }
      // Defensive cut even if a caller bypasses R1's cycle removal.
      for (const row of members) {
        const path = [], seen = new Set(); let id = rowIdentity(row);
        while (parentOf.has(id) && !seen.has(id)) { seen.add(id); path.push(id); id = parentOf.get(id); }
        if (seen.has(id)) for (const cyclic of path.slice(path.indexOf(id))) parentOf.delete(cyclic);
      }
      const path = ['projects', group.key];
      if (!header(path, group.label, 0, collapseUnassigned && [tuple('other'), tuple('unidentified')].includes(group.key),
        { projectId: group.projectId, space: group.space ?? null, repository: group.repository ?? null, counts: counts(members) })) continue;
      // Iterative event stack prevents recursive overflow on deep actual ancestry.
      const stack = [{ type: 'siblings', siblings: members.filter(r => !parentOf.has(rowIdentity(r))), path, depth: 1 }];
      while (stack.length) {
        const job = stack.pop();
        if (job.type === 'siblings') {
          const active = job.siblings.filter(r => !finished(r)), done = job.siblings.filter(finished);
          if (done.length) stack.push({ type: 'done', siblings: done, path: [...job.path, 'done'], depth: job.depth });
          for (const row of [...active].reverse()) stack.push({ type: 'row', row, path: job.path, depth: job.depth });
        } else if (job.type === 'done') {
          if (header(job.path, 'Done', job.depth, true, { count: job.siblings.length }))
            for (const row of [...job.siblings].reverse()) stack.push({ type: 'row', row, path: job.path, depth: job.depth + 1 });
        } else {
          // The roster stays complete: an alert's terminal is also listed in its group, but
          // as an echo of the Needs you row, never a second equal-prominence alert.
          const key = terminal(job.row, job.path, job.depth, job.row.roster.state === 'child-needs-you', job.row.roster.actionable ? { echo: true } : {});
          if (open(key)) stack.push({ type: 'siblings', siblings: members.filter(r => parentOf.get(rowIdentity(r)) === rowIdentity(job.row)),
            path: [...job.path, rowIdentity(job.row)], depth: job.depth + 1 });
        }
      }
    }
  }
  // Full detail whenever delegate children are not all visible directly below
  // this exact parent instance. Status is flat, so it always uses full detail.
  for (const i of instances.filter(i => i.kind === 'terminal' && i.row.roster.state === 'waiting')) {
    const delegates = i.row.roster.delegation.delegates;
    const allBelow = state.view === 'projects' && !state.folds[i.key] && delegates.every(d => instances.some(child =>
      child.kind === 'terminal' && child.row.associationKey === d.associationKey && child.depth === i.depth + 1
      && child.context.parent?.associationKey === i.row.associationKey && child.key !== i.key));
    i.display.label = allBelow ? null : i.display.detail;
    i.display.compact = allBelow;
  }
  const visible = instances.filter(i => i.kind === 'terminal').map(i => i.row);
  return { state, binding: { state: viewState(state), generation: navigation.generation ?? null },
    instances, order: navigationOrder(instances), counts: {
    all: counts(rows), filtered: counts(filtered), visible: counts(visible),
    outsideFilterAttention: counts(attention.filter(r => filterReasons(r, state).length)) } };
}
