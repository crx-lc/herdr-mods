// Reading the project catalog, one file per machine (crx-lc/herdr-agents#141 S5; catalog.js has the rules).
// Pure: Herdr's APIs come in as a host object, so the tests drive every answer, hang and failure.
//
//   host: { readTextFile(path, { on }), machines(), terminals(), home(), platform(), now() }
//   refresh(force)   starts the reads that are due; tick() ends a read that passed its deadline (Roster's 1 s timer
//                    calls it). No timer is kept from a caller: a click handler's timer dies when it returns.
//                    The deadline is a time, read at every use (late(), below): right before the host read starts
//                    and when its answer is taken, whether or not a tick came first.
//   sources()        [{ machine, status, why, result, current, at, path }] for project-groups.js
//
// This computer: the fixed path for its platform. Another machine: only while Herdr reports it ready, with the
// readiness checked right before the one read and again on the answer (D8, remoteCatalogRead); never retried.
// Either way, a watcher's `herdr.projects` label names the exact path when exactly one valid one is on that
// machine (a non-default data folder). Nothing else is discovered: no folder scan, no `hc`, no other file.
import { assessCatalog, remoteCatalogRead, catalogPath, REMOTE_CATALOG_PATH, LABEL } from './catalog.js';
import { publishedLocalPath } from './local-reader.js';
import { addressParts } from './normalize.js';

const machineName = value => typeof value === 'string' && !!value && !/[\s/\x00-\x1f\x7f]/.test(value) ? value : null;

// The watcher's label path on one machine, or null: exactly one distinct valid absolute path among its live terminals.
export function labelPath(terminals, machine) {
  const paths = new Set();
  for (const t of Array.isArray(terminals) ? terminals : []) {
    const parts = addressParts(t?.address);
    if (!parts || (parts.alias || null) !== machine || t.state !== 'live') continue;
    const path = t.labels?.[LABEL];
    if (publishedLocalPath(path)) paths.add(path);
  }
  return paths.size === 1 ? [...paths][0] : null;
}

export class CatalogSource {
  constructor(host, { refreshMs = 60000, deadlineMs = 5000 } = {}) {
    Object.assign(this, { host, refreshMs, deadlineMs });
    this.entries = new Map(); this.revisions = new Map(); this.busy = new Set(); this.deadlines = new Map(); this.last = -Infinity; this.changed = false;
  }
  // The machines to read: this computer, and every machine Herdr lists (ready ones are read, the rest are noted).
  machines() {
    const listed = (this.host.machines() ?? []).map(m => m?.name ?? null);
    return [null, ...new Set(listed.map(machineName).filter(Boolean))];
  }
  ready(machine) {
    try { return (this.host.machines() ?? []).some(m => (m?.name ?? null) === machine && m?.layout === 'ready'); } catch { return false; }
  }
  pathFor(machine) {
    let label = null;
    try { label = labelPath(this.host.terminals(), machine); } catch { label = null; }
    if (label) return label;
    if (machine !== null) return REMOTE_CATALOG_PATH;
    try { return catalogPath(this.host.platform(), this.host.home()); } catch { return null; }
  }
  // Starts a read of each machine whose previous read has ended, at most once per refreshMs. true when started.
  refresh(force = false) {
    this.tick();
    const now = this.host.now();
    if (!force && now - this.last < this.refreshMs) return false;
    this.last = now;
    const machines = this.machines();
    // A machine Herdr no longer lists is forgotten; its revision high-water stays for when it comes back.
    for (const machine of [...this.entries.keys()]) if (!machines.includes(machine)) { this.entries.delete(machine); this.changed = true; }
    for (const machine of machines) this.read(machine);
    return true;
  }
  // The one deadline rule, the same as in github.js: no I/O starts and no result is accepted at or after the job's
  // deadline, and a job that has settled starts nothing more. late(at) reads the clock at the moment of use; a read
  // asks it in start (before the host read) and in finish (when an answer is taken), both in read().
  late(at) { return this.host.now() >= at; }
  // A read past its deadline is unavailable ('timeout'); its slot stays taken until the read really ends. Only the
  // sweep for a read that has not answered: start and finish read the clock themselves, so nothing depends on this
  // having run.
  tick() {
    for (const d of [...this.deadlines.values()]) if (this.late(d.at)) d.finish({ status: 'unavailable', why: 'timeout' });
  }
  settle(machine, next) {
    const before = this.entries.get(machine);
    // A failed or unknown read keeps the last accepted catalog, marked not current: it still lists that machine's
    // projects, but no terminal joins a project through it.
    // A failed, unknown or now missing read keeps the last accepted catalog, marked not current: its projects stay
    // listed (flagged) but no terminal joins a project through it. A file that was never there (no catalog read from
    // this machine in this run) is simply no catalog: nothing to keep.
    const kept = next.status === 'ok' ? next.result : before?.result ?? null;
    this.entries.set(machine, { machine, status: next.status, why: next.why ?? null, path: next.path ?? before?.path ?? null,
      result: kept, current: next.status === 'ok' || (next.status === 'missing' && !kept), at: this.host.now(), okAt: next.status === 'ok' ? this.host.now() : before?.okAt ?? null });
    this.changed = true;
  }
  read(machine) {
    if (this.busy.has(machine)) return;
    const before = this.entries.get(machine);
    if (machine !== null && !this.ready(machine)) { this.settle(machine, { status: 'unavailable', why: 'not-ready' }); return; }
    const path = this.pathFor(machine);
    if (!path) { this.settle(machine, { status: 'unavailable', why: 'no-location' }); return; }
    if (!before) { this.entries.set(machine, { machine, status: 'reading', why: null, path, result: null, current: false, at: this.host.now(), okAt: null }); this.changed = true; }
    this.busy.add(machine);
    // The deadline rule (late(), above) at this job's two uses. finish: whatever arrives at or after the deadline is
    // 'timeout', and only an accepted catalog moves the revision high-water; both happen here and nowhere else.
    const deadline = this.host.now() + this.deadlineMs;
    let settled = false, refused = false;
    const finish = next => {
      if (settled) return; settled = true; this.deadlines.delete(machine);
      if (this.late(deadline)) next = { status: 'unavailable', why: 'timeout' };
      if (next.status === 'ok') this.revisions.set(machine, Math.max(this.revisions.get(machine) ?? 0, next.result.revision));
      this.settle(machine, { ...next, path });
    };
    this.deadlines.set(machine, { at: deadline, finish });
    // start: the only host read of this job (one per machine, never a second request), asked at the moment of the
    // call. Both reads below begin after an await (a microtask; for another machine, the readiness check), so the
    // deadline can have passed, or a tick can have ended the read, in between: then no host read is made, the work
    // ends at once and the slot is free.
    const start = on => {
      if (settled || this.late(deadline)) { refused = true; throw new Error('deadline'); }
      return this.host.readTextFile(path, { on });
    };
    const work = machine === null
      ? Promise.resolve().then(() => start(null)).then(text => ({ state: 'available', text, local: true }), () => ({ state: 'unavailable', reason: 'read-failed' }))
      : remoteCatalogRead({ machine, isReady: () => this.ready(machine), read: () => start(machine) });
    // The slot frees only when the read has really ended, so a hung read is never started twice.
    Promise.resolve(work).then(outcome => {
      if (refused) { finish({ status: 'unavailable', why: 'timeout' }); return; }
      if (outcome.state !== 'available') { finish({ status: 'unavailable', why: outcome.reason }); return; }
      if (outcome.local && outcome.text === null) { finish({ status: 'missing', why: 'no-file' }); return; }
      const result = assessCatalog({ text: outcome.text, lastRevision: this.revisions.get(machine) ?? null });
      if (result.status !== 'ok') { finish({ status: 'unknown', why: result.why }); return; }
      finish({ status: 'ok', result });
    }, () => finish({ status: 'unavailable', why: 'read-failed' })).finally(() => { this.busy.delete(machine); this.changed = true; });
  }
  sources() { return [...this.entries.values()]; }
  takeChanged() { const changed = this.changed; this.changed = false; return changed; }
}

// A catalog icon as a file Herdr can draw (its image element takes local paths only): written once under the mod's hidden .cache/icons/ (saving a
// hidden file does not reload the mod), then read back and compared before it is shown. Keyed by its verified sha256.
// Outside the deadline rule above, on purpose: it is not a job with a deadline. What bounds it: one chain of at most
// four file calls per distinct sha256 for the life of this object, never repeated; a call that never ends leaves only
// that icon as 'writing' (its monogram is drawn) and holds nothing anything else waits for.
//   host: { dir, rel, mkdir(dir), readTextFile(path), writeTextFile(path, text, expected) }
const SHA = /^[0-9a-f]{64}$/;
export class ProjectIcons {
  constructor(host) { this.host = host; this.files = new Map(); this.changed = false; }
  // The icon's sha256 once its file (<rel>/<sha256>.svg, relative to Herdr's home) is written and verified, else null.
  lookup(icon) { return icon && SHA.test(icon.sha256) && this.files.get(icon.sha256)?.status === 'ready' ? icon.sha256 : null; }
  ensure(icon) {
    if (!icon || !SHA.test(icon.sha256) || typeof icon.svg !== 'string' || this.files.has(icon.sha256)) return;
    this.files.set(icon.sha256, { status: 'writing' });
    const path = `${this.host.dir}/${icon.sha256}.svg`;
    const done = status => { this.files.set(icon.sha256, { status }); this.changed = true; };
    Promise.resolve().then(async () => {
      const existing = await this.host.readTextFile(path).catch(() => null);
      if (existing !== icon.svg) {
        await this.host.mkdir(this.host.dir);
        await this.host.writeTextFile(path, icon.svg, existing ?? null);
      }
      return this.host.readTextFile(path);
    }).then(text => done(text === icon.svg ? 'ready' : 'failed'), () => done('failed'));
  }
  takeChanged() { const changed = this.changed; this.changed = false; return changed; }
}
