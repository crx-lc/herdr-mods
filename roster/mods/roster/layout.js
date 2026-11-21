import { copy } from './feed.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const name = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
export function nodes(tree) {
  const queue = [tree], out = [];
  while (queue.length) {
    const n = queue.pop();
    if (!n || typeof n !== 'object' || Array.isArray(n)) throw Error('invalid-layout');
    out.push(n); if (out.length > 4096) throw Error('layout-too-large');
    queue.push(...(n.children ?? []), ...(n.floating ?? []));
  }
  return out;
}
export function slots(tree) {
  const all = nodes(tree);
  return all.filter(n => n.type === 'block' && n.content?.mod === 'agents' && typeof n.id === 'string'
    && all.filter(other => other.id === n.id).length === 1).map(n => ({ id: n.id, content: copy(n.content) }));
}
function selected(tree, id, expected) {
  const found = nodes(tree).filter(n => n.id === id);
  if (found.length !== 1 || !same(found[0].content, expected)) throw Error('slot-changed');
  return found[0];
}
export class LayoutOptIn {
  constructor(host) { this.host = host; this.busy = false; }
  inspect() { const current = copy(this.host.current()); if (!name(current.name)) throw Error('invalid-layout-name'); return { ...current, slots: slots(current.tree) }; }
  async enable(selection, slot, token, deadline = p => p) {
    if (this.busy || !name(token) || !name(selection?.name)) throw Error('activation-busy-or-invalid');
    this.busy = true;
    try {
      const current = this.host.current();
      if (!same({ name: selection.name, tree: selection.tree }, current)) throw Error('layout-changed');
      const chosen = slots(current.tree).find(s => s.id === slot);
      if (!chosen) throw Error('select-existing-agents-slot');
      const source = await deadline(this.host.readLayout(current.name));
      if (typeof source !== 'string' || source.length > 1048576) throw Error('unreadable-layout');
      const record = { version: 1, token, source: current.name, slot, working: `roster-${token}`,
        preserved: `roster-preserved-${token}`, original: chosen.content,
        owned: { ...chosen.content, mod: 'roster', props: { ...chosen.content.props, rosterToken: token } } };
      const next = copy(current.tree); selected(next, slot, record.original).content = copy(record.owned);
      // Current effective tree preserved BEFORE restoration record, working copy or activation.
      await deadline(this.host.writeLayout(record.preserved, JSON.stringify(current.tree), null));
      await deadline(this.host.save(token, JSON.stringify(record)));
      if (await deadline(this.host.readLayout(current.name)) !== source || !same(this.host.current(), current)) throw Error('layout-changed');
      await deadline(this.host.writeLayout(record.working, JSON.stringify(next), null));
      if (await deadline(this.host.readLayout(current.name)) !== source || !same(this.host.current(), current)) throw Error('layout-changed');
      this.host.switchLayout(record.working);
      return record;
    } finally { this.busy = false; }
  }
  async undo(token, deadline = p => p) {
    if (this.busy || !name(token)) throw Error('activation-busy-or-invalid');
    this.busy = true;
    try {
      const raw = await deadline(this.host.load(token));
      if (typeof raw !== 'string' || raw.length > 262144) throw Error('invalid-restoration');
      const record = JSON.parse(raw);
      if (record.version !== 1 || record.token !== token || record.working !== `roster-${token}`
        || record.preserved !== `roster-preserved-${token}` || record.original?.mod !== 'agents'
        || record.owned?.mod !== 'roster' || record.owned?.props?.rosterToken !== token) throw Error('invalid-restoration');
      const current = this.host.current();
      if (current.name !== record.working) throw Error('layout-changed');
      selected(current.tree, record.slot, record.owned);
      const text = await deadline(this.host.readLayout(record.working));
      if (typeof text !== 'string' || text.length > 1048576) throw Error('unreadable-layout');
      const next = JSON.parse(text); selected(next, record.slot, record.owned).content = copy(record.original);
      // Merge just our content into latest disk tree; expected text detects concurrent disk edits.
      if (!same(this.host.current(), current)) throw Error('layout-changed');
      await deadline(this.host.writeLayout(record.working, JSON.stringify(next), text));
      return true;
    } finally { this.busy = false; }
  }
}
