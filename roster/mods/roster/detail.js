// Pure presentation only. Facts come from a projected instance, never from names.
const reasons = { 'unverified-identity': 'Open unavailable: terminal identity is unverified',
  'not-current-live': 'Open unavailable: terminal is stale or absent',
  'missing-or-ambiguous-route-evidence': 'Open unavailable: current route is unverified',
  'outside-current-filters': 'Outside current filters', 'context-only': 'Context for a child that needs you',
  'multiple-panes': 'Open unavailable: more than one pane shows this terminal',
  'pane-tab-unverified': 'Open unavailable: its pane is not in a tab on its own machine',
  'machine-not-ready': 'Open unavailable: its machine is not connected or not ready',
  'invalid-route': 'Open unavailable: its address does not match its machine',
  'pane-model-invalid': 'Open unavailable: the pane list is inconsistent',
  'ambiguous-terminal': 'Open unavailable: more than one terminal has this address',
  'ambiguous-incarnation': 'Open unavailable: more than one terminal has this address',
  'incarnation-unknown': 'Open unavailable: terminal start time is unknown',
  'terminal-changed': 'Open unavailable: the terminal changed since the list was drawn',
  'pane-evidence-stale': 'Not opened: the list changed; try again',
  'projection-state-changed': 'Not opened: the list changed; try again',
  'target-changed': 'Not opened: the pane changed; try again',
  'not-actionable-instance': 'Not opened: this row is no longer in the list',
  'identity-changed': 'Not opened: the terminal changed; try again' };
export const reasonText = reason => reasons[reason] ?? ('Open unavailable: ' + reason);
export function actionReason(instance) {
  return instance.navigation.enabled ? 'Open available' : reasons[instance.navigation.reason]
    ?? ('Open unavailable: ' + instance.navigation.reason);
}
export function rowContext(instance) {
  const { row, context } = instance;
  const project = row.project.displayName || 'Unassigned';
  const parent = context.parent?.displayLabel ?? (context.parentResolution === 'none' ? 'Not reported'
    : 'Unknown (' + (context.parentResolution ?? 'unresolved') + ')');
  const route = row.core.alias ? 'Route ' + row.core.alias : 'Local route';
  const machine = row.core.hostLabel ? row.core.hostLabel + ' · ' + route : route + ' (host unknown)';
  // Compact row facts: only what is known. Unknown project/context stay in Details.
  return { project, parent, machineSummary: row.core.hostLabel ? row.core.hostLabel + ' · ' + route : route,
    machineShort: row.core.hostLabel ?? (row.core.alias || 'This computer'),
    knownProject: row.project.id ? project : null,
    knownContext: row.executionContext.id ? row.executionContext.label : null,
    machine: machine + (row.core.verified ? '' : ' · identity unverified'),
    context: row.executionContext.label || 'Context unknown' };
}
export function detailFields(instance) {
  const { row } = instance, context = rowContext(instance);
  const field = (id, label, value) => ({ id, label, value });
  const fields = [field('name', 'Name', row.displayLabel), field('project', 'Project', context.project),
    field('parent', 'Parent', context.parent), field('machine', 'Machine / route', context.machine),
    field('context', 'Execution context', context.context),
    field('state', 'State', [instance.display.error ?? instance.status, row.lifecycle, row.freshness].filter(Boolean).join(' · '))];
  if (row.project.resolution && row.project.id == null) fields[1].value += ' (' + row.project.resolution + ')';
  // Name the unbound label literally; it is shown, never used to group.
  const token = row.project.resolution === 'unbound' ? row.project.evidence?.[0]?.token : null;
  if (token) fields[1].value += ': label herdr.project=' + token + (row.core.verified ? ' has no local binding' : ' needs a verified Core to bind');
  const repository = instance.placement?.repository;
  fields.splice(2, 0, field('repository', 'Repository', repository ?? 'Not verified'));
  if (row.roster.state === 'waiting') fields.push(field('waiting', 'Waiting', instance.display.detail ?? 'Waiting detail unavailable'));
  fields.push(field('provider', 'Work item / project provider', row.providerBadge?.accessibleName ?? 'Unknown'),
    field('availability', 'Action availability', actionReason(instance)));
  if (instance.outsideFilters.length) fields.push(field('filters', 'Outside filters', instance.outsideFilters.join(' · ')));
  if (instance.identityDiagnostic) fields.push(field('diagnostic', 'Identity diagnostic', instance.identityDiagnostic));
  return fields;
}
export const detailLabel = instance => detailFields(instance).map(f => f.label + ': ' + f.value).join(' · ');

// Hover is a short, pre-wrapped summary; the full facts stay in Info and the
// accessibility label. Each logical line is capped, then wrapped at spaces.
export const HOVER_WIDTH = 40, HOVER_LINE_CAP = 80;
const clip = (value, limit) => { const points = Array.from(value); return points.length > limit ? points.slice(0, limit - 1).join('') + '…' : value; };
export function wrapText(value, width = HOVER_WIDTH) {
  const lines = [];
  let line = [];
  for (const word of value.split(/\s+/).filter(Boolean)) {
    let points = Array.from(word);
    while (points.length) {
      const room = width - (line.length ? line.length + 1 : 0);
      if (points.length <= room) { line = line.length ? [...line, ' ', ...points] : points; points = []; }
      else if (line.length) { lines.push(line.join('')); line = []; }
      else { lines.push(points.slice(0, width).join('')); points = points.slice(width); }
    }
  }
  if (line.length) lines.push(line.join(''));
  return lines.join('\n');
}
export function hoverText(instance, status) {
  const lines = [instance.row.displayLabel + ' · ' + status];
  if (!instance.navigation.enabled) lines.push(actionReason(instance));
  return lines.map(line => wrapText(clip(line.replace(/\s+/g, ' ').trim(), HOVER_LINE_CAP))).join('\n');
}

// Agent details for the inline disclosure: only verified or host-reported facts, empty
// fields hidden, identifiers and paths under Technical details. Pure: the caller
// passes the projected instance, the same snapshot, the reduced rows and the home.
const ROLE_TITLES = { coordinator: 'Coordinator', planner: 'Planner', developer: 'Developer', reviewer: 'Reviewer', watcher: 'Watcher', supervisor: 'Supervisor' };
export function workItemUrl(item) {
  if (!item) return null;
  if (/^https:\/\//.test(item.reference)) return item.reference;
  if (item.provider === 'github') return `https://github.com/${item.repositoryIdentity}/${item.kind === 'pr' ? 'pull' : 'issues'}/${item.numberOrId}`;
  return null;
}
// A local path under the home folder is written ~/...; a remote path stays as reported.
export function homeRelative(path, home, local) {
  if (typeof path !== 'string' || !path) return null;
  if (!local || typeof home !== 'string' || !home) return path;
  const norm = value => value.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '');
  const p = norm(path), h = norm(home);
  return p.toLowerCase() === h.toLowerCase() ? '~' : p.toLowerCase().startsWith(h.toLowerCase() + '/') ? '~' + p.slice(h.length) : path;
}
export function agentFacts(instance, { snapshot = {}, rows = [], home = null } = {}) {
  const { row } = instance, context = rowContext(instance), local = !row.address.includes('/');
  const fields = [], technical = [];
  const add = (list, id, label, value, extra = {}) => { if (value != null && String(value).trim()) list.push({ id, label, value: String(value), ...extra }); };
  add(fields, 'name', 'Name', row.displayLabel);
  add(fields, 'role', 'Role', ROLE_TITLES[row.role]);
  const waiting = row.roster.state === 'waiting' ? instance.display.detail : null;
  add(fields, 'state', 'State', waiting ?? instance.display.error ?? instance.status);
  const delegation = row.roster.delegation;
  if (delegation?.knowledge === 'known') {
    const byKey = new Map(rows.map(r => [r.associationKey, r]));
    const active = delegation.delegates.filter(d => d.working).map(d => byKey.get(d.associationKey)?.displayLabel ?? ROLE_TITLES[d.role] ?? 'Agent');
    add(fields, 'delegates', 'Active delegates', active.length ? active.length + ': ' + active.join(', ') : null);
  }
  add(fields, 'machine', 'Machine', context.machineShort);
  // Herdr context: the Space and tab that show it, from Herdr's own model.
  const pane = (snapshot.panes ?? []).find(p => p?.terminal === row.address);
  const space = pane ? (snapshot.spaces ?? []).find(s => (s?.tabs ?? []).some(t => t?.id === pane.tab)) : null;
  const tab = space?.tabs.find(t => t.id === pane.tab);
  add(fields, 'space', 'Space', space?.name);
  add(fields, 'tab', 'Tab', tab ? (tab.named ? tab.name : 'Tab ' + tab.name) : null);
  add(fields, 'context', 'Execution context', context.knownContext);
  add(fields, 'project', 'Project', context.knownProject);
  add(fields, 'repository', 'Repository', instance.placement?.repository);
  const item = row.workItem, url = workItemUrl(item);
  if (item) add(fields, 'work-item', item.kind === 'pr' ? 'Pull request' : 'Issue',
    item.provider === 'github' ? `${item.repositoryIdentity}#${item.numberOrId}` : `${item.repositoryIdentity} ${item.numberOrId}`, url ? { href: url } : {});
  const raw = (snapshot.terminals ?? []).find(t => t?.address === row.address);
  add(technical, 'address', 'Address', row.address);
  add(technical, 'pane', 'Pane', pane?.pane);
  add(technical, 'space-id', 'Space ID', space?.id);
  add(technical, 'started', 'Started', Number.isSafeInteger(row.incarnation) ? new Date(row.incarnation).toISOString() : null);
  add(technical, 'folder', 'Folder', homeRelative(raw?.cwd, home, local));
  add(technical, 'identity', 'Identity', row.associationKey ? 'verified' : 'provisional (no verified Core)');
  if (!instance.navigation.enabled) add(technical, 'open', 'Go to terminal', actionReason(instance));
  return { fields, technical };
}
