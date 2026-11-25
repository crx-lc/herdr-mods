// What the Projects tab says about a registered project's open issues and pull requests, from GitHubData's cache.
// Pure: no Herdr imports; `now` is passed in. Provider-neutral output (a total, its state and the missing parts),
// so another provider can feed the same view later.
//
//   projectTotals(group, data, now)              { issues, prs, repos, missing }
//   issueList(group, data, now, filter)          the inline list: items oldest first, filters, notes
import { repoKey, validRepository, boardKey } from './github.js';

const REASON = { 'gh-unavailable': 'gh did not run (is GitHub CLI installed?)', 'gh-auth': 'gh is not logged in (gh auth login)',
  refused: 'not found or access refused', scope: 'the gh login lacks a needed scope', 'rate-limited': 'GitHub rate limit',
  error: 'GitHub answered with an error', malformed: 'an answer Roster could not read', timeout: 'no answer in time',
  unsupported: 'not a GitHub repository name', 'not-loaded': 'not read yet', 'too-many': 'more repositories than Roster reads' };
export const reasonText = reason => REASON[reason] ?? reason ?? 'unknown';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const pad = n => String(n).padStart(2, '0');
// No Intl in Herdr's QuickJS: dates are written out by hand, in UTC.
export function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
export const utcTime = ms => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`; };
export function ageText(createdMs, now) {
  const days = Math.max(0, Math.floor((now - createdMs) / 86400000));
  if (days === 0) return 'opened today';
  if (days < 100) return 'opened ' + plural(days, 'day', 'days') + ' ago';
  if (days < 730) return 'opened ' + plural(Math.floor(days / 30.44), 'month', 'months') + ' ago';
  return 'opened ' + plural(Math.floor(days / 365.25), 'year', 'years') + ' ago';
}

// The repositories a project's totals cover: every distinct registered repository, primary first.
export const projectRepositories = group => (group?.repositories ?? []).map(r => r.name);

// One value per repository: { name, state: 'ok' | 'stale' | 'loading' | 'missing', value, reason, okAt }.
function perRepository(map, names, limits, now, freshMs, pick) {
  return names.map((name, index) => {
    if (!validRepository(name)) return { name, state: 'missing', value: null, reason: 'unsupported', okAt: null };
    if (index >= limits.maxRepositories) return { name, state: 'missing', value: null, reason: 'too-many', okAt: null };
    const e = map.get(repoKey(name));
    if (!e) return { name, state: 'missing', value: null, reason: 'not-loaded', okAt: null };
    const value = e.value ? pick(e.value) : null;
    if (e.status === 'loading' && value === null) return { name, state: 'loading', value: null, reason: null, okAt: null };
    if (value === null) return { name, state: 'missing', value: null, reason: e.reason ?? 'not-loaded', okAt: null };
    // A value is current only when the last attempt answered it and it is younger than twice the refresh interval.
    const current = e.status === 'ok' && !e.cached && now - e.okAt < 2 * freshMs;
    return { name, state: current || (e.status === 'loading' && e.previous === 'ok' && !e.cached) ? 'ok' : 'stale', value, reason: e.status === 'error' ? e.reason : null, okAt: e.okAt };
  });
}
// Never a confirmed zero unless every repository answered: partial, stale, loading and unavailable are their own states.
function total(parts, one, many) {
  if (!parts.length) return { state: 'none', value: null, text: '', label: '' };
  const known = parts.filter(p => p.value !== null), sum = known.reduce((n, p) => n + p.value, 0);
  const missing = parts.filter(p => p.value === null && p.state !== 'loading'), loading = parts.filter(p => p.state === 'loading');
  const stale = known.filter(p => p.state === 'stale');
  const word = n => (n === 1 ? one : many);
  const oldest = known.length ? Math.min(...known.map(p => p.okAt)) : null;
  const missingText = missing.map(p => p.name + ' (' + reasonText(p.reason) + ')').join(', ');
  if (!known.length) {
    if (loading.length) return { state: 'loading', value: null, text: '… ' + many, label: 'Open ' + many + ': loading' };
    return { state: 'unavailable', value: null, text: '– ' + many, label: 'Open ' + many + ' unavailable: ' + missingText };
  }
  if (missing.length || loading.length) return { state: 'partial', value: sum, text: '≥' + sum + ' ' + word(sum),
    label: 'Open ' + many + ': at least ' + sum + '; ' + (missing.length ? 'unavailable: ' + missingText : '') + (missing.length && loading.length ? '; ' : '')
      + (loading.length ? 'still loading: ' + loading.map(p => p.name).join(', ') : '') };
  if (stale.length) return { state: 'stale', value: sum, text: sum + ' ' + word(sum), asOf: oldest,
    label: 'Open ' + many + ': ' + sum + ' as of ' + utcStamp(oldest) + ' (not refreshed: ' + stale.map(p => p.name + (p.reason ? ' ' + reasonText(p.reason) : ' cached')).join(', ') + ')' };
  return { state: 'ok', value: sum, text: sum + ' ' + word(sum),
    label: 'Open ' + many + ': ' + sum + (parts.length > 1 ? ' across ' + parts.length + ' repositories' : ' in ' + parts[0].name) };
}

export function projectTotals(group, data, now) {
  const names = projectRepositories(group);
  const issues = perRepository(data.counts, names, data.limits, now, data.limits.countMs, v => v.issues ?? null);
  const prs = perRepository(data.counts, names, data.limits, now, data.limits.countMs, v => v.prs ?? null);
  return { issues: total(issues, 'issue', 'issues'), prs: total(prs, 'PR', 'PRs'),
    repos: names.map((name, i) => ({ name, issues: issues[i], prs: prs[i] })) };
}

// The board status of one issue: 'status' (its Status name), 'no-status' (on the board, no Status set: verified only
// when the board's Status field is known), 'off-board' (verified absent), 'unknown', or 'no-board' (no board at all).
function boardStatus(group, data, repo, number) {
  if (group.board?.state === 'none') return { kind: 'no-board', name: null };
  if (group.board?.state !== 'known') return { kind: 'unknown', name: null };
  const board = group.board.board, items = data.boards.get(boardKey(board) + ' ' + repoKey(repo));
  const fields = data.fields.get(boardKey(board));
  if (!items?.value || items.status !== 'ok' && items.status !== 'loading') return { kind: 'unknown', name: null };
  const item = items.value.items[number];
  if (item?.on === false) return { kind: 'off-board', name: null };
  if (!item || item.on !== true || item.status === undefined) return { kind: 'unknown', name: null };
  if (item.status === null) return fields?.value?.field === true ? { kind: 'no-status', name: null } : { kind: 'unknown', name: null };
  return { kind: 'status', name: item.status };
}
const STATUS_TEXT = { 'no-status': 'no status', 'off-board': 'not on board', unknown: 'status unknown', 'no-board': '' };
export const statusText = s => s.kind === 'status' ? s.name : STATUS_TEXT[s.kind];
const filterOf = s => s.kind === 'status' ? 'status:' + s.name : s.kind === 'no-status' || s.kind === 'off-board' ? 'none' : s.kind === 'unknown' ? 'unknown' : 'all';

export function issueList(group, data, now, filter = 'all') {
  const names = projectRepositories(group).filter(validRepository).slice(0, data.limits.maxRepositories);
  const items = [], notes = [];
  let loading = 0, missing = 0;
  for (const name of names) {
    const e = data.lists.get(repoKey(name));
    if (!e?.value) {
      if (e?.status === 'loading') loading++;
      else { missing++; notes.push(name + ': issues not listed (' + reasonText(e?.reason ?? 'not-loaded') + ')'); }
      continue;
    }
    if (e.status === 'error') notes.push(name + ': list as of ' + utcStamp(e.okAt) + ' (' + reasonText(e.reason) + ')');
    else if (e.cached) notes.push(name + ': list as of ' + utcStamp(e.okAt) + ' (cached)');
    if (e.value.truncated) notes.push(name + ': only the oldest ' + e.value.issues.length + ' of ' + e.value.total + ' are listed');
    for (const issue of e.value.issues) {
      const created = Date.parse(issue.createdAt);
      const status = boardStatus(group, data, name, issue.number);
      items.push({ key: repoKey(name) + '#' + issue.number, repo: name, short: name.split('/')[1], number: issue.number, title: issue.title,
        url: 'https://github.com/' + name + '/issues/' + issue.number, createdAt: issue.createdAt, created,
        age: ageText(created, now), exact: 'Opened ' + utcStamp(created), status, statusText: statusText(status), filter: filterOf(status) });
    }
  }
  if (group.board?.state === 'known') {
    const board = group.board.board;
    for (const name of names) {
      const e = data.boards.get(boardKey(board) + ' ' + repoKey(name));
      if (data.lists.get(repoKey(name))?.value && (!e?.value || e.status === 'error'))
        notes.push(name + ': board status unknown (' + reasonText(e?.status === 'loading' ? 'not-loaded' : e?.reason ?? 'not-loaded') + ')');
    }
  } else if (group.board?.state === 'unknown') notes.push('Board unknown: the catalog\'s Cores do not name one GitHub board');
  items.sort((a, b) => a.created - b.created || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) || a.number - b.number);
  // Filters: All, then the board's own statuses in its order (else as seen), No board status, Status unknown.
  const fields = group.board?.state === 'known' ? data.fields.get(boardKey(group.board.board))?.value : null;
  const seen = [...new Set(items.filter(i => i.status.kind === 'status').map(i => i.status.name))];
  const statuses = fields?.field ? [...fields.options, ...seen.filter(s => !fields.options.includes(s))] : seen;
  const count = key => items.filter(i => i.filter === key).length;
  const filters = [{ key: 'all', label: 'All', count: items.length }];
  if (group.board?.state === 'known') {
    for (const s of statuses) filters.push({ key: 'status:' + s, label: s, count: count('status:' + s) });
    filters.push({ key: 'none', label: 'No board status', count: count('none') });
  }
  if (items.some(i => i.filter === 'unknown') && group.board?.state !== 'none') filters.push({ key: 'unknown', label: 'Status unknown', count: count('unknown') });
  const active = filters.some(f => f.key === filter) ? filter : 'all';
  const shown = active === 'all' ? items : items.filter(i => i.filter === active);
  const state = !names.length ? 'none' : missing === names.length ? 'unavailable' : loading === names.length ? 'loading' : missing || loading ? 'partial' : 'ok';
  if (loading && state === 'partial') notes.push(plural(loading, 'repository', 'repositories') + ' still loading');
  return { state, items: shown, total: items.length, filter: active, filters, notes };
}
