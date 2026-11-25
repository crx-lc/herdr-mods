// #25: open issue and pull request totals per registered project, and the inline open-issue list. Fixture evidence:
// a fake `gh` (projects-fixtures.mjs), never the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubData, ghOutcome, graphqlArgs, COUNT_QUERY, parseCache, serializeCache, validRepository } from '../github.js';
import { projectTotals, issueList, ageText, utcStamp } from '../project-totals.js';
import { fakeGh, clock, settle } from './projects-fixtures.mjs';

const DAY = 86400000, NOW = Date.parse('2026-11-25T12:00:00Z');
const group = (names, board = { state: 'none', board: null }) => ({ key: 'g', id: 'pilot', displayName: 'Pilot', board,
  repositories: names.map((name, n) => ({ name, role: null, primary: n === 0, checkouts: [] })) });
const known = { state: 'known', board: { owner: 'sample-org', ownerType: 'organization', number: 7, url: 'https://github.com/orgs/sample-org/projects/7' } };
function setup(repos, options = {}) {
  const gh = fakeGh(repos, options), t = clock(NOW);
  const data = new GitHubData({ exec: gh.exec, now: () => t.now, load: async () => options.cache ?? null, save: options.save ?? (async () => {}) });
  return { gh, t, data };
}
const issue = (number, daysAgo, title = 'Sample issue ' + number) => ({ number, title, createdAt: new Date(NOW - daysAgo * DAY).toISOString().replace(/\.\d+Z$/, 'Z') });

test('totals: issues and pull requests across every distinct repository; drafts count as open PRs; one call per repository', async () => {
  const names = ['sample-org/pilot-app', 'sample-org/pilot-site', 'sample-org/pilot-docs'];
  // pilot-site's 2 open PRs are drafts: GitHub's open pull request total includes them, and Roster never filters.
  const s = setup({ 'sample-org/pilot-app': { issues: 7, prs: 3 }, 'sample-org/pilot-site': { issues: 3, prs: 2 }, 'sample-org/pilot-docs': { issues: 2, prs: 0 } });
  assert.match(COUNT_QUERY, /pullRequests\(states:OPEN\)\{totalCount\}/); assert.doesNotMatch(COUNT_QUERY, /isDraft|draft/i);
  assert.match(COUNT_QUERY, /issues\(states:OPEN\)\{totalCount\}/, 'the issues connection never holds a pull request');
  // The same repository named by two Cores and two checkouts (other case) is asked once.
  s.data.wantCounts([...names, 'Sample-Org/Pilot-App'], s.t.after); await settle();
  assert.equal(s.gh.calls.filter(c => c.kind === 'counts').length, 3);
  const totals = projectTotals(group(names), s.data, s.t.now);
  assert.deepEqual([totals.issues.state, totals.issues.text, totals.prs.state, totals.prs.text], ['ok', '12 issues', 'ok', '5 PRs']);
  assert.equal(totals.issues.label, 'Open issues: 12 across 3 repositories');
  assert.deepEqual(totals.repos.map(r => [r.name, r.issues.value, r.prs.value]), [[names[0], 7, 3], [names[1], 3, 2], [names[2], 2, 0]]);
});

test('an empty project is a confirmed zero; one inaccessible repository makes the totals partial, never complete', async () => {
  const empty = setup({ 'sample-org/quiet-app': { issues: 0, prs: 0 } });
  empty.data.wantCounts(['sample-org/quiet-app'], empty.t.after); await settle();
  const zero = projectTotals(group(['sample-org/quiet-app']), empty.data, empty.t.now);
  assert.deepEqual([zero.issues.state, zero.issues.text, zero.prs.text], ['ok', '0 issues', '0 PRs']);
  const s = setup({ 'sample-org/pilot-app': { issues: 4, prs: 1 } }, { modes: { 'sample-org/private-app': 'refuse' } });
  s.data.wantCounts(['sample-org/pilot-app', 'sample-org/private-app'], s.t.after); await settle();
  const t = projectTotals(group(['sample-org/pilot-app', 'sample-org/private-app']), s.data, s.t.now);
  assert.deepEqual([t.issues.state, t.issues.text, t.prs.text], ['partial', '≥4 issues', '≥1 PR']);
  assert.match(t.issues.label, /at least 4 now; unavailable: sample-org\/private-app \(not found or access refused\)/);
});

test('no gh, not logged in, an error status, a malformed answer: unavailable with the reason, never 0', async () => {
  const cases = [[{ missing: true }, 'gh did not run'], [{ modes: { counts: 'auth' } }, 'not logged in'], [{ modes: { counts: 'error' } }, 'answered with an error'],
    [{ modes: { counts: 'malformed' } }, 'could not read']];
  for (const [options, reason] of cases) {
    const s = setup({ 'sample-org/pilot-app': { issues: 4, prs: 1 } }, options);
    s.data.wantCounts(['sample-org/pilot-app'], s.t.after); await settle();
    const t = projectTotals(group(['sample-org/pilot-app']), s.data, s.t.now);
    assert.equal(t.issues.state, 'unavailable', JSON.stringify(options)); assert.equal(t.issues.text, '– issues');
    assert.ok(t.issues.label.includes(reason), t.issues.label);
  }
  // A name the catalog allows but GitHub cannot have is not asked at all.
  assert.equal(validRepository('sample_org/app'), false);
});

test('a hung call: loading until the host timer ends it, then unavailable; its slot stays taken until it really ends', async () => {
  const s = setup({}, { modes: { 'sample-org/slow-app': 'hang', 'sample-org/slow-site': 'hang', 'sample-org/next-app': 'hang' } });
  s.data.wantCounts(['sample-org/slow-app', 'sample-org/slow-site', 'sample-org/next-app'], s.t.after); await settle();
  assert.equal(s.gh.calls.length, 2, 'at most two calls at once');
  assert.equal(projectTotals(group(['sample-org/slow-app']), s.data, s.t.now).issues.state, 'loading');
  s.t.advance(25000); await settle();
  const t = projectTotals(group(['sample-org/slow-app']), s.data, s.t.now);
  assert.deepEqual([t.issues.state, t.issues.label], ['unavailable', 'Open issues unavailable: sample-org/slow-app (no answer in time)']);
  assert.equal(s.gh.calls.length, 2, 'a timed-out call still holds its slot');
  s.gh.hung[0].resolve({ code: 0, stdout: '{"data":{"repository":{"issues":{"totalCount":1},"pullRequests":{"totalCount":1}}}}', stderr: '' }); await settle();
  assert.equal(projectTotals(group(['sample-org/slow-app']), s.data, s.t.now).issues.state, 'unavailable', 'a late answer never replaces the timeout');
  // The queued third had its own deadline and was dropped; the next interval asks it once a slot is free.
  assert.equal(s.gh.calls.length, 2);
  s.t.advance(300000); s.data.wantCounts(['sample-org/next-app'], s.t.after); await settle();
  assert.equal(s.gh.calls.length, 3, 'asked again on the next interval, in the slot the ended call freed');
});

test('fix1 (finding 1): queued work ends at its own deadline while both slots stay held by hung calls', async () => {
  const s = setup({}, { modes: { 'sample-org/a': 'hang', 'sample-org/b': 'hang', 'sample-org/c': 'hang' } });
  s.data.wantCounts(['sample-org/a', 'sample-org/b', 'sample-org/c'], s.t.after); await settle();
  assert.equal(projectTotals(group(['sample-org/c']), s.data, s.t.now).issues.state, 'loading');
  s.t.advance(3600000); await settle();
  const t = projectTotals(group(['sample-org/c']), s.data, s.t.now);
  assert.deepEqual([t.issues.state, t.issues.label], ['unavailable', 'Open issues unavailable: sample-org/c (no answer in time)'], 'never loading for ever');
  assert.deepEqual([s.data.running, s.data.queue.length, s.gh.calls.length], [2, 0, 2], 'the hung calls keep their slots; nothing more is started');
});

test('fix1 (finding 2): repositories Roster does not read are counted as missing and named in the issue list', async () => {
  const names = Array.from({ length: 33 }, (_, n) => 'sample-org/repo-' + n);
  const s = setup(Object.fromEntries(names.map(n => [n, { list: [] }])));
  s.data.wantList(names, null, s.t.after); await settle();
  const list = issueList(group(names), s.data, s.t.now);
  assert.equal(s.data.lists.size, 32);
  assert.equal(list.state, 'partial');
  assert.deepEqual(list.notes, ['sample-org/repo-32: issues not listed (more repositories than Roster reads)']);
  const odd = setup({ 'sample-org/app': { list: [issue(1, 3)] } });
  odd.data.wantList(['sample-org/app', 'sample_org/app'], null, odd.t.after); await settle();
  const two = issueList(group(['sample-org/app', 'sample_org/app']), odd.data, odd.t.now);
  assert.equal(two.state, 'partial');
  assert.deepEqual(two.notes, ['sample_org/app: issues not listed (not a GitHub repository name)']);
});

test('fix1 (finding 3): a stale count beside an unavailable repository keeps its time and is never a current lower bound', () => {
  const data = { limits: { countMs: 300000, maxRepositories: 32 }, counts: new Map([
    ['sample-org/app', { status: 'error', reason: 'error', at: 900000, okAt: 1, value: { issues: 100, prs: 10 }, cached: true }],
    ['sample-org/docs', { status: 'error', reason: 'refused', at: 900000, okAt: null, value: null, cached: false }]]) };
  let t = projectTotals(group(['sample-org/app', 'sample-org/docs']), data, 1000000).issues;
  assert.equal(t.state, 'partial'); assert.equal(t.stale, true);
  assert.equal(t.text, '– issues', 'an old count is not shown as "≥100"');
  assert.equal(t.label, 'Open issues: no current count; stale: sample-org/app 100 as of 1970-01-01 00:00 UTC (not refreshed: GitHub answered with an error); unavailable: sample-org/docs (not found or access refused)');
  // With a current repository too, only the current one makes the lower bound.
  data.counts.set('sample-org/site', { status: 'ok', reason: null, at: 999000, okAt: 999000, value: { issues: 3, prs: 0 }, cached: false });
  t = projectTotals(group(['sample-org/app', 'sample-org/docs', 'sample-org/site']), data, 1000000).issues;
  assert.equal(t.text, '≥3 issues'); assert.match(t.label, /^Open issues: at least 3 now; stale: sample-org\/app 100 as of/);
});

test('bounded refresh: totals again only after five minutes; an explicit refresh at most every 30 s; opening or closing shows after refresh', async () => {
  const repos = { 'sample-org/pilot-app': { issues: 4, prs: 1 } };
  const s = setup(repos);
  s.data.wantCounts(['sample-org/pilot-app'], s.t.after); await settle();
  s.t.advance(60000); s.data.wantCounts(['sample-org/pilot-app'], s.t.after); await settle();
  assert.equal(s.gh.calls.length, 1, 'no second call within the interval');
  repos['sample-org/pilot-app'] = { issues: 5, prs: 0 }; // an issue opened, a pull request closed
  assert.equal(projectTotals(group(['sample-org/pilot-app']), s.data, s.t.now).issues.text, '4 issues');
  s.t.advance(240000); s.data.wantCounts(['sample-org/pilot-app'], s.t.after); await settle();
  const t = projectTotals(group(['sample-org/pilot-app']), s.data, s.t.now);
  assert.deepEqual([t.issues.text, t.prs.text], ['5 issues', '0 PRs']);
  assert.equal(s.data.refreshNow(['sample-org/pilot-app'], undefined, s.t.after), true);
  assert.equal(s.data.refreshNow(['sample-org/pilot-app'], undefined, s.t.after), false, 'once per 30 s');
});

test('stale: a failed refresh keeps the last value marked with its time; the disk cache shows as stale until answered', async () => {
  const s = setup({ 'sample-org/pilot-app': { issues: 4, prs: 1 } });
  s.data.wantCounts(['sample-org/pilot-app'], s.t.after); await settle();
  const text = serializeCache(s.data);
  const again = setup({}, { cache: text, modes: { counts: 'error' } });
  await again.data.restore();
  let t = projectTotals(group(['sample-org/pilot-app']), again.data, again.t.now);
  assert.deepEqual([t.issues.state, t.issues.text], ['stale', '4 issues']);
  assert.match(t.issues.label, /as of 2026-11-25 12:00 UTC \(not refreshed: sample-org\/pilot-app cached\)/);
  again.data.wantCounts(['sample-org/pilot-app'], again.t.after); await settle();
  t = projectTotals(group(['sample-org/pilot-app']), again.data, again.t.now);
  assert.equal(t.issues.state, 'stale'); assert.match(t.issues.label, /GitHub answered with an error/);
  // A damaged cache is ignored, never shown.
  for (const bad of ['{', '{"version":2,"counts":{},"lists":{}}', JSON.stringify({ version: 1, counts: { 'sample-org/pilot-app': { okAt: 1, value: { issues: -1, prs: 0 } } }, lists: {} })])
    assert.equal(Object.keys(parseCache(bad)?.counts ?? {}).length, 0);
});

test('gh answers are classified without reading credentials; arguments go as raw -f strings', () => {
  assert.deepEqual(graphqlArgs('q', { owner: '@etc/passwd' }), ['api', 'graphql', '-f', 'query=q', '-f', 'owner=@etc/passwd'], '-f never reads a file');
  assert.deepEqual(ghOutcome(null), { ok: false, reason: 'malformed' });
  assert.deepEqual(ghOutcome({ code: 0, stdout: 'not json', stderr: '' }), { ok: false, reason: 'malformed' });
  assert.deepEqual(ghOutcome({ code: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' }), { ok: false, reason: 'gh-auth' });
  assert.deepEqual(ghOutcome({ code: 1, stdout: '', stderr: 'API rate limit exceeded' }), { ok: false, reason: 'rate-limited' });
  assert.equal(ghOutcome({ code: 0, stdout: '{"data":{"repository":null}}', stderr: '' }).ok, true);
});

test('the issue list: primary and secondary repositories, oldest first, repository-qualified, age and exact date', async () => {
  const repos = { 'sample-org/pilot-app': { list: [issue(3, 12, 'Fix the header'), issue(9, 2)] }, 'sample-org/pilot-docs': { list: [issue(4, 30, 'Write the guide')] } };
  const s = setup(repos);
  const g = group(['sample-org/pilot-app', 'sample-org/pilot-docs']);
  s.data.wantList(projectRepositories(g), null, s.t.after); await settle();
  const list = issueList(g, s.data, s.t.now);
  assert.equal(list.state, 'ok');
  assert.deepEqual(list.items.map(i => i.repo + '#' + i.number), ['sample-org/pilot-docs#4', 'sample-org/pilot-app#3', 'sample-org/pilot-app#9']);
  const first = list.items[1];
  assert.deepEqual([first.age, first.exact, first.url], ['opened 12 days ago', 'Opened 2026-11-13 12:00 UTC', 'https://github.com/sample-org/pilot-app/issues/3']);
  assert.equal(list.items[0].statusText, '', 'a project without a board has no board status');
  assert.deepEqual(list.filters.map(f => f.key), ['all'], 'no status filter without a board');
  // Closing an issue removes it after the next refresh.
  repos['sample-org/pilot-app'].list = [issue(9, 2)];
  s.t.advance(300000); s.data.wantList(projectRepositories(g), null, s.t.after); await settle();
  assert.deepEqual(issueList(g, s.data, s.t.now).items.map(i => i.number), [4, 9]);
});

test('board status: the board\'s own statuses, No board status for off-board and status-less items, never Backlog; unknown board data is unknown', async () => {
  const repos = { 'sample-org/pilot-app': { list: [issue(1, 40), issue(2, 30), issue(3, 20), issue(5, 10)], board: { 1: 'Ready', 2: null, 3: 'In Progress' } },
    'sample-org/pilot-site': { list: [issue(7, 25)], board: { 7: 'Ready' } } };
  const s = setup(repos, { modes: { 'sample-org/pilot-site': undefined } });
  const g = group(['sample-org/pilot-app', 'sample-org/pilot-site'], known);
  s.data.wantList(projectRepositories(g), known.board, s.t.after); await settle();
  let list = issueList(g, s.data, s.t.now);
  assert.deepEqual(list.items.map(i => [i.number, i.statusText]), [[1, 'Ready'], [2, 'no status'], [7, 'Ready'], [3, 'In Progress'], [5, 'not on board']]);
  assert.deepEqual(list.filters.map(f => f.label + ' ' + f.count), ['All 5', 'Backlog 0', 'Ready 2', 'In Progress 1', 'Done 0', 'No board status 2']);
  assert.deepEqual(issueList(g, s.data, s.t.now, 'status:Ready').items.map(i => i.number), [1, 7]);
  assert.deepEqual(issueList(g, s.data, s.t.now, 'none').items.map(i => i.number), [2, 5], 'off-board and status-less, never Backlog');
  assert.deepEqual(issueList(g, s.data, s.t.now, 'status:Backlog').items, []);
  // Without the read:project scope the board items are unknown: said so, by repository; the list itself stays.
  const scoped = setup(repos, { modes: { board: 'scope' } });
  scoped.data.wantList(projectRepositories(g), known.board, scoped.t.after); await settle();
  list = issueList(g, scoped.data, scoped.t.now);
  assert.equal(list.total, 5);
  assert.ok(list.items.every(i => i.statusText === 'status unknown'));
  assert.deepEqual(list.filters.map(f => f.key), ['all', 'status:Backlog', 'status:Ready', 'status:In Progress', 'status:Done', 'none', 'unknown']);
  assert.ok(list.notes.includes('sample-org/pilot-app: board status unknown (the gh login lacks a needed scope)'));
});

test('a partial issue list names the repository it is missing; ages read in days, months and years', async () => {
  const s = setup({ 'sample-org/pilot-app': { list: [issue(1, 3)] } }, { modes: { 'sample-org/private-app': 'refuse' } });
  const g = group(['sample-org/pilot-app', 'sample-org/private-app']);
  s.data.wantList(projectRepositories(g), null, s.t.after); await settle();
  const list = issueList(g, s.data, s.t.now);
  assert.equal(list.state, 'partial');
  assert.deepEqual(list.notes, ['sample-org/private-app: issues not listed (not found or access refused)']);
  assert.deepEqual([0, 1, 99, 100, 800].map(d => ageText(NOW - d * DAY, NOW)), ['opened today', 'opened 1 day ago', 'opened 99 days ago', 'opened 3 months ago', 'opened 2 years ago']);
  assert.equal(utcStamp(Date.parse('2026-01-02T03:04:05Z')), '2026-01-02 03:04 UTC');
});
import { projectRepositories } from '../project-totals.js';
