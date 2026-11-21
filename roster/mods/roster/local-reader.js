import { readDelegations } from './delegations.js';
import { addressParts } from './normalize.js';
export const publishedLocalPath = p => typeof p === 'string' && p.length > 1 && p.length <= 4096
  && !/[\x00-\x1f\x7f]/.test(p) && !p.includes('\\') && !p.startsWith('//')
  && (/^\/(?!\/)/.test(p) || /^[A-Za-z]:\//.test(p)) && !/^[a-z]+:\/\//i.test(p);
const bytes = s => { let n = 0; for (const c of s) { const v = c.codePointAt(0); n += v < 128 ? 1 : v < 2048 ? 2 : v < 65536 ? 3 : 4; } return n; };
export class LocalReader {
  constructor(host) { this.host = host; this.outstanding = 0; this.last = -Infinity; }
  async refresh(feed, now, deadline = p => this.host.deadline(p)) {
    if (now - this.last < 10000) return false;
    this.last = now;
    const generation = feed.generation, fingerprint = feed.fingerprint, snapshot = feed.snapshot;
    const candidates = snapshot.terminals.filter(t => {
      const parts = addressParts(t?.address);
      if (!parts || parts.alias || !publishedLocalPath(t.labels?.['herdr.delegations'])) return false;
      const rows = feed.reduced.rows.filter(r => r.address === t.address && r.incarnation === t.created_ms);
      const proof = (feed.evidence.admissions ?? []).filter(a => a.address === t.address);
      return rows.length === 1 && rows[0].core.verified && rows[0].freshness === 'current' && t.state === 'live'
        && Number.isSafeInteger(t.pid) && t.pid > 0 && Array.isArray(t.argv) && typeof t.argv[0] === 'string'
        && proof.length === 1 && proof[0].verified === true && proof[0].continuity === true
        && proof[0].coreId === rows[0].core.id && proof[0].generation === generation
        && proof[0].producer === JSON.stringify(t) && typeof proof[0].source === 'string' && !!proof[0].source.trim();
    }).slice(0, 16);
    let total = 0; const documents = [];
    await Promise.all(candidates.map(async producer => {
      if (this.outstanding >= 2) return;
      this.outstanding++;
      // Deadline releases UI waiting, never the underlying native-read slot.
      const native = Promise.resolve().then(() => this.host.readTextFile(producer.labels['herdr.delegations'], { on: null }));
      native.then(() => this.outstanding--, () => this.outstanding--);
      const result = await readDelegations({ readTextFile: () => native, deadline,
        generation: () => feed.generation === generation && feed.fingerprint === fingerprint ? generation : null }, producer, generation);
      if (result.status !== 'read' || typeof result.text !== 'string') return;
      const size = bytes(result.text);
      if (size > 1048576 || total + size > 4194304) return;
      total += size; documents.push({ producer, text: result.text, generation });
    }));
    return feed.accept(documents, generation, fingerprint);
  }
}
