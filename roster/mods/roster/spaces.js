// Spaces list from Herdr's own Space data, in the stock sidebar's order and look.
// Pure: the caller passes spaces(), machines(), the shared avatar colors and folds.
// No git, no exec: the stock list's repo/ahead-behind tail is not reproduced here.

// Avatar fills for stored color names, as the stock Spaces list draws them.
export const SPACE_MARKS = Object.freeze({ ansi6: '#22a99a', ansi3: '#e3814f', ansi4: '#5b8def', ansi5: '#8b7cf6', ansi2: '#3fae6a', ansi1: '#d9649a' });
export const LOCAL_MACHINE = 'This computer';

const validName = value => typeof value === 'string' && !!value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const color = value => typeof value === 'string' && (/^#[0-9a-fA-F]{6}$/.test(value) || /^[a-z][a-z0-9_]{0,31}$/.test(value)) ? value : null;
export const machineKey = machine => 'spaces:machine:' + (machine ?? 'local');
export const spaceKey = id => 'space:' + id;

// A space's tail is its branch, only where unusual: not main/master, not its own name.
export function branchTail(space) {
  const branch = validName(space?.branch) ? space.branch.trim() : '';
  if (!branch || ['main', 'master'].includes(branch) || branch.toLowerCase() === String(space?.name ?? '').trim().toLowerCase()) return '';
  return branch;
}

// Rows: one header per machine once a remote machine is known (this computer first,
// then remote machines by name), each followed by its Spaces in Herdr's order.
export function spaceRows({ spaces = [], machines = [] } = {}, { colors = {}, folds = {}, identityOf = () => null } = {}) {
  const list = (Array.isArray(spaces) ? spaces : []).filter(s => s && validName(s.id));
  const seen = new Set();
  const unique = list.filter(s => !seen.has(s.id) && seen.add(s.id));
  const machineOf = s => (validName(s.machine) ? s.machine : null);
  const remote = [...new Set([...unique.map(machineOf).filter(Boolean),
    ...(Array.isArray(machines) ? machines : []).map(m => m?.name).filter(validName)])].sort();
  const grouped = remote.length > 0;
  const rows = [];
  for (const machine of [null, ...remote]) {
    const mine = unique.filter(s => machineOf(s) === machine);
    const state = (Array.isArray(machines) ? machines : []).find(m => (m?.name ?? null) === machine);
    const key = machineKey(machine), collapsed = folds[key] === true;
    if (grouped) rows.push({ kind: 'machine', key, machine, label: machine ?? LOCAL_MACHINE,
      ready: state?.layout === 'ready', loading: state?.layout === 'loading', collapsed, count: mine.length });
    if (grouped && collapsed) continue;
    // Worktrees under their main checkout, only with verified Git identity; saved order kept.
    for (const { space, tree } of nestWorktrees(mine, identityOf)) {
      const name = validName(space.name) ? space.name.trim() : space.id;
      rows.push({ kind: 'space', key: spaceKey(space.id), id: space.id, machine, name,
        initial: (Array.from(name)[0] ?? '?').toUpperCase(), color: color(colors?.[space.id]) ?? 'ansi6',
        active: space.active === true, branch: branchTail(space), status: space.status ?? null, tree,
        tail: spaceTail(space, identityOf(space), tree) });
    }
  }
  return rows;
}

// A stored color name or hex as a fill, the same way the stock list resolves it.
export const spaceFill = (name, theme = {}) => name.startsWith('#') ? name : SPACE_MARKS[name] ?? theme[name] ?? SPACE_MARKS.ansi6;

// Where a Space is now, as the stock list decides it: its first pane's live folder,
// else the folder it was made with. `panes` is one panes() read.
export function spacePlace(space, panes = []) {
  const tabs = new Set((space?.tabs ?? []).map(t => t?.id));
  const pane = (Array.isArray(panes) ? panes : []).find(p => p && tabs.has(p.tab) && validName(p.cwd));
  return pane ? pane.cwd : validName(space?.folder) ? space.folder : null;
}
export const placeKey = (machine, folder) => JSON.stringify([machine ?? null, folder]);

// Remote reads follow the owner's D8 rule (crx-lc/herdr-agents#141): a remote machine is
// asked only while Herdr reports it ready, checked again right before each call (each
// individual Git command, each os-release read) and again on the answer; anything else (not ready, a throw, no answer) counts as not ready,
// and the value is shown as unknown. Nothing is retried through a reconnect or another
// path; a later read waits for the normal schedule while the machine is ready.
// Limitation: this narrows the window, it does not close it. A Core can stop between the
// check and the call, and a read that reaches a stopped Core may start it. Until the host
// offers an attach-only read (herdrdev/herdr-app#1441) this is not a no-wake guarantee.
// This computer (machine null) needs no remote Core and is always ready.
export function readyNow(isReady, machine) {
  if ((machine ?? null) === null) return true;
  if (typeof isReady !== 'function') return false;
  try { return isReady(machine) === true; } catch { return false; }
}

// Git commands one at a time, with D8 checked right before each one and on the last answer.
// Each result is checked before the next command is sent: accept(index, result) answers
// 'ok' (go on), 'stop' (a complete, known answer: send nothing more) or 'fail'. A failed or
// malformed result, readiness lost, or the job's deadline/cancel flag (live() false) stops
// the chain and rejects: no further command is sent and the whole answer is unknown.
const wellFormed = r => r !== null && typeof r === 'object' && Number.isInteger(r.code) && typeof r.stdout === 'string';
export async function runEach(exec, isReady, machine, queries, options, { accept = (_i, r) => wellFormed(r) && r.code === 0 ? 'ok' : 'fail', live = () => true } = {}) {
  const answers = [];
  for (const [index, args] of queries.entries()) {
    if (!live()) throw Error('cancelled');
    if (!readyNow(isReady, machine)) throw Error('readiness-lost');
    const result = await exec('git', [...args], options);
    if (!live()) throw Error('cancelled');
    const verdict = accept(index, result);
    if (verdict === 'fail') throw Error('failed');
    answers.push(result);
    if (verdict === 'stop') break;
  }
  if (!readyNow(isReady, machine)) throw Error('readiness-lost');
  return answers;
}
// Identity (rev-parse --show-toplevel, then --git-common-dir): both must succeed. Git's own
// "not a git repository" on the first is a known answer: stop there, the place has no repo.
// A successful answer still counts only when its output parses, with the same parser
// that later builds the value: both paths must be exactly one clean line.
export function acceptIdentity(index, r) {
  if (!wellFormed(r)) return 'fail';
  if (r.code === 0) return oneLine(r.stdout) ? 'ok' : 'fail';
  return index === 0 && /not a git repository/i.test(r.stderr ?? '') ? 'stop' : 'fail';
}
// State: status, then branch, then ahead/behind, each parsed before the next is sent.
// - status must succeed with porcelain lines only;
// - branch: one clean line, or a detached HEAD (symbolic-ref -q exit 1, no output): then
//   the upstream query is not sent, so the dirty mark stays without branch or arrows;
// - ahead/behind: exactly two numbers, or Git saying there is no upstream (no arrows).
// Anything else fails the whole refresh, which is then Unknown.
export function acceptState(index, r) {
  if (!wellFormed(r)) return 'fail';
  if (index === 0) return r.code === 0 && parseStatus(r.stdout) !== null ? 'ok' : 'fail';
  if (index === 1) {
    if (r.code === 0) return oneLine(r.stdout) ? 'ok' : 'fail';
    return r.code === 1 && !r.stdout.trim() ? 'stop' : 'fail';
  }
  if (r.code === 0) return parseCounts(r.stdout) ? 'ok' : 'fail';
  return /no upstream|upstream branch|does not point to a branch/i.test(r.stderr ?? '') ? 'ok' : 'fail';
}
// Races a chain against the host's timer (a request can hang; never a sleep). At the
// deadline the shared flag goes down, so the chain sends nothing more, and the caller
// shows Unknown at once; settled() reports when the native work has really ended.
export function deadlined(start, after, ms) {
  const token = { live: true };
  const work = start(() => token.live);
  const result = new Promise((resolve, reject) => {
    let settled = false;
    after(ms, () => { token.live = false; if (!settled) { settled = true; reject(Error('deadline')); } });
    work.then(v => { if (!settled) { settled = true; resolve(v); } }, e => { if (!settled) { settled = true; reject(e); } });
  });
  return { token, result, settled: work.then(() => {}, () => {}) };
}

// The only Git Roster runs: the stock panel's two read-only queries, in the Space's
// folder on the Space's machine, through Herdr's exec with explicit arguments.
export const GIT_TOP = Object.freeze(['rev-parse', '--show-toplevel']);
export const GIT_COMMON = Object.freeze(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const oneLine = value => {
  const text = typeof value === 'string' ? value.replace(/\r?\n$/, '') : '';
  return text && !/[\x00-\x1f\x7f]/.test(text) ? text : null;
};
// Identity for one place. A repo is verified only when both queries succeed with exactly
// one line each; Git's own "not a git repository" is remembered as none;
// anything else (no answer, a hung or refused exec, a malformed answer) is unsure.
export function gitIdentity(top, common) {
  const answers = [top, common], at = answers.findIndex(r => !r || r.code !== 0);
  if (at >= 0) return /not a git repository/i.test(answers[at]?.stderr ?? '') ? { status: 'none' } : { status: 'unsure' };
  const t = oneLine(top.stdout), c = oneLine(common.stdout);
  if (!t || !c) return { status: 'unsure' };
  return { status: 'repo', top: t, common: c, linked: c !== t + '/.git' };
}

// Background probe cache keyed by machine and folder. Identity is asked once (retried
// when unsure, on the normal schedule); a verified repository's state is refreshed at most
// every stateMs. The host supplies exec, isReady (D8, above), a deadline timer and the
// clock; nothing is ever written to Git or Herdr.
export class GitIdentities {
  constructor(host, { atOnce = 4, retryMs = 60000, deadlineMs = 12000, stateMs = 30000 } = {}) {
    Object.assign(this, { host, atOnce, retryMs, deadlineMs, stateMs });
    this.cache = new Map(); this.queue = []; this.running = 0; this.changed = false;
    // Chains whose native work has not ended yet (a slot each until it really ends).
    this.active = new Set();
  }
  lookup(machine, folder) { return folder ? this.cache.get(placeKey(machine, folder)) ?? null : null; }
  request(places, after) {
    const now = this.host.now();
    for (const { machine, folder } of places) {
      if (!folder) continue;
      const key = placeKey(machine, folder), entry = this.cache.get(key);
      if (this.queue.some(q => q.key === key)) continue;
      const job = { key, machine: machine ?? null, folder };
      if (!entry || (entry.status === 'unsure' && now - entry.at >= this.retryMs)) {
        this.cache.set(key, { status: 'probing', at: now });
        this.queue.push({ ...job, kind: 'identity' });
      } else if (entry.status === 'repo' && !entry.stateBusy && !(now - (entry.stateAt ?? -Infinity) < this.stateMs)) {
        entry.stateBusy = true;
        this.queue.push({ ...job, kind: 'state' });
      }
    }
    this.pump(after);
  }
  // A machine that is no longer ready: nothing queued for it is dispatched; its waiting
  // answers become unknown until a later scheduled probe while it is ready again.
  cancel(machine) {
    const m = machine ?? null, now = this.host.now();
    this.queue = this.queue.filter(job => {
      if (job.machine !== m) return true;
      this.drop(job, now);
      return false;
    });
    // Running chains on that machine send nothing more; their answers are discarded.
    for (const job of this.active) if (job.machine === m) job.token.live = false;
  }
  drop(job, now) {
    if (job.kind === 'identity') this.cache.set(job.key, { status: 'unsure', at: now });
    else this.settleState(job.key, { dirty: null, ahead: null, behind: null, branch: null });
    this.changed = true;
  }
  pump(after) {
    while (this.running < this.atOnce && this.queue.length) {
      const job = this.queue.shift();
      // D8: re-check right before the dispatch; a machine that is no longer ready is not asked.
      if (!readyNow(this.host.isReady, job.machine)) { this.drop(job, this.host.now()); continue; }
      this.running++;
      const run = job.kind === 'identity'
        ? this.ask(job, [GIT_TOP, GIT_COMMON], acceptIdentity, gitIdentity, after)
        : this.ask(job, [GIT_STATUS, GIT_BRANCH, GIT_COUNTS], acceptState, (status, branch, counts) => gitState(status, counts, branch), after);
      job.token = run.token; this.active.add(job);
      run.result.then(
        result => job.kind === 'identity' ? this.cache.set(job.key, { ...result, at: this.host.now() }) : this.settleState(job.key, result),
        // Failed, late, cancelled or not ready: Unknown, never stale or partial.
        () => job.kind === 'identity' ? this.cache.set(job.key, { status: 'unsure', at: this.host.now() })
          : this.settleState(job.key, { dirty: null, ahead: null, behind: null, branch: null }))
        .finally(() => { this.changed = true; });
      // The slot frees only when the native work has ended, so the count stays true.
      run.settled.then(() => { this.active.delete(job); this.running--; this.changed = true; this.pump(after); });
    }
  }
  settleState(key, state) {
    const entry = this.cache.get(key);
    if (entry?.status === 'repo') this.cache.set(key, { ...entry, ...state, stateAt: this.host.now(), stateBusy: false });
  }
  // The queries run one after another in the place's folder on its machine, with explicit
  // arguments; D8 is checked right before each command, so a machine that stops being ready
  // between two commands gets no further call and the whole answer is unknown.
  ask({ machine, folder }, queries, accept, parse, after) {
    const options = { cwd: folder, on: machine, timeout: this.deadlineMs };
    return deadlined(live => runEach(this.host.exec, this.host.isReady, machine, queries, options, { accept, live })
      .then(answers => parse(...answers)), after, this.deadlineMs + 1000);
  }
  // True once since the last call when an answer arrived.
  takeChanged() { const changed = this.changed; this.changed = false; return changed; }
}

// Within one machine, keep Herdr's saved order and draw each linked worktree under the
// first main checkout with the same verified common directory, as the stock list does.
export function nestWorktrees(list, identityOf) {
  const id = s => { const g = identityOf(s); return g?.status === 'repo' ? g : null; };
  const mains = new Set(list.map(id).filter(g => g && !g.linked).map(g => g.common));
  const nested = s => id(s)?.linked && mains.has(id(s).common);
  const out = [], placed = new Set();
  for (const s of list) {
    if (nested(s)) continue;
    out.push({ space: s, tree: null });
    const g = id(s);
    if (!g || g.linked || placed.has(g.common)) continue;
    placed.add(g.common);
    const kids = list.filter(k => nested(k) && id(k).common === g.common);
    kids.forEach((k, n) => out.push({ space: k, tree: n === kids.length - 1 ? 'last' : 'middle' }));
  }
  return out;
}

// The checkout's state, read-only and without fetching: uncommitted changes (status
// without optional locks, so the index is not rewritten), commits ahead of and behind
// the locally known upstream, and the checked-out branch.
export const GIT_STATUS = Object.freeze(['--no-optional-locks', 'status', '--porcelain']);
export const GIT_COUNTS = Object.freeze(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
export const GIT_BRANCH = Object.freeze(['symbolic-ref', '-q', '--short', 'HEAD']);
// The parsers shared by acceptState (before the next command) and gitState (the value).
// git status --porcelain: "XY path" lines (paths with odd characters arrive quoted); an
// empty answer is a clean checkout. Returns dirty true/false, or null when malformed.
const STATUS_LINE = /^[ MTADRCU?!]{2} \S/;
export function parseStatus(stdout) {
  if (typeof stdout !== 'string') return null;
  const lines = stdout.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.length);
  return lines.every(line => STATUS_LINE.test(line) && !/[\x00-\x1f\x7f]/.test(line)) ? lines.length > 0 : null;
}
// rev-list --left-right --count: exactly "<ahead> <behind>".
export function parseCounts(stdout) {
  const m = typeof stdout === 'string' ? /^(\d+)\s+(\d+)\s*$/.exec(stdout) : null;
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null;
}
// Each answer is used only when its query succeeded and parses; a skipped or "no upstream"
// query leaves its indicator out.
export function gitState(status, counts, branch) {
  const state = { dirty: null, ahead: null, behind: null, branch: null };
  if (status?.code === 0) state.dirty = parseStatus(status.stdout);
  const c = counts?.code === 0 ? parseCounts(counts.stdout) : null;
  if (c) { state.ahead = c.ahead; state.behind = c.behind; }
  if (branch?.code === 0) state.branch = oneLine(branch.stdout);
  return state;
}
// A repository's name from its common directory, as the stock list derives it: the folder
// holding .git, a bare repository's own name, or the folder holding a hidden .bare.
export function repoName(common) {
  const parts = String(common ?? '').replace(/\/+$/, '').split('/');
  const last = parts.at(-1) ?? '';
  if (last === '.git') return parts.at(-2) || null;
  if (last === '.bare') return parts.at(-2) || null;
  return last.replace(/\.git$/, '') || null;
}
// The tail after a Space's name: repository and branch where they add something (no repo
// on a nested worktree row or when it is the Space's name; no main/master or a branch named
// like the Space), then the separate indicators, with a spelled-out tooltip.
export function spaceTail(space, git, tree) {
  const same = value => !!value && value.toLowerCase() === String(space?.name ?? '').trim().toLowerCase();
  if (git?.status !== 'repo') return { text: branchTail(space), dirty: false, ahead: 0, behind: 0, tooltip: '' };
  const repo = repoName(git.common), branch = git.branch ?? null;
  const text = [tree || same(repo) ? '' : repo, !branch || same(branch) || ['main', 'master'].includes(branch) ? '' : branch].filter(Boolean).join(' · ');
  const dirty = git.dirty === true, ahead = git.ahead > 0 ? git.ahead : 0, behind = git.behind > 0 ? git.behind : 0;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const tooltip = [dirty ? 'Uncommitted changes in this checkout' : '', ahead ? plural(ahead, 'local commit', 'local commits') + ' to push' : '',
    behind ? plural(behind, 'upstream commit', 'upstream commits') + ' to pull' : ''].filter(Boolean).join(' · ');
  return { text, dirty, ahead, behind, tooltip };
}

// A machine's operating system, for the icon beside its name. This computer's platform
// comes from Herdr's window(); Linux distributions from /etc/os-release read through
// Herdr's read-only file API on that machine. LOGO is only a key into this fixed map of
// bundled icons, never a path or URL; then ID; ID_LIKE is never used (Ubuntu is not Debian).
export const OS_LOGO_ICONS = Object.freeze({ 'ubuntu-logo': 'os-ubuntu', 'debian-logo': 'os-debian' });
export const OS_ID_ICONS = Object.freeze({ ubuntu: 'os-ubuntu', debian: 'os-debian' });
export const OS_RELEASE = '/etc/os-release';
export function parseOsRelease(text) {
  if (typeof text !== 'string' || text.length > 65536) return null;
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]{0,63})=(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2].trim();
    if (/^"[^"]*"$/.test(value) || /^'[^']*'$/.test(value)) value = value.slice(1, -1);
    if (value && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)) fields[m[1]] = value;
  }
  return Object.keys(fields).length ? fields : null;
}
// { icon, tooltip } for a known OS, or null to keep the generic machine icon.
export function machineOs({ platform = null, release = null } = {}) {
  if (platform === 'windows') return { icon: 'os-windows', tooltip: 'Windows' };
  const fields = typeof release === 'string' ? parseOsRelease(release) : release;
  if (!fields) return null;
  const icon = (Object.hasOwn(OS_LOGO_ICONS, fields.LOGO ?? '') ? OS_LOGO_ICONS[fields.LOGO] : null)
    ?? (Object.hasOwn(OS_ID_ICONS, (fields.ID ?? '').toLowerCase()) ? OS_ID_ICONS[fields.ID.toLowerCase()] : null) ?? 'os-linux';
  return { icon, tooltip: fields.PRETTY_NAME ?? fields.NAME ?? 'Linux' };
}
// Per-machine cache of os-release reads; ready machines only (D8, above), deadline-raced,
// one read per scheduled attempt, retried only after retryMs. A missing file, a failed
// read or lost readiness means the OS is unknown, so the generic icon stays.
export class MachineOs {
  constructor(host, { retryMs = 60000, deadlineMs = 8000 } = {}) {
    Object.assign(this, { host, retryMs, deadlineMs });
    this.cache = new Map(); this.changed = false;
  }
  lookup(machine) { const e = this.cache.get(machine ?? null); return e?.status === 'known' ? e.os : null; }
  request(machines, platform, after) {
    const now = this.host.now();
    for (const machine of machines) {
      const key = machine ?? null, entry = this.cache.get(key);
      if (entry && (entry.status !== 'unsure' || now - entry.at < this.retryMs)) continue;
      if (!readyNow(this.host.isReady, key)) continue;
      if (key === null && platform !== 'linux') {
        const os = machineOs({ platform });
        this.cache.set(key, os ? { status: 'known', os, at: now } : { status: 'unknown', at: now });
        this.changed = true; continue;
      }
      this.cache.set(key, { status: 'reading', at: now });
      let settled = false;
      const finish = entry => { if (settled) return; settled = true; this.cache.set(key, { ...entry, at: this.host.now() }); this.changed = true; };
      after(this.deadlineMs, () => finish({ status: 'unsure' }));
      Promise.resolve().then(() => {
        // D8: checked again as close to the read as the API allows.
        if (!readyNow(this.host.isReady, key)) throw Error('not-ready');
        return this.host.readTextFile(OS_RELEASE, { on: key });
      }).then(
        text => {
          if (!readyNow(this.host.isReady, key)) { finish({ status: 'unsure' }); return; }
          const os = typeof text === 'string' ? machineOs({ release: text }) : null; finish(os ? { status: 'known', os } : { status: 'unknown' });
        },
        () => finish({ status: 'unsure' }));
    }
  }
  takeChanged() { const changed = this.changed; this.changed = false; return changed; }
}

// "Open folder as Space…": suggestions are folders Herdr already reports on that machine
// (its panes' live folders) and checkouts Git verified there; nothing is guessed.
export function folderSuggestions(machine, panes = [], verifiedTops = [], limit = 6) {
  const m = machine ?? null, out = [];
  const onMachine = id => typeof id === 'string' && (m ? id.startsWith(m + '/') : !id.includes('/'));
  for (const folder of [...verifiedTops, ...(Array.isArray(panes) ? panes : []).filter(p => p && onMachine(p.pane) && validName(p.cwd)).map(p => p.cwd)])
    if (validName(folder) && !out.includes(folder)) out.push(folder);
  return out.slice(0, limit);
}
// The first Space on the same machine whose place Git verified as the same checkout.
export function matchingSpace(machine, top, spaces = [], panes = [], lookup = () => null) {
  if (!top) return null;
  return (Array.isArray(spaces) ? spaces : []).find(s => s && (s.machine ?? null) === (machine ?? null)
    && lookup(s.machine ?? null, spacePlace(s, panes))?.status === 'repo' && lookup(s.machine ?? null, spacePlace(s, panes)).top === top) ?? null;
}
// Verify one folder with the two read-only identity queries, raced against a deadline.
// On a remote machine, D8 (above), before each of the two commands and on the answer:
// not ready, or readiness lost at any point, is "Not verified" without another attempt.
export function verifyFolder(exec, machine, folder, after, deadlineMs = 12000, isReady = null) {
  const options = { cwd: folder, on: machine ?? null, timeout: deadlineMs };
  const run = deadlined(live => runEach(exec, isReady, machine ?? null, [GIT_TOP, GIT_COMMON], options, { accept: acceptIdentity, live })
    .then(answers => gitIdentity(...answers)), after, deadlineMs + 1000);
  return run.result.catch(() => ({ status: 'unsure' }));
}
