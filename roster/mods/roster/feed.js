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
export const emptyEvidence = () => ({ cores: [], documents: [], routes: [], scopes: [], repositories: [], correlations: [], admissions: [] });
// Select acquisition facts, excluding UI focus, selection, scrolling and agent display.
const pick = (record, keys) => record == null ? record : Object.fromEntries(keys.map(k => [k, record[k]]));
const terminalFacts = t => pick(t, ['address', 'state', 'created_ms', 'finished_ms', 'pid', 'argv', 'keep', 'parent', 'name', 'labels']);
const snapshotFacts = snapshot => ({
  terminals: snapshot.terminals.map(terminalFacts),
  machines: snapshot.machines.map(m => pick(m, ['name', 'layout'])),
  panes: snapshot.panes.map(p => pick(p, ['pane', 'terminal', 'tab'])),
  spaces: snapshot.spaces.map(s => ({ tabs: (s?.tabs ?? []).map(t => pick(t, ['id', 'name', 'named'])) })),
});
// Only these top-level tokens are derived acquisition stamps. Nested/source generations
// and all other proof fields remain part of the fingerprint, including withdrawals.
const evidenceFacts = evidence => Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'generation').map(([key, value]) =>
  [key, ['routes', 'documents', 'admissions', 'correlations', 'scopes'].includes(key) && Array.isArray(value)
    ? value.map(v => {
      const { generation, ...proof } = v;
      // Admission producer is an exact raw observation string; select its acquisition
      // fields here only. LocalReader still validates the full current observation.
      if (key === 'documents' && proof.producer && typeof proof.producer === 'object') proof.producer = terminalFacts(proof.producer);
      if (key === 'admissions' && typeof proof.producer === 'string') {
        try { proof.producer = terminalFacts(JSON.parse(proof.producer)); } catch { /* malformed proof remains fingerprinted */ }
      }
      return proof;
    }) : value]));
const validId = value => typeof value === 'string' && !!value.trim() && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
function validPanes(panes) {
  const ids = new Set();
  return panes.every(p => p && validId(p.pane) && validId(p.tab)
    && (p.terminal === null || !!addressParts(p.terminal)) && !ids.has(p.pane) && !!ids.add(p.pane));
}
export class Feed {
  constructor() { this.generation = 0; this.fingerprint = null; this.history = []; this.documents = []; }
  update(snapshot, now, evidence = emptyEvidence(), { refresh = false } = {}) {
    const snapshotFingerprint = JSON.stringify(snapshotFacts(snapshot));
    const snapshotChanged = refresh || snapshotFingerprint !== this.snapshotFingerprint;
    if (snapshotChanged) { this.generation++; this.documents = []; }
    // Providers are synchronous/pure. Sample at the allocated generation; a proof-only
    // change allocates once, then resamples so accepted stamps use that generation.
    const provider = typeof evidence === 'function' ? evidence : null;
    if (provider) evidence = provider(snapshot, this.generation);
    let fingerprint = JSON.stringify([snapshotFingerprint, evidenceFacts(evidence)]);
    if (!snapshotChanged && fingerprint !== this.fingerprint) {
      this.generation++; this.documents = [];
      if (provider) evidence = provider(snapshot, this.generation);
      fingerprint = JSON.stringify([snapshotFingerprint, evidenceFacts(evidence)]);
    }
    this.snapshotFingerprint = snapshotFingerprint; this.fingerprint = fingerprint;
    this.snapshot = snapshot; this.evidence = evidence;
    const records = [];
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
      records.push(row);
    }
    const rows = enrichMetadata(resolveIdentities(records, evidence.cores ?? []), parseSettings(evidence.settings ?? null)).rows;
    const options = { terminals: snapshot.terminals, machines: snapshot.machines, generation: this.generation,
      history: this.history, correlations: evidence.correlations ?? [], documents: [...(evidence.documents ?? []), ...this.documents] };
    // Assess with actual R2, retain revision high-water even when incomplete.
    const first = reduceRoster(rows, options); this.history = first.history;
    const admitted = options.documents.filter(d => first.rows.some(r => r.associationKey
      && r.roster.delegation.knowledge === 'known' && r.identityEvidence.some(i => i.address === d.producer?.address)));
    this.reduced = reduceRoster(rows, { ...options, history: this.history, documents: admitted });
    this.history = this.reduced.history;
    const panesValid = validPanes(snapshot.panes);
    const routes = (evidence.routes ?? []).filter(r => {
      const row = rows.find(row => row.associationKey === r.associationKey);
      if (!row || r.generation !== this.generation || evidence.panesComplete !== true || !panesValid) return false;
      const parts = addressParts(row.address), machine = snapshot.machines.filter(m => m?.name === (parts.alias || null));
      if (machine.length !== 1 || machine[0].layout !== 'ready') return false;
      const panes = snapshot.panes.filter(p => p?.terminal === row.address);
      return r.presentation === 'pane' ? panes.length === 1
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
