// Open issue and pull request data for registered projects, read-only, from GitHub through the person's own `gh`
// login on this computer. Pure: Herdr comes in as a host object, so tests drive every answer.
//
//   host: { exec(cmd, args, { timeout }), now(), load() → Promise<text|null>, save(text) → Promise }
//
// The only program run is `gh api graphql`, directly with arguments (never a shell), locally. Values go in with -f
// (raw strings: never read as @file); only a board number, checked as a positive integer, goes with -F. Nothing
// about credentials is read, stored or logged: only gh's exit code, stdout and stderr are parsed, and an error is
// kept as a short code. Each call races the host timer; a hung call keeps its slot until it really ends.
export const GH = 'gh';
export const REPOSITORY = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/;
const CURSOR = /^[A-Za-z0-9+/=_-]{1,256}$/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = v => Number.isSafeInteger(v) && v >= 0;
export const repoKey = name => String(name).toLowerCase();
export const validRepository = name => typeof name === 'string' && REPOSITORY.test(name) && !/^\.+$/.test(name.split('/')[1]);

// Repository-wide totals: open issues (a pull request is never an issue) and open pull requests, drafts included.
export const COUNT_QUERY = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){'
  + 'issues(states:OPEN){totalCount} pullRequests(states:OPEN){totalCount}}}';
// Open issues, oldest first, a page at a time.
export const ISSUES_QUERY = 'query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){'
  + 'issues(states:OPEN,first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{number title createdAt}}}}';
// The same issues' board items and their Status (needs the read:project scope; without it, status is unknown).
export const BOARD_ITEMS_QUERY = 'query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){'
  + 'issues(states:OPEN,first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{number '
  + 'projectItems(first:20){totalCount nodes{project{number owner{...on Organization{login} ...on User{login}}} '
  + 'status:fieldValueByName(name:"Status"){...on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}}';
// The board's Status field and its options, in the board's order.
export const boardFieldsQuery = ownerType => `query($login:String!,$number:Int!){${ownerType === 'user' ? 'user' : 'organization'}(login:$login){`
  + 'projectV2(number:$number){field(name:"Status"){...on ProjectV2SingleSelectField{name options{name}}}}}}';

export function graphqlArgs(query, fields = {}, numbers = {}) {
  const args = ['api', 'graphql', '-f', 'query=' + query];
  for (const [key, value] of Object.entries(fields)) if (value !== null && value !== undefined) args.push('-f', key + '=' + value);
  for (const [key, value] of Object.entries(numbers)) args.push('-F', key + '=' + value);
  return args;
}

// What a gh answer means: { ok: true, data } or { ok: false, reason } with reason one of gh-unavailable (no gh or it
// could not run), gh-auth (not logged in), refused (not found or not allowed), scope (a missing token scope),
// rate-limited, error (another error status) or malformed.
const REASONS = Object.freeze(['gh-unavailable', 'gh-auth', 'refused', 'scope', 'rate-limited', 'error', 'malformed', 'timeout']);
function errorReason(errors, stderr = '') {
  const types = (Array.isArray(errors) ? errors : []).map(e => String(e?.type ?? '') + ' ' + String(e?.message ?? '')).join(' ') + ' ' + stderr;
  if (/INSUFFICIENT_SCOPES|read:project|scopes?/i.test(types)) return 'scope';
  if (/NOT_FOUND|FORBIDDEN|Could not resolve to|Resource not accessible|HTTP 40[34]/i.test(types)) return 'refused';
  if (/RATE_LIMITED|rate limit/i.test(types)) return 'rate-limited';
  if (/gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i.test(types)) return 'gh-auth';
  return 'error';
}
export function ghOutcome(result) {
  if (!isObject(result) || !Number.isInteger(result.code) || typeof result.stdout !== 'string') return { ok: false, reason: 'malformed' };
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  let doc = null;
  try { doc = result.stdout.trim() ? JSON.parse(result.stdout) : null; } catch { doc = null; }
  if (result.code !== 0) return { ok: false, reason: errorReason(doc?.errors, stderr) };
  if (!isObject(doc)) return { ok: false, reason: 'malformed' };
  if (Array.isArray(doc.errors) && doc.errors.length) return { ok: false, reason: errorReason(doc.errors) };
  if (!isObject(doc.data)) return { ok: false, reason: 'malformed' };
  return { ok: true, data: doc.data };
}
export const isReason = value => REASONS.includes(value);

export function parseCounts(data) {
  const repo = data?.repository;
  if (repo === null) return { ok: false, reason: 'refused' };
  const issues = repo?.issues?.totalCount, prs = repo?.pullRequests?.totalCount;
  return whole(issues) && whole(prs) ? { ok: true, issues, prs } : { ok: false, reason: 'malformed' };
}
const title = v => typeof v === 'string' && v.length <= 1024 && !CONTROL.test(v);
const created = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v));
const pageInfo = p => isObject(p) && typeof p.hasNextPage === 'boolean' && (p.endCursor === null || (typeof p.endCursor === 'string' && CURSOR.test(p.endCursor)));
export function parseIssuePage(data) {
  const repo = data?.repository;
  if (repo === null) return { ok: false, reason: 'refused' };
  const page = repo?.issues;
  if (!isObject(page) || !whole(page.totalCount) || !pageInfo(page.pageInfo) || !Array.isArray(page.nodes)) return { ok: false, reason: 'malformed' };
  const issues = [];
  for (const node of page.nodes) {
    if (!isObject(node) || !Number.isSafeInteger(node.number) || node.number <= 0 || !title(node.title) || !created(node.createdAt)) return { ok: false, reason: 'malformed' };
    issues.push({ number: node.number, title: node.title.replace(/[\r\n\t]+/g, ' '), createdAt: node.createdAt });
  }
  return { ok: true, total: page.totalCount, issues, next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null };
}
// Per issue: on the board with its Status name (null: no Status set), not on the board, or unknown (more board
// items than one page shows and none of them is this board).
export function parseBoardPage(data, board) {
  const repo = data?.repository;
  if (repo === null) return { ok: false, reason: 'refused' };
  const page = repo?.issues;
  if (!isObject(page) || !pageInfo(page.pageInfo) || !Array.isArray(page.nodes)) return { ok: false, reason: 'malformed' };
  const items = {};
  for (const node of page.nodes) {
    const list = node?.projectItems;
    if (!isObject(node) || !Number.isSafeInteger(node.number) || node.number <= 0 || !isObject(list) || !whole(list.totalCount) || !Array.isArray(list.nodes)) return { ok: false, reason: 'malformed' };
    const mine = list.nodes.filter(item => item?.project?.number === board.number && typeof item.project.owner?.login === 'string'
      && item.project.owner.login.toLowerCase() === board.owner.toLowerCase());
    if (mine.length) {
      const names = mine.map(item => item.status === null || item.status === undefined ? null : typeof item.status?.name === 'string' && title(item.status.name) ? item.status.name : undefined);
      if (names.includes(undefined)) return { ok: false, reason: 'malformed' };
      // One issue on the board once; twice with different statuses is not something to pick from.
      items[node.number] = new Set(names).size === 1 ? { on: true, status: names[0] } : { on: true, status: undefined };
    } else items[node.number] = list.totalCount > list.nodes.length ? { on: null } : { on: false };
  }
  return { ok: true, items, next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null };
}
export function parseBoardFields(data, ownerType) {
  const owner = data?.[ownerType === 'user' ? 'user' : 'organization'];
  if (owner === null || owner?.projectV2 === null) return { ok: false, reason: 'refused' };
  if (!isObject(owner?.projectV2)) return { ok: false, reason: 'malformed' };
  const field = owner.projectV2.field;
  if (field === null || (isObject(field) && !Array.isArray(field.options))) return { ok: true, field: false, options: [] };
  if (!isObject(field) || !field.options.every(o => typeof o?.name === 'string' && title(o.name))) return { ok: false, reason: 'malformed' };
  return { ok: true, field: true, options: field.options.map(o => o.name) };
}

// The cache of answers, by repository (lowercase) and board. Each entry: { status: 'ok' | 'error' | 'loading',
// reason, at (last attempt), okAt, value, cached (from the disk cache, not yet refreshed) }.
export const LIMITS = Object.freeze({ countMs: 300000, listMs: 300000, boardMs: 1800000, manualMs: 30000, callMs: 20000, graceMs: 5000,
  atOnce: 2, maxRepositories: 32, maxPages: 5 });
export class GitHubData {
  constructor(host, limits = {}) {
    this.host = host; this.limits = { ...LIMITS, ...limits };
    this.counts = new Map(); this.lists = new Map(); this.boards = new Map(); this.fields = new Map();
    this.queue = []; this.running = 0; this.changed = false; this.manualAt = -Infinity; this.dirty = false; this.saving = false;
  }
  entry(map, key) { return map.get(key) ?? null; }
  due(map, key, ms, force) {
    const e = map.get(key);
    if (e?.status === 'loading' || this.queue.some(job => job.map === map && job.key === key)) return false;
    return force || !e || e.cached || this.host.now() - e.at >= ms;
  }
  // Totals for these repositories, on the bounded interval.
  wantCounts(repositories, after, force = false) {
    for (const name of repositories.filter(validRepository).slice(0, this.limits.maxRepositories)) {
      const key = repoKey(name);
      if (this.due(this.counts, key, this.limits.countMs, force)) this.enqueue({ map: this.counts, key, name, kind: 'counts' }, after);
    }
    this.pump(after);
  }
  // The issue list of one project (its repositories, and its board when it has a known GitHub board).
  wantList(repositories, board, after, force = false) {
    for (const name of repositories.filter(validRepository).slice(0, this.limits.maxRepositories)) {
      const key = repoKey(name);
      if (this.due(this.lists, key, this.limits.listMs, force)) this.enqueue({ map: this.lists, key, name, kind: 'list' }, after);
      if (board) {
        const bkey = boardKey(board) + ' ' + key;
        if (this.due(this.boards, bkey, this.limits.listMs, force)) this.enqueue({ map: this.boards, key: bkey, name, board, kind: 'board' }, after);
      }
    }
    if (board && this.due(this.fields, boardKey(board), force ? 0 : this.limits.boardMs, force)) this.enqueue({ map: this.fields, key: boardKey(board), board, kind: 'fields' }, after);
    this.pump(after);
  }
  // A person's explicit refresh: at most once per manualMs.
  refreshNow(repositories, board, after) {
    if (this.host.now() - this.manualAt < this.limits.manualMs) return false;
    this.manualAt = this.host.now();
    this.wantCounts(repositories, after, true);
    if (board !== undefined) this.wantList(repositories, board, after, true);
    return true;
  }
  // Queued work has a deadline too: while every slot is held by a call that has not ended (a hung gh), waiting in
  // the queue ends as a timeout and the job is dropped; the running calls keep their slots until they really end, and
  // the next scheduled interval asks again.
  enqueue(job, after) {
    const before = job.map.get(job.key);
    job.map.set(job.key, { ...(before ?? { value: null, okAt: null, reason: null }), status: 'loading', at: this.host.now(), cached: before?.cached ?? false, previous: before?.status ?? null });
    this.queue.push(job); this.changed = true;
    if (typeof after === 'function') after(this.limits.callMs + this.limits.graceMs, () => {
      const at = this.queue.indexOf(job);
      if (at < 0) return;
      this.queue.splice(at, 1);
      const now = job.map.get(job.key) ?? {};
      job.map.set(job.key, { status: 'error', reason: 'timeout', at: this.host.now(), okAt: now.okAt ?? null, value: now.value ?? null, cached: now.cached ?? false });
      this.changed = true;
    });
  }
  pump(after) {
    while (this.running < this.limits.atOnce && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      let settled = false;
      const finish = outcome => {
        if (settled) return; settled = true;
        const before = job.map.get(job.key) ?? {};
        job.map.set(job.key, outcome.ok
          ? { status: 'ok', reason: null, at: this.host.now(), okAt: this.host.now(), value: outcome.value, cached: false }
          : { status: 'error', reason: outcome.reason, at: this.host.now(), okAt: before.okAt ?? null, value: before.value ?? null, cached: before.cached ?? false });
        this.changed = true; this.dirty = true;
      };
      // One call for totals and board fields; up to maxPages calls one after another for a list.
      const calls = job.kind === 'list' || job.kind === 'board' ? this.limits.maxPages : 1;
      after(this.limits.callMs * calls + this.limits.graceMs, () => finish({ ok: false, reason: 'timeout' }));
      this.run(job, () => !settled).then(finish, () => finish({ ok: false, reason: 'gh-unavailable' }))
        .finally(() => { this.running--; this.changed = true; this.pump(after); this.persist(); });
    }
  }
  async call(args, live) {
    if (!live()) throw Error('cancelled');
    let result;
    try { result = await this.host.exec(GH, args, { timeout: this.limits.callMs }); }
    catch { return { ok: false, reason: 'gh-unavailable' }; }
    return ghOutcome(result);
  }
  async run(job, live) {
    const [owner, name] = job.name ? job.name.split('/') : [];
    if (job.kind === 'counts') {
      const answer = await this.call(graphqlArgs(COUNT_QUERY, { owner, name }), live);
      if (!answer.ok) return answer;
      const counts = parseCounts(answer.data);
      return counts.ok ? { ok: true, value: { issues: counts.issues, prs: counts.prs } } : counts;
    }
    if (job.kind === 'fields') {
      const answer = await this.call(graphqlArgs(boardFieldsQuery(job.board.ownerType), { login: job.board.owner }, { number: job.board.number }), live);
      if (!answer.ok) return answer;
      const fields = parseBoardFields(answer.data, job.board.ownerType);
      return fields.ok ? { ok: true, value: { field: fields.field, options: fields.options } } : fields;
    }
    // A list or the board items: pages of 100, oldest first, up to maxPages.
    const list = job.kind === 'list';
    let after = null, issues = [], items = {}, total = null, truncated = false;
    for (let page = 0; page < this.limits.maxPages; page++) {
      const answer = await this.call(graphqlArgs(list ? ISSUES_QUERY : BOARD_ITEMS_QUERY, { owner, name, after }), live);
      if (!answer.ok) return answer;
      const parsed = list ? parseIssuePage(answer.data) : parseBoardPage(answer.data, job.board);
      if (!parsed.ok) return parsed;
      if (list) { issues = issues.concat(parsed.issues); total = parsed.total; } else Object.assign(items, parsed.items);
      after = parsed.next;
      if (!after) break;
      if (page === this.limits.maxPages - 1) truncated = true;
    }
    return { ok: true, value: list ? { issues, total, truncated } : { items, truncated } };
  }
  // The disk cache: counts and issue lists only (no board data, no credentials). Read once at start; shown as cached
  // (stale) until a refresh answers. Written after a batch of answers.
  async restore() {
    let text = null;
    try { text = await this.host.load(); } catch { text = null; }
    this.cacheText = typeof text === 'string' ? text : null;
    const doc = parseCache(this.cacheText);
    if (!doc) return false;
    for (const [key, e] of Object.entries(doc.counts)) if (!this.counts.has(key)) this.counts.set(key, { status: 'ok', reason: null, at: e.okAt, okAt: e.okAt, value: e.value, cached: true });
    for (const [key, e] of Object.entries(doc.lists)) if (!this.lists.has(key)) this.lists.set(key, { status: 'ok', reason: null, at: e.okAt, okAt: e.okAt, value: e.value, cached: true });
    this.changed = true;
    return true;
  }
  persist() {
    if (!this.dirty || this.saving || this.running || this.queue.length || typeof this.host.save !== 'function') return;
    this.dirty = false; this.saving = true;
    const text = serializeCache(this);
    Promise.resolve().then(() => this.host.save(text, this.cacheText ?? null))
      .then(() => { this.cacheText = text; }, async () => {
        // Changed on disk meanwhile (or not writable): the cache stays usable in memory; the next batch tries again.
        this.dirty = true;
        try { const now = await this.host.load(); this.cacheText = typeof now === 'string' ? now : null; } catch { /* keep the last known text */ }
      })
      .finally(() => { this.saving = false; });
  }
  takeChanged() { const changed = this.changed; this.changed = false; return changed; }
}
export const boardKey = board => `${board.ownerType}:${board.owner.toLowerCase()}/${board.number}`;

export const CACHE_MAX = 524288;
export function serializeCache(data) {
  const pick = map => Object.fromEntries([...map].filter(([, e]) => e.okAt !== null && e.value).map(([key, e]) => [key, { okAt: e.okAt, value: e.value }]));
  let text = JSON.stringify({ version: 1, counts: pick(data.counts), lists: pick(data.lists) });
  if (text.length > CACHE_MAX) text = JSON.stringify({ version: 1, counts: pick(data.counts), lists: {} });
  return text;
}
// Its own file, still checked like any outside input: a damaged cache is ignored, never shown.
export function parseCache(text) {
  if (typeof text !== 'string' || text.length > CACHE_MAX) return null;
  let doc; try { doc = JSON.parse(text); } catch { return null; }
  if (!isObject(doc) || doc.version !== 1 || !isObject(doc.counts) || !isObject(doc.lists)) return null;
  const counts = {}, lists = {};
  for (const [key, e] of Object.entries(doc.counts)) {
    if (validRepository(key) && isObject(e) && whole(e.okAt) && isObject(e.value) && whole(e.value.issues) && whole(e.value.prs)) counts[key] = { okAt: e.okAt, value: { issues: e.value.issues, prs: e.value.prs } };
  }
  for (const [key, e] of Object.entries(doc.lists)) {
    const v = e?.value;
    if (!validRepository(key) || !isObject(e) || !whole(e.okAt) || !isObject(v) || !whole(v.total) || typeof v.truncated !== 'boolean' || !Array.isArray(v.issues)) continue;
    if (!v.issues.every(i => isObject(i) && Number.isSafeInteger(i.number) && i.number > 0 && title(i.title) && created(i.createdAt))) continue;
    lists[key] = { okAt: e.okAt, value: { total: v.total, truncated: v.truncated, issues: v.issues.map(i => ({ number: i.number, title: i.title, createdAt: i.createdAt })) } };
  }
  return { counts, lists };
}
