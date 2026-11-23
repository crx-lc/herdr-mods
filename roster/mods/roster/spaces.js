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
        active: space.active === true, branch: branchTail(space), status: space.status ?? null, tree });
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

// Background probe cache keyed by machine and folder. The host supplies exec, a
// deadline timer and the clock; results are only read, never written to Herdr.
export class GitIdentities {
  constructor(host, { atOnce = 4, retryMs = 60000, deadlineMs = 12000 } = {}) {
    Object.assign(this, { host, atOnce, retryMs, deadlineMs });
    this.cache = new Map(); this.queue = []; this.running = 0; this.changed = false;
  }
  lookup(machine, folder) { return folder ? this.cache.get(placeKey(machine, folder)) ?? null : null; }
  request(places, after) {
    const now = this.host.now();
    for (const { machine, folder } of places) {
      if (!folder) continue;
      const key = placeKey(machine, folder), entry = this.cache.get(key);
      if (entry && (entry.status !== 'unsure' || now - entry.at < this.retryMs)) continue;
      if (this.queue.some(q => q.key === key)) continue;
      this.cache.set(key, { status: 'probing', at: now });
      this.queue.push({ key, machine: machine ?? null, folder });
    }
    this.pump(after);
  }
  // A machine that came back: its unsure answers are asked again.
  retry(machine) { for (const [key, entry] of this.cache) if (JSON.parse(key)[0] === (machine ?? null) && entry.status === 'unsure') entry.at = -Infinity; }
  pump(after) {
    while (this.running < this.atOnce && this.queue.length) {
      const job = this.queue.shift(); this.running++;
      this.probe(job, after).then(result => { this.cache.set(job.key, { ...result, at: this.host.now() }); },
        () => { this.cache.set(job.key, { status: 'unsure', at: this.host.now() }); })
        .finally(() => { this.running--; this.changed = true; this.pump(after); });
    }
  }
  probe({ machine, folder }, after) {
    const options = { cwd: folder, on: machine, timeout: this.deadlineMs };
    const ask = args => this.host.exec('git', [...args], options);
    const both = Promise.all([ask(GIT_TOP), ask(GIT_COMMON)]).then(([t, c]) => gitIdentity(t, c));
    // A request can hang: race it against the host's timer, not a sleep.
    return new Promise((resolve, reject) => {
      let settled = false;
      after(this.deadlineMs + 1000, () => { if (!settled) { settled = true; reject(Error('deadline')); } });
      both.then(v => { if (!settled) { settled = true; resolve(v); } }, e => { if (!settled) { settled = true; reject(e); } });
    });
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
