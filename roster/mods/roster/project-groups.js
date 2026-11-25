// Registered projects for the Projects tab, from the catalogs CatalogSource read. Pure: no Herdr imports.
//
//   registeredGroups(sources)   one group per stable project ID and primary repository across machines (catalog.js
//                               mergeCatalogs), idle ones included, with what the header and Details show.
//   catalogMembership(sources, groups)  row => group key or null: a terminal joins a project only when its own
//                               machine's catalog was read successfully at the last attempt and exactly one entry
//                               there carries the terminal's herdr.project token. Names never join anything.
//   catalogNotice(sources)      null, or what the list says about a catalog that is loading, unavailable or partial.
import { mergeCatalogs, githubBoard } from './catalog.js';
import { tuple } from './normalize.js';

export const LOCAL = 'This computer';
export const machineLabel = machine => machine ?? LOCAL;
export const groupKey = (id, primary) => tuple('registered', String(id).toLowerCase(), String(primary).toLowerCase());
const lower = value => String(value).toLowerCase();
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// The repositories of a group, once each across Cores and checkouts: the primary first, then in catalog order.
export function groupRepositories(cores, primary) {
  const out = [];
  for (const core of cores) for (const repo of core.repositories ?? []) {
    let item = out.find(r => lower(r.name) === lower(repo.name));
    if (!item) { item = { name: repo.name, role: null, primary: false, checkouts: [] }; out.push(item); }
    item.role ??= repo.role ?? null;
    item.primary ||= repo.primary === true;
    item.checkouts.push({ machine: core.machine, checkout: repo.checkout });
  }
  if (primary) out.sort((a, b) => (lower(b.name) === lower(primary)) - (lower(a.name) === lower(primary)));
  return out;
}

// The monitored board: none (a manual project without one is valid), one GitHub board all Cores agree on, or unknown.
export function groupBoard(cores) {
  const boards = cores.map(core => core.board ?? null);
  if (boards.every(b => b === null)) return { state: 'none', board: null };
  const checked = boards.map(githubBoard);
  if (checked.some(b => b === null)) return { state: 'unknown', board: null, why: boards.some(b => b === null) ? 'cores-disagree' : 'board-unsupported' };
  if (checked.some(b => b.url !== checked[0].url)) return { state: 'unknown', board: null, why: 'cores-disagree' };
  return { state: 'known', board: checked[0] };
}

export function registeredGroups(sources = []) {
  const withCatalog = sources.filter(s => s.result?.status === 'ok');
  const merged = mergeCatalogs(withCatalog.map(s => ({ machine: s.machine, result: s.result })));
  return merged.projects.map(project => {
    const cores = project.cores.map(core => {
      const source = withCatalog.find(s => s.machine === core.machine);
      return { ...core, current: source?.current === true, sourceStatus: source?.status ?? null, sourceWhy: source?.why ?? null };
    });
    return { key: groupKey(project.id, project.primary), id: project.id, primary: project.primary, displayName: project.displayName,
      state: project.state, flags: project.flags, presentation: project.presentation, cores,
      repositories: groupRepositories(cores, project.primary), board: groupBoard(cores),
      stale: cores.some(core => !core.current) };
  }).sort((a, b) => order(lower(a.displayName), lower(b.displayName)) || order(a.key, b.key));
}

export function catalogMembership(sources = [], groups = []) {
  const current = new Map(sources.filter(s => s.status === 'ok' && s.current && s.result?.status === 'ok').map(s => [s.machine, s.result]));
  return row => {
    if (!row || row.metadataConflict || (row.invalidLabels ?? []).includes('herdr.project')) return null;
    const token = row.labels?.['herdr.project'];
    if (typeof token !== 'string' || !token) return null;
    const machine = row.core?.alias ? row.core.alias : null;
    const result = current.get(machine);
    if (!result) return null;
    const entries = result.projects.filter(entry => entry.token === token);
    if (entries.length !== 1) return null;
    const entry = entries[0];
    const group = groups.find(g => lower(g.id) === lower(entry.id) && lower(g.primary) === lower(entry.primary)
      && g.cores.some(core => core.machine === machine && core.current));
    return group ? group.key : null;
  };
}

const WHY = { 'no-file': 'no catalog published', 'not-ready': 'not connected', 'no-location': 'no catalog location on this platform',
  'read-failed': 'read failed', 'readiness-lost': 'disconnected during the read', timeout: 'no answer in time',
  unreadable: 'not readable as JSON', 'not-a-catalog': 'not a project catalog', 'version-unknown': 'a catalog version Roster does not know',
  malformed: 'malformed catalog', 'duplicate-id': 'one project ID twice', 'revision-backwards': 'an older revision than already read', missing: 'no catalog' };
export const whyText = why => WHY[why] ?? why ?? 'unknown';
export function sourceText(source) {
  const where = machineLabel(source.machine);
  if (source.status === 'reading') return where + ': reading';
  if (source.status === 'ok') return where + ': read' + (source.result ? ', revision ' + source.result.revision : '');
  return where + ': ' + whyText(source.why) + (source.result ? ' (showing its last catalog, revision ' + source.result.revision + ')' : '');
}

export function catalogNotice(sources = []) {
  if (!sources.length) return { kind: 'loading', text: 'Reading project catalog…', detail: 'Reading project catalog' };
  const detail = sources.map(sourceText).join('\n');
  const withCatalog = sources.filter(s => s.result);
  if (!withCatalog.length) {
    if (sources.some(s => s.status === 'reading')) return { kind: 'loading', text: 'Reading project catalog…', detail };
    return { kind: 'unavailable', text: 'Project catalog unavailable · showing Spaces', detail: 'No project catalog could be read; sessions are grouped by Space.\n' + detail };
  }
  // A machine without a published catalog is normal (no registered project there); a failed or unknown read is not.
  const failed = sources.filter(s => !['ok', 'missing', 'reading'].includes(s.status) && !(s.status === 'unavailable' && s.why === 'not-ready' && !s.result));
  if (!failed.length) return null;
  const names = failed.map(s => machineLabel(s.machine));
  return { kind: 'partial', text: 'Project catalog: ' + (names.length === 1 ? names[0] : names.length + ' machines') + ' unavailable',
    detail: 'Some catalogs could not be read; their sessions stay outside registered projects.\n' + detail };
}
