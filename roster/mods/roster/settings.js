import { normalizeConfig } from './metadata.js';

const id = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s);
export const assetName = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(png|svg)$/.test(s);
const fields = ['projects', 'projectBindings', 'contexts', 'processProviders', 'projectProviders'];
const empty = () => ({ version: 1, projects: [], projectBindings: [], contexts: [], processProviders: [], projectProviders: [], icons: [] });

// A host deadline must settle even if its operation never does. A timed-out write
// may still commit; callers must reread before retrying, never assume rollback.
export async function bounded(host, operation) {
  try { return await host.deadline(Promise.resolve().then(operation)); }
  catch { throw new Error('host-failure'); }
}
export function parseSettings(raw) {
  if (raw === null) return empty();
  if (typeof raw !== 'string' || raw.length > 262144) throw new Error('invalid-settings');
  let c; try { c = JSON.parse(raw); } catch { throw new Error('invalid-settings'); }
  if (!c || Array.isArray(c) || typeof c !== 'object' || c.version !== 1 || Object.keys(c).some(k => !['version', ...fields, 'icons'].includes(k)) || fields.some(k => !Array.isArray(c[k]) || c[k].length > 1024) || !Array.isArray(c.icons) || c.icons.length > 1024) throw new Error('invalid-settings');
  const normalized = normalizeConfig(c);
  if (normalized.rejected.length || new Set(c.projects.map(p => p.id)).size !== c.projects.length || c.icons.some(i => !i || Object.keys(i).sort().join(',') !== 'asset,projectId' || !id(i.projectId) || !assetName(i.asset) || !c.projects.some(p => p.id === i.projectId)) || new Set(c.icons.map(i => i.projectId)).size !== c.icons.length) throw new Error('invalid-settings');
  return c;
}
export async function readSettings(host) {
  const raw = await bounded(host, () => host.readSettings());
  return { raw, config: parseSettings(raw) };
}
export async function setProjectIcon(host, projectId, asset) {
  if (!id(projectId) || (asset !== null && !assetName(asset))) throw new Error('invalid-argument');
  const { raw, config } = await readSettings(host);
  if (!config.projects.some(p => p.id === projectId)) throw new Error('unknown-project');
  const next = { ...config, icons: config.icons.filter(i => i.projectId !== projectId) };
  if (asset !== null) next.icons.push({ projectId, asset });
  const serialized = JSON.stringify(next);
  parseSettings(serialized); // Never commit a document that this helper cannot read back.
  const result = await bounded(host, () => host.compareAndSwapSettings(raw, serialized));
  if (result === 'conflict') throw new Error('conflict');
  if (result !== 'ok') throw new Error('write-failure');
  return next;
}
