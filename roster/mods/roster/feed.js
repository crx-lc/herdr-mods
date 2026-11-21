import { normalizeApp, addressParts } from './normalize.js';
import { resolveIdentities } from './identity.js';
import { enrichMetadata } from './metadata.js';
import { reduceRoster } from './attention.js';
import { parseSettings } from './settings.js';

export const copy = value => JSON.parse(JSON.stringify(value));
export function capture(host) {
  // No await or downstream getter calls: one synchronous published observation.
  return copy({ terminals: host.terminals(), machines: host.machines(), panes: host.panes(),
    spaces: host.spaces(), agents: host.agents(), focused: host.focused() });
}
export const emptyEvidence = () => ({ cores: [], documents: [], routes: [], scopes: [], correlations: [], admissions: [] });
export class Feed {
  constructor() { this.generation = 0; this.fingerprint = null; this.previous = new Map(); this.history = []; this.documents = []; }
  update(snapshot, now, evidence = emptyEvidence(), { refresh = false } = {}) {
    const fingerprint = JSON.stringify([snapshot, evidence]);
    if (refresh || fingerprint !== this.fingerprint) {
      this.generation++; this.fingerprint = fingerprint; this.documents = [];
    }
    this.snapshot = snapshot; this.evidence = evidence;
    const present = new Set(), records = [];
    for (const raw of snapshot.terminals) {
      const parts = addressParts(raw?.address);
      if (!parts) continue;
      const machine = snapshot.machines.filter(m => m?.name === (parts.alias || null));
      const ready = machine.length === 1 && machine[0].layout === 'ready';
      const panes = snapshot.panes.filter(p => p?.terminal === raw.address);
      const tabs = panes.length === 1 ? snapshot.spaces.flatMap(s => s.tabs ?? []).filter(t => t.id === panes[0].tab) : [];
      const observation = { observedAt: now, refresh: ready ? 'success' : 'error',
        tabTitle: tabs.length === 1 ? tabs[0].name : null, tabNamed: tabs.length === 1 && tabs[0].named === true };
      const row = normalizeApp(raw, observation, now);
      if (!row) continue;
      const key = JSON.stringify([raw.address, raw.created_ms]); present.add(key);
      this.previous.set(key, row); records.push(row);
    }
    for (const [key, old] of this.previous) if (!present.has(key)) records.push({ ...old, freshness: 'stale', appStatus: 'unknown' });
    const rows = enrichMetadata(resolveIdentities(records, evidence.cores ?? []), parseSettings(evidence.settings ?? null)).rows;
    const options = { terminals: snapshot.terminals, machines: snapshot.machines, generation: this.generation,
      history: this.history, correlations: evidence.correlations ?? [], documents: [...(evidence.documents ?? []), ...this.documents] };
    // Assess with actual R2, retain revision high-water even when incomplete.
    const first = reduceRoster(rows, options); this.history = first.history;
    const admitted = options.documents.filter(d => first.rows.some(r => r.associationKey
      && r.roster.delegation.knowledge === 'known' && r.identityEvidence.some(i => i.address === d.producer?.address)));
    this.reduced = reduceRoster(rows, { ...options, history: this.history, documents: admitted });
    this.history = this.reduced.history;
    const routes = (evidence.routes ?? []).filter(r => {
      const row = rows.find(row => row.associationKey === r.associationKey);
      if (!row || r.generation !== this.generation || evidence.panesComplete !== true) return false;
      const parts = addressParts(row.address), machine = snapshot.machines.filter(m => m?.name === (parts.alias || null));
      if (machine.length !== 1 || machine[0].layout !== 'ready') return false;
      const panes = snapshot.panes.filter(p => p?.terminal === row.address);
      return r.presentation === 'pane' ? panes.length === 1 && typeof panes[0].id === 'string'
        : r.presentation === 'pane-less' && panes.length === 0;
    });
    this.navigation = { generation: this.generation, routes };
    return this;
  }
  accept(documents, generation, fingerprint) {
    if (generation !== this.generation || fingerprint !== this.fingerprint) return false;
    this.documents = documents; return true;
  }
}
