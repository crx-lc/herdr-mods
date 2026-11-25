// Needs you reminders: when the bell pulses and when Roster plays its chime. Pure: no Herdr
// imports; the view passes the pending identities, the clock and what the person is looking at.

// While Needs you is not empty: a pulse (and, by the Sound choice, a chime) on a new arrival,
// then every 2 minutes. A new arrival starts the 2 minutes again.
export const REMIND_MS = 120000;
// Roster's own chime, shipped in the mod; playSound resolves it against Herdr's home.
export const CHIME = 'mods/roster/sounds/chime.mp3';

// Options > Sound, kept in this mod's localStorage. Herdr itself plays its blocked sound when a
// session starts needing you, so the default leaves the arrival to Herdr and Roster plays only
// the reminders: nothing sounds twice and no Herdr setting has to change.
export const SOUND_KEY = 'roster.sound';
export const SOUND = Object.freeze({ off: 'off', reminders: 'reminders', arrival: 'arrival' });
export const SOUND_LABELS = Object.freeze({ off: 'Off', reminders: 'Reminders only', arrival: 'Arrival and reminders' });
const ORDER = [SOUND.off, SOUND.reminders, SOUND.arrival];
export const soundChoice = stored => ORDER.includes(stored) ? stored : SOUND.reminders;
export const nextSoundChoice = choice => ORDER[(ORDER.indexOf(soundChoice(choice)) + 1) % ORDER.length];
export function readSound(storage) {
  try { return soundChoice(typeof storage?.getItem === 'function' ? storage.getItem(SOUND_KEY) : null); } catch { return SOUND.reminders; }
}
export function writeSound(storage, value) {
  try { if (typeof storage?.setItem === 'function') storage.setItem(SOUND_KEY, soundChoice(value)); return true; } catch { return false; }
}
// settings.json's sounds.enabled: false mutes Herdr's alert sounds, and Roster's with them.
export function herdrMuted(settings) {
  const sounds = settings !== null && typeof settings === 'object' ? settings.sounds : null;
  return sounds !== null && typeof sounds === 'object' && sounds.enabled === false;
}
// Whether this event ('arrival' or 'reminder') plays Roster's chime.
export function playsChime(event, choice, settings) {
  if ((event !== 'arrival' && event !== 'reminder') || herdrMuted(settings)) return false;
  const c = soundChoice(choice);
  return c === SOUND.arrival || (c === SOUND.reminders && event === 'reminder');
}

// Herdr's "looking" rule for its toasts, as far as a mod can see it: the window is active
// and the focused terminal (or the terminal or agent it shows) is that session. An unknown
// window or focus counts as not looking, so a reminder is never lost to a guess.
export function lookingAt(addresses, focused, win) {
  if (win?.active !== true || focused === null || typeof focused !== 'object') return false;
  const seen = [focused.terminal, focused.shown, focused.agent].filter(a => typeof a === 'string' && a.length > 0);
  return addresses.some(a => typeof a === 'string' && seen.includes(a));
}

// The timer. The first look only records what is already pending: nothing sounds or pulses
// at start, and the first reminder for it comes 2 minutes later. take() answers 'arrival',
// 'reminder' or null. A reminder that falls due while the person looks at every pending
// session is skipped, and the next one is 2 minutes later.
export class Reminders {
  constructor(every = REMIND_MS) { this.every = every; this.seen = null; this.due = null; }
  start(identities, now) {
    if (this.seen !== null) return;
    this.seen = new Set(identities);
    this.due = this.seen.size ? now + this.every : null;
  }
  isDue(now) { return this.due !== null && now >= this.due; }
  take(identities, now, looking = () => false) {
    if (this.seen === null) { this.start(identities, now); return null; }
    const pending = new Set(identities), arrived = [...pending].some(id => !this.seen.has(id));
    this.seen = pending;
    if (!pending.size) { this.due = null; return null; }
    if (arrived || this.due === null) { this.due = now + this.every; return arrived ? 'arrival' : null; }
    if (now < this.due) return null;
    // Once per due time, even after a long sleep: no burst of missed reminders.
    this.due = now + this.every;
    return looking() ? null : 'reminder';
  }
}
