import { list, object, stamp, text, tuple } from './normalize.js';

const roles = ['coordinator', 'planner', 'developer', 'reviewer', 'watcher', 'supervisor'];
const providers = ['github', 'azure-devops'];
const titles = { coordinator: 'Coordinator', planner: 'Planner', developer: 'Developer', reviewer: 'Reviewer', watcher: 'Watcher', supervisor: 'Supervisor' };
const token = value => {
  const s = text(value);
  return s && s === value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s) ? s : null;
};
const positive = s => /^[1-9][0-9]*$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : null;

export function parseWorkItem(value, kind = 'issue') {
  const s = text(value);
  if (!s || !['issue', 'pr'].includes(kind)) return null;
  let match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(s);
  if (match && positive(match[2])) return { provider: 'github', repositoryIdentity: match[1], kind, numberOrId: Number(match[2]), reference: s };
  match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9][0-9]*)$/.exec(s);
  if (match && positive(match[3]) && (kind === 'pr' ? match[2] === 'pull' : match[2] === 'issues')) return { provider: 'github', repositoryIdentity: match[1], kind, numberOrId: Number(match[3]), reference: s };
  match = /^https:\/\/dev\.azure\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/_workitems\/edit\/([1-9][0-9]*)$/.exec(s);
  if (match && kind === 'issue' && positive(match[3])) return { provider: 'azure-devops', repositoryIdentity: `${match[1]}/${match[2]}`, kind: 'issue', numberOrId: Number(match[3]), reference: s };
  match = /^https:\/\/dev\.azure\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/_git\/([A-Za-z0-9_.-]+)\/pullrequest\/([1-9][0-9]*)$/.exec(s);
  if (match && kind === 'pr' && positive(match[4])) return { provider: 'azure-devops', repositoryIdentity: `${match[1]}/${match[2]}/${match[3]}`, kind, numberOrId: Number(match[4]), reference: s };
  return null;
}

// Normalizes explicit data only; no storage or asset system is implemented here.
export function normalizeConfig(value) {
  const c = object(value), rejected = [];
  function entries(key, convert) {
    return list(c[key]).flatMap((v, index) => {
      const result = convert(object(v));
      if (!result) rejected.push({ field: key, index });
      return result ? [result] : [];
    });
  }
  const selector = r => {
    const coreId = token(r.coreId);
    if (!coreId) return null;
    if (r.terminalId == null && r.incarnation == null) return { coreId, terminalId: null, incarnation: null };
    return /^t[1-9][0-9]*$/.test(r.terminalId) && stamp(r.incarnation) !== null ? { coreId, terminalId: r.terminalId, incarnation: r.incarnation } : null;
  };
  return {
    projects: entries('projects', r => token(r.id) && text(r.displayName) ? { id: r.id, displayName: text(r.displayName) } : null),
    projectBindings: entries('projectBindings', r => token(r.coreId) && token(r.token) && token(r.projectId) ? { coreId: r.coreId, token: r.token, projectId: r.projectId } : null),
    contexts: entries('contexts', r => {
      const scope = selector(r);
      return scope && token(r.id) && text(r.label) && ['verified', 'explicit-map'].includes(r.source) && (scope.terminalId || r.exclusive === true)
        ? { ...scope, id: r.id, label: text(r.label), source: r.source } : null;
    }),
    processProviders: entries('processProviders', r => {
      const scope = selector(r);
      return scope?.terminalId && providers.includes(r.provider) ? { ...scope, provider: r.provider } : null;
    }),
    projectProviders: entries('projectProviders', r => token(r.projectId) && providers.includes(r.provider) && r.applicable === true ? { projectId: r.projectId, provider: r.provider } : null),
    rejected,
  };
}
const unknownProject = (resolution = 'unknown', evidence = []) => ({ id: null, displayName: 'Unassigned', source: 'unknown', resolution, evidence });
function unique(items, key) { return [...new Map(items.map(x => [key(x), x])).values()]; }
function scopeMatches(entry, row) {
  return row.core.verified && entry.coreId === row.core.id && (!entry.terminalId || (entry.terminalId === row.terminalId && entry.incarnation === row.incarnation));
}

export function enrichMetadata(input, configInput = {}) {
  const config = normalizeConfig(configInput);
  const rows = list(input).map(row => {
    const labels = row.labels, invalid = row.invalidLabels;
    const role = !row.metadataConflict && roles.includes(labels['herdr.role']) ? labels['herdr.role'] : 'unknown';
    const tasks = ['issue', 'pr'].flatMap(kind => {
      const item = parseWorkItem(labels[`herdr.${kind}`], kind);
      return item ? [{ ...item, source: `label:herdr.${kind}` }] : [];
    });
    const taskPresent = ['herdr.issue', 'herdr.pr'].some(k => Object.hasOwn(labels, k) || invalid.includes(k));
    const taskFields = ['herdr.issue', 'herdr.pr'].filter(k => Object.hasOwn(labels, k) || invalid.includes(k));
    const taskConflict = row.metadataConflict || taskFields.length > 1;
    const workItem = taskConflict ? null : tasks[0] ?? null;
    const projectToken = token(labels['herdr.project']);
    let project = unknownProject();
    if (row.metadataConflict || invalid.includes('herdr.project') || (labels['herdr.project'] && !projectToken)) project = unknownProject('conflict', row.metadataEvidence);
    else if (projectToken) {
      const bindings = row.core.verified ? config.projectBindings.filter(b => b.coreId === row.core.id && b.token === projectToken) : [];
      const ids = [...new Set(bindings.map(b => b.projectId))];
      const definitions = unique(config.projects.filter(p => ids.includes(p.id)), p => tuple(p.id, p.displayName));
      if (ids.length === 1 && definitions.length === 1) project = { ...definitions[0], source: 'config:core-project-token', resolution: 'explicit', evidence: bindings.map(b => ({ ...b })) };
      else project = unknownProject(ids.length > 1 || definitions.length > 1 ? 'conflict' : 'unbound', [{ coreId: row.core.id, token: projectToken }]);
    }
    const contexts = config.contexts.filter(c => scopeMatches(c, row));
    // Terminal assertions override a core-wide assertion; conflicts at one scope stay unknown.
    const terminalContexts = contexts.filter(c => c.terminalId);
    const selected = unique(terminalContexts.length ? terminalContexts : contexts, c => tuple(c.id, c.label));
    const executionContext = selected.length === 1 ? { id: selected[0].id, label: selected[0].label, source: selected[0].source, evidence: selected.map(c => ({ ...c })) }
      : { id: null, label: 'Context unknown', source: 'unknown', evidence: contexts.map(c => ({ ...c })) };
    const fallback = row.tabNamed && row.tabTitle && !/^[0-9]+$/.test(row.tabTitle) ? row.tabTitle : row.name ?? row.core.name ?? row.address;
    return { ...row, role, roleSource: role === 'unknown' ? 'unknown' : 'label:herdr.role',
      displayLabel: role === 'unknown' ? fallback : `${titles[role]}${workItem ? ` ${workItem.kind === 'pr' ? 'PR ' : ''}#${workItem.numberOrId}` : ''}`,
      workItem, workItemResolution: taskConflict ? 'conflict' : workItem ? 'verified-reference' : taskPresent ? 'invalid' : 'unknown',
      workItemEvidence: tasks, project, executionContext, providerBadge: null,
    };
  });
  const byAssociation = new Map(rows.filter(r => r.associationKey).map(r => [r.associationKey, r]));
  // Resolve inheritance iteratively, bounded by row count, without recursion.
  for (let pass = 0; pass < rows.length; pass++) {
    let changed = false;
    for (const row of rows) {
      const parent = row.parent.resolution === 'verified' ? byAssociation.get(row.parent.associationKey) : null;
      if (!parent?.project.id) continue;
      if (row.project.id && row.project.id !== parent.project.id) { row.project = { ...row.project, resolution: 'parent-conflict', parentProjectId: parent.project.id }; continue; }
      if (!row.project.id && row.project.resolution === 'unknown') {
        row.project = { ...parent.project, source: 'parent:verified-membership', resolution: 'inherited', evidence: [{ parentAssociationKey: parent.associationKey, projectId: parent.project.id }] }; changed = true;
      }
    }
    if (!changed) break;
  }
  for (const row of rows) {
    let provider = row.workItem?.provider, source = row.workItem?.source;
    // Invalid/ambiguous task evidence blocks defaults, rather than laundering a badge.
    if (!provider && row.workItemResolution === 'unknown') {
      const process = unique(config.processProviders.filter(p => scopeMatches(p, row)), p => p.provider);
      if (process.length === 1) { provider = process[0].provider; source = 'config:process'; }
      else if (process.length === 0 && row.project.id && row.project.resolution !== 'parent-conflict') {
        const defaults = unique(config.projectProviders.filter(p => p.projectId === row.project.id), p => p.provider);
        if (defaults.length === 1) { provider = defaults[0].provider; source = 'config:project-default'; }
      }
    }
    if (provider) row.providerBadge = { id: provider, source, accessibleName: provider === 'github' ? 'GitHub' : 'Azure DevOps' };
  }
  return { rows, rejectedConfig: config.rejected };
}
