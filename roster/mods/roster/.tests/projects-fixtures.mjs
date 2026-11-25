// Neutral samples for registered projects (#30) and their GitHub totals (#25): a catalog builder and a fake `gh`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNT_QUERY, ISSUES_QUERY, BOARD_ITEMS_QUERY } from '../github.js';

const V1 = new URL('./fixtures/projects-v1/', import.meta.url);
// The contract's sample pilot entry, with its validated icon and palette.
export const pilotFixture = () => JSON.parse(readFileSync(new URL('catalogs/core-a.catalog.json', V1), 'utf8')).projects.find(p => p.id === 'pilot');

export const BOARD = { provider: 'github-project', owner: 'sample-org', ownerType: 'organization', number: 7, url: 'https://github.com/orgs/sample-org/projects/7' };
export function entry(id, { primary = `sample-org/${id}-app`, repositories = null, board = null, mode = 'watcher', kind = 'legacy', token = id,
  displayName = id[0].toUpperCase() + id.slice(1), space = { name: null, id: 'sp-' + id, binding: 'bound' }, presentation = null, state = 'ok', problems = [] } = {}) {
  return { id, token, displayName, kind, mode, state, problems, primary, manifest: kind === 'manifest' ? { commit: 'a'.repeat(40), version: 2 } : null, board,
    repositories: repositories ?? [{ name: primary, role: null, primary: true, checkout: 'bound' }], space, presentation, revision: 1 };
}
export const catalogText = (machine, entries, revision = 20) => JSON.stringify({ schema: 'herdr-agents/projects', version: 1, owner: 'herdr-agents',
  producer: { core: null, machine }, revision, updatedAt: '2026-11-24T12:00:00.000Z', projects: entries });

// A catalog host for CatalogSource: answers per machine ('local' for this computer), counts reads, can hang.
export function catalogHost({ answers = {}, machines = [{ name: null, layout: 'ready' }], terminals = [], now = () => 1000, platform = 'linux' } = {}) {
  const reads = [], hung = [];
  const host = { machines: () => machines, terminals: () => terminals, home: () => '/home/sample', platform: () => platform, now,
    readTextFile: (path, { on }) => {
      reads.push([path, on]);
      const answer = answers[on ?? 'local'];
      if (answer === 'hang') return new Promise((resolve, reject) => hung.push({ resolve, reject }));
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer === undefined ? null : answer);
    } };
  return { host, reads, hung };
}
// Timers driven by hand: after(ms, fn) records; fire() runs those due.
export function clock(start = 1000) {
  const pending = [];
  const c = { now: start, after: (ms, fn) => pending.push({ at: c.now + ms, fn }),
    advance(ms) { c.now += ms; for (const t of pending.filter(t => t.at <= c.now)) { pending.splice(pending.indexOf(t), 1); t.fn({ notify() {} }); } } };
  return c;
}
export const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(r => setImmediate(r)); };

// A fake `gh`: repositories by name with { issues, prs, list: [{ number, title, createdAt }], board: { number: status | null } },
// and modes per repository: 'refuse', 'hang', 'error', 'malformed', 'auth', 'scope' (board items only); missing: no gh at all.
export function fakeGh(repos = {}, { missing = false, modes = {}, fields = ['Backlog', 'Ready', 'In Progress', 'Done'], boardOwner = 'sample-org' } = {}) {
  const calls = [], hung = [];
  const exec = (cmd, args, options) => {
    assert.equal(cmd, 'gh'); assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
    assert.deepEqual(Object.keys(options), ['timeout'], 'local only: no `on`, no cwd');
    for (let i = 2; i < args.length; i += 2) assert.ok(['-f', '-F'].includes(args[i]), 'flags only');
    const values = Object.fromEntries(args.slice(2).filter((_, i) => i % 2 === 1).map(a => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
    for (let i = 2; i < args.length; i += 2) if (args[i] === '-F') assert.match(args[i + 1], /^number=[1-9][0-9]*$/, '-F only for the board number');
    const kind = values.query === COUNT_QUERY ? 'counts' : values.query === ISSUES_QUERY ? 'list' : values.query === BOARD_ITEMS_QUERY ? 'board' : 'fields';
    calls.push({ kind, ...values });
    if (missing) return Promise.reject(Error('spawn gh ENOENT'));
    const name = values.owner + '/' + values.name, repo = repos[name], mode = modes[name] ?? modes[kind];
    if (mode === 'hang') return new Promise((resolve, reject) => hung.push({ resolve, reject }));
    if (mode === 'auth') return Promise.resolve({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' });
    if (mode === 'error') return Promise.resolve({ code: 1, stdout: '', stderr: 'gh: HTTP 502: Bad Gateway' });
    if (mode === 'malformed') return Promise.resolve({ code: 0, stdout: '{"data":{"repository":{"issues":{"totalCount":"many"}}}}', stderr: '' });
    if (mode === 'scope' && kind === 'board') return Promise.resolve({ code: 1, stdout: JSON.stringify({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'projectItems' field requires one of the following scopes: ['read:project']" }] }), stderr: 'gh: Your token has not been granted the required scopes' });
    if (kind === 'fields') return Promise.resolve({ code: 0, stdout: JSON.stringify({ data: { organization: { projectV2: { field: { name: 'Status', options: fields.map(name => ({ name })) } } } } }), stderr: '' });
    if (!repo || mode === 'refuse') return Promise.resolve({ code: 1, stdout: JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: "Could not resolve to a Repository with the name '" + name + "'." }] }), stderr: "gh: Could not resolve to a Repository with the name '" + name + "'." });
    const list = [...(repo.list ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const page = list.slice(0, 100);
    const pageInfo = { hasNextPage: false, endCursor: null };
    if (kind === 'counts') return Promise.resolve({ code: 0, stdout: JSON.stringify({ data: { repository: { issues: { totalCount: repo.issues ?? list.length }, pullRequests: { totalCount: repo.prs ?? 0 } } } }), stderr: '' });
    if (kind === 'list') return Promise.resolve({ code: 0, stdout: JSON.stringify({ data: { repository: { issues: { totalCount: list.length, pageInfo, nodes: page } } } }), stderr: '' });
    const nodes = page.map(issue => {
      const on = Object.hasOwn(repo.board ?? {}, issue.number);
      return { number: issue.number, projectItems: { totalCount: on ? 1 : 0, nodes: on ? [{ project: { number: 7, owner: { login: boardOwner } },
        status: repo.board[issue.number] === null ? null : { name: repo.board[issue.number] } }] : [] } };
    });
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ data: { repository: { issues: { pageInfo, nodes } } } }), stderr: '' });
  };
  return { exec, calls, hung };
}
