// Portable disclosure identity and admission. No native APIs or display-name matching.
export function machineAnchor(machine, machines = []) {
  const found = machines.filter(m => m && (m.name ?? null) === machine);
  if (found.length !== 1 || found[0].layout !== 'ready') return null;
  // The public desktop API identifies machines by exact name (null is local).
  // Preserve an identity if supplied; never manufacture a Core ID from the name.
  return JSON.stringify([machine, found[0].id ?? null]);
}
export function rowAnchor(instance, snapshot = {}) {
  if (!instance || instance.kind !== 'terminal') return null;
  const row = instance.row, raw = (snapshot.terminals ?? []).filter(t => t?.address === row.address);
  const machine = row.address.includes('/') ? row.address.slice(0, row.address.indexOf('/')) : null;
  const target = machineAnchor(machine, snapshot.machines);
  if (!target || raw.length !== 1 || raw[0].state !== 'live') return null;
  return JSON.stringify([instance.key, instance.identity, row.associationKey, target,
    raw[0].created_ms ?? null, raw[0].pid ?? null, raw[0].labels?.['herdr.run'] ?? null]);
}
export function sameDisclosure(panel, kind, anchor) {
  return !!anchor && panel?.kind === kind && panel.anchor === anchor;
}
export function returnControl(returnKey, controls, fallback = 'mode:projects') {
  return controls.some(c => c.key === returnKey) ? returnKey : fallback;
}
export function folderActionAllowed(ns, machineToken, folder, confirmed = false) {
  return !!ns && !!machineToken && ns.anchor === machineToken && ns.folder === folder
    && typeof folder === 'string' && !!folder.trim() && !/[\x00-\x1f\x7f]/.test(folder)
    && (ns.check?.status === 'repo' || (confirmed && ns.confirmUnverified && ['unsure', 'none'].includes(ns.check?.status)));
}

// Add wrap opportunities to unusually long tokens for the compact reading surface.
// Actions and accessibility labels retain the original value.
export function panelText(value) {
  return String(value ?? '').replace(/[^\s]{25,}/gu, word => Array.from(word).reduce((s, c, n) => s + (n && n % 24 === 0 ? '\u200b' : '') + c, ''));
}

export function spaceAnchor(space, panes = []) {
  if (!space) return null;
  const tabs = (space.tabs ?? []).map(t => t.id);
  const cwd = panes.find(p => tabs.includes(p?.tab) && typeof p.cwd === 'string' && p.cwd.trim())?.cwd ?? space.folder ?? null;
  return JSON.stringify([space.id, space.machine ?? null, space.folder ?? null, tabs, cwd]);
}
