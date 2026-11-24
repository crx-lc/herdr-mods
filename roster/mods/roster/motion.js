// Motion for status icons only (never on rows). Pure: no Herdr imports.

// Reduced motion: Herdr reports no system preference to mods, so Roster honors a
// reduce_motion / reduced_motion flag if Herdr's settings ever carry one, and its own
// "Motion" choice in Options, kept in this mod's localStorage.
export const MOTION_KEY = 'roster.motion';
export function reducedMotion(settings, stored) {
  const s = settings !== null && typeof settings === 'object' ? settings : {};
  return s.reduce_motion === true || s.reduced_motion === true || stored === 'reduce';
}
export function readStored(storage) {
  try { return typeof storage?.getItem === 'function' ? storage.getItem(MOTION_KEY) : null; } catch { return null; }
}
export function writeStored(storage, value) {
  try { if (typeof storage?.setItem === 'function') storage.setItem(MOTION_KEY, value); return true; } catch { return false; }
}

// A new arrival in Needs you: an identity not pending at the previous look. The first
// look only records what is already pending, so nothing pulses at start.
export class Arrivals {
  constructor() { this.seen = null; }
  take(identities) {
    const now = new Set(identities);
    const fresh = this.seen !== null && [...now].some(id => !this.seen.has(id));
    this.seen = now;
    return fresh;
  }
}
// One short pulse, then still: three swings of the bell's opacity.
export const PULSE = { from: 0.3, to: 1, period: 650, ms: 2000 };
