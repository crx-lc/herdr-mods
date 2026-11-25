import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRosterView } from '../view.js';
import { Reminders, NeedsYou, IDLE_MS, REMIND_MS, CHIME, SOUND, SOUND_KEY, soundChoice, nextSoundChoice, readSound, writeSound, herdrMuted, playsChime, lookingAt } from '../reminders.js';
import { PULSE } from '../motion.js';
import { fakeHost, terminal, kit, context, appOf, flatten, textOf, layoutHostUnused } from './sidebar-fixtures.mjs';

const MIN2 = 120000;

test('the timer: an arrival, then every 2 minutes while pending; a new arrival resets it; empty stops it', () => {
  assert.equal(REMIND_MS, MIN2);
  const r = new Reminders();
  r.start([], 0);
  assert.equal(r.take([], 1000), null, 'nothing pending: nothing');
  assert.equal(r.take([], MIN2 + 1000), null, 'nothing pending, ever: never a reminder');
  assert.equal(r.take(['a'], 10000), 'arrival');
  // Refreshes with the same list never replay the arrival, and nothing comes before 2 minutes.
  for (const at of [11000, 60000, 10000 + MIN2 - 1]) assert.equal(r.take(['a'], at), null, String(at));
  assert.equal(r.take(['a'], 10000 + MIN2), 'reminder');
  assert.equal(r.take(['a'], 10000 + MIN2 + 1000), null, 'once per due time');
  assert.equal(r.take(['a'], 10000 + 2 * MIN2), 'reminder');
  // A second session 1 minute later: an arrival, and the 2 minutes start again from it.
  const second = 10000 + 2 * MIN2 + 60000;
  assert.equal(r.take(['a', 'b'], second), 'arrival');
  assert.equal(r.take(['a', 'b'], 10000 + 3 * MIN2), null, 'the old schedule is gone');
  assert.equal(r.take(['a', 'b'], second + MIN2), 'reminder');
  // One leaves: no arrival, the schedule goes on. Both leave: stopped.
  assert.equal(r.take(['b'], second + MIN2 + 1000), null);
  assert.equal(r.take([], second + MIN2 + 2000), null);
  assert.equal(r.due, null);
  assert.equal(r.take([], second + 5 * MIN2), null, 'empty: no reminder');
  // Coming back after it was empty is a new arrival.
  assert.equal(r.take(['b'], second + 6 * MIN2), 'arrival');
});

test('pending at start: no sound or pulse then, the first reminder 2 minutes later; a long sleep gives one reminder', () => {
  const r = new Reminders();
  assert.equal(r.take(['a'], 5000), null, 'the first look only records');
  assert.equal(r.take(['a'], 5000 + MIN2 - 1), null);
  assert.equal(r.take(['a'], 5000 + MIN2), 'reminder');
  // The computer slept for an hour: one reminder, then the next 2 minutes after it.
  const woke = 5000 + 31 * MIN2 + 17;
  assert.equal(r.take(['a'], woke), 'reminder');
  assert.equal(r.take(['a'], woke + 1000), null);
  assert.equal(r.due, woke + MIN2);
  // start() only sets the baseline once.
  r.start(['x', 'y'], 0); assert.deepEqual([...r.seen], ['a']);
});

test('no reminder while the person looks at every pending session; the next one 2 minutes later', () => {
  const r = new Reminders();
  r.start(['a'], 0);
  let asked = 0; const looking = () => { asked++; return true; };
  assert.equal(r.take(['a'], 1000, looking), null);
  assert.equal(asked, 0, 'looking is asked only when a reminder is due');
  assert.equal(r.take(['a'], MIN2, looking), null);
  assert.equal(asked, 1);
  assert.equal(r.take(['a'], MIN2 + 1000, () => false), null, 'not right after looking away');
  assert.equal(r.take(['a'], 2 * MIN2, () => false), 'reminder');
  // An arrival sounds even while looking, as Herdr's own blocked sound does.
  assert.equal(r.take(['a', 'b'], 2 * MIN2 + 1, looking), 'arrival');
});

test('the looking rule: an active window, and focus on that exact session', () => {
  const on = { active: true }, off = { active: false };
  assert.equal(lookingAt(['t1'], { terminal: 't1' }, on), true);
  assert.equal(lookingAt(['edge/t2'], { terminal: null, shown: 'edge/t2' }, on), true, 'a shown replacement');
  assert.equal(lookingAt(['t3'], { terminal: 'b1', agent: 't3' }, on), true, 'an agent block');
  assert.equal(lookingAt(['t1'], { terminal: 't1' }, off), false, 'another app is in front');
  assert.equal(lookingAt(['t1'], { terminal: 't2' }, on), false);
  assert.equal(lookingAt(['edge/t1'], { terminal: 't1' }, on), false, 'never a bare id for a remote one');
  for (const [focused, win] of [[null, on], [{ terminal: 't1' }, null], [{ terminal: 't1' }, {}], ['t1', on], [{ terminal: '' }, on]])
    assert.equal(lookingAt(['t1', null, ''], focused, win), false, JSON.stringify([focused, win]));
});

test('Sound: three values, Reminders only by default; Herdr\'s sounds switch mutes Roster too', () => {
  assert.equal(soundChoice(null), SOUND.reminders);
  assert.equal(soundChoice('loud'), SOUND.reminders);
  assert.deepEqual([SOUND.off, SOUND.reminders, SOUND.arrival].map(nextSoundChoice), [SOUND.reminders, SOUND.arrival, SOUND.off]);
  const saved = {}, storage = { getItem: k => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } };
  assert.equal(readSound(storage), SOUND.reminders);
  assert.equal(writeSound(storage, SOUND.off), true); assert.equal(saved[SOUND_KEY], 'off'); assert.equal(readSound(storage), SOUND.off);
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readSound(broken), SOUND.reminders); assert.equal(writeSound(broken, SOUND.off), false);
  assert.equal(readSound(null), SOUND.reminders);
  // Who plays what.
  const plays = (event, choice, settings = null) => playsChime(event, choice, settings);
  assert.deepEqual([plays('arrival', 'reminders'), plays('reminder', 'reminders')], [false, true], 'arrival left to Herdr');
  assert.deepEqual([plays('arrival', 'arrival'), plays('reminder', 'arrival')], [true, true]);
  assert.deepEqual([plays('arrival', 'off'), plays('reminder', 'off')], [false, false]);
  assert.equal(plays(null, 'arrival'), false);
  for (const settings of [{ sounds: { enabled: false } }]) {
    assert.equal(herdrMuted(settings), true);
    for (const choice of ['reminders', 'arrival']) for (const event of ['arrival', 'reminder']) assert.equal(plays(event, choice, settings), false);
  }
  for (const settings of [null, {}, { sounds: null }, { sounds: { enabled: true } }, { sounds: { blocked: 'x.mp3' } }, { sounds: { enabled: 'false' } }])
    assert.equal(herdrMuted(settings), false, JSON.stringify(settings));
});

test('the chime is shipped, a small MP3, and is what Roster plays', () => {
  assert.equal(CHIME, 'mods/roster/sounds/chime.mp3');
  const bytes = fs.readFileSync(new URL('../sounds/chime.mp3', import.meta.url));
  assert.ok(bytes.length > 1000 && bytes.length < 64 * 1024, String(bytes.length));
  // An ID3v2 tag, then an MPEG-1 Layer III frame header at the tag's end.
  assert.equal(bytes.subarray(0, 3).toString('latin1'), 'ID3');
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const frame = bytes.subarray(10 + size, 10 + size + 4);
  assert.equal(frame[0], 0xff); assert.equal(frame[1] & 0xfe, 0xfa, 'MPEG-1 Layer III');
  // No personal data in the tag: only the encoder's frames.
  assert.doesNotMatch(bytes.subarray(0, 10 + size).toString('latin1'), /Users|home|@|\\\\/);
});

// The wired view: a local session (t9) needs you from the start; t1 starts needing you later.
function make({ storage = null, settings = null, win = { active: true }, focused = null, play = null } = {}) {
  let clock = 1000;
  const f = fakeHost([terminal('t1', 'working', { created_ms: 110 }), terminal('t9', 'blocked', { created_ms: 90 })]);
  f.host.now = () => clock; f.values.focused = focused;
  const played = [], c = context(), every = [], after = [];
  c.cx.timer.every = (ms, fn) => every.push({ ms, fn }); c.cx.timer.after = (ms, fn) => after.push({ ms, fn });
  const app = { ...appOf(f.host), settings: () => settings, window: () => win };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, initialView: 'status', collapseUnassigned: false, storage, playSound: play ?? (s => played.push(s)) });
  const view = new Type(); view.init({}, c.cx);
  const s = { f, view, ...c, every, after, played, render: () => view.render(c.cx) };
  s.tick = (ms = 1000) => { clock += ms; every[0].fn(c.cx); };
  s.at = ms => { clock = ms; };
  s.clock = () => clock;
  s.set = (address, status) => { f.values.terminals = f.values.terminals.map(t => t.address === address ? { ...t, status } : t); };
  s.bell = () => flatten(view.render(c.cx)).find(e => e.attributes.id?.[0] === 'group-icon:' + JSON.stringify(['attention']));
  return s;
}
const memory = (initial = {}) => { const saved = { ...initial }; return { saved, getItem: k => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } }; };

test('wired: pending at start is silent and still; a reminder pulses and chimes 2 minutes later, again every 2 minutes', () => {
  const s = make(); s.render();
  assert.deepEqual(s.every.map(e => e.ms), [1000], 'still one gentle timer');
  s.tick(); assert.deepEqual(s.played, []); assert.equal(s.stats.notify, 0);
  assert.equal(s.bell().attributes.loop, undefined);
  s.tick(MIN2 - 2000); assert.deepEqual(s.played, [], 'not before 2 minutes');
  s.tick(1000);
  assert.deepEqual(s.played, [CHIME], 'Reminders only: the reminder chimes');
  assert.deepEqual(s.bell().attributes.loop, ['opacity', { from: PULSE.from, to: PULSE.to, period: PULSE.period }]);
  assert.deepEqual(s.after.map(a => a.ms), [PULSE.ms]);
  s.tick(PULSE.ms); s.after[0].fn(s.cx); assert.equal(s.bell().attributes.loop, undefined, 'then still');
  s.tick(MIN2 - PULSE.ms); assert.deepEqual(s.played, [CHIME, CHIME]);
});

test('wired: an arrival pulses (Herdr sounds it by default), resets the 2 minutes, and refreshes never replay it', () => {
  const s = make(); s.render(); s.tick();
  s.tick(60000);
  s.set('t1', 'blocked'); s.render(); s.tick();
  assert.deepEqual(s.played, [], 'Reminders only: the arrival is Herdr\'s blocked sound, not Roster\'s');
  assert.deepEqual(s.bell().attributes.loop?.[0], 'opacity', 'the arrival pulses');
  const arrived = s.clock();
  for (let i = 0; i < 5; i++) { s.render(); s.tick(); }
  assert.equal(s.after.length, 1, 'one pulse for one arrival');
  // t9's old schedule (2 minutes after start) is gone: the next reminder is 2 minutes after the arrival.
  s.tick(arrived + MIN2 - 1000 - s.clock()); assert.deepEqual(s.played, []);
  s.tick(1000); assert.deepEqual(s.played, [CHIME]);
  assert.equal(s.after.length, 2);
  // Arrival and reminders: Roster chimes on arrival too.
  const a = make({ storage: memory({ [SOUND_KEY]: 'arrival' }) }); a.render(); a.tick();
  a.set('t1', 'blocked'); a.render(); a.tick();
  assert.deepEqual(a.played, [CHIME]);
  a.tick(MIN2); assert.deepEqual(a.played, [CHIME, CHIME]);
});

test('wired: Needs you empty stops the reminders, read afresh when one falls due', () => {
  const s = make(); s.render(); s.tick();
  // t9 is answered; Roster has not redrawn since, but the due reminder reads Herdr again.
  s.set('t9', 'idle');
  const before = s.stats.notify;
  s.tick(MIN2);
  assert.deepEqual(s.played, []);
  assert.equal(s.stats.notify, before + 1, 'the fresh read is drawn');
  assert.equal(s.view.needsYou.reminders.due, null);
  s.tick(MIN2); s.tick(MIN2); assert.deepEqual(s.played, []);
  // Nothing pending from the start: nothing at all.
  const q = make(); q.set('t9', 'idle'); q.render(); q.tick(); q.tick(MIN2); q.tick(MIN2);
  assert.deepEqual(q.played, []); assert.equal(q.stats.notify, 0); assert.deepEqual(q.after, []);
});

test('wired: Motion reduced keeps the bell still but the chime plays; Sound off and Herdr\'s sounds off are silent', () => {
  const r = make({ storage: memory({ 'roster.motion': 'reduce' }) }); r.render(); r.tick();
  r.tick(MIN2);
  assert.deepEqual(r.played, [CHIME]);
  assert.equal(r.bell().attributes.loop, undefined); assert.deepEqual(r.after, []);
  for (const options of [{ storage: memory({ [SOUND_KEY]: 'off' }) }, { settings: { sounds: { enabled: false } } },
    { storage: memory({ [SOUND_KEY]: 'arrival' }), settings: { sounds: { enabled: false } } }]) {
    const s = make(options); s.render(); s.tick();
    s.set('t1', 'blocked'); s.render(); s.tick(); s.tick(MIN2); s.tick(MIN2);
    assert.deepEqual(s.played, [], JSON.stringify(options));
    assert.equal(s.after.length, 3, 'the bell still pulses: arrival and two reminders');
  }
  // A playSound that throws stays silent and breaks nothing.
  const t = make({ play: () => { throw Error('no audio device'); } }); t.render(); t.tick();
  assert.doesNotThrow(() => t.tick(MIN2));
  assert.equal(t.after.length, 1, 'the reminder still pulses');
});

test('wired: no reminder while the person looks at the pending session; one once they look away', () => {
  const win = { active: true };
  const s = make({ win, focused: { space: 's', tab: 'x', pane: 'p9', terminal: 't9', shown: null, agent: null, cwd: null } });
  s.render(); s.tick();
  s.tick(MIN2); assert.deepEqual(s.played, []); assert.deepEqual(s.after, [], 'no pulse either');
  // Another app in front: Herdr's window is not active, so they are not looking.
  win.active = false;
  s.tick(MIN2); assert.deepEqual(s.played, [CHIME]);
  // Two pending, looking at one: the other still reminds.
  win.active = true; s.set('t1', 'blocked'); s.render(); s.tick();
  s.tick(MIN2); assert.deepEqual(s.played, [CHIME, CHIME]);
});

test('Options › Sound cycles three values, says when Herdr mutes it, and Motion names the reminder', () => {
  const storage = memory();
  const s = make({ storage }); let tree = s.render();
  const byId = (t, id) => flatten(t).find(e => e.attributes.id?.[0] === id);
  byId(tree, 'tools:toggle').attributes.on_click[0]({}, s.cx); tree = s.render();
  assert.equal(textOf(byId(tree, 'sound:cycle')).trim(), 'Sound: Reminders only');
  assert.match(byId(tree, 'sound:cycle').attributes.tooltip[0], /Herdr announces a new Needs you; Roster chimes every 2 minutes/);
  assert.match(byId(tree, 'motion:toggle').attributes.tooltip[0], /Needs you pulses on arrival and every 2 minutes/);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    byId(tree, 'sound:cycle').attributes.on_click[0]({}, s.cx); tree = s.render();
    seen.push([storage.saved[SOUND_KEY], textOf(byId(tree, 'sound:cycle')).trim()]);
  }
  assert.deepEqual(seen, [['arrival', 'Sound: Arrival and reminders'], ['off', 'Sound: Off'], ['reminders', 'Sound: Reminders only']]);
  assert.match(byId(tree, 'sound:cycle').attributes.tooltip[0], /Next: Arrival and reminders/);
  const m = make({ settings: { sounds: { enabled: false } } }); let mt = m.render();
  byId(mt, 'tools:toggle').attributes.on_click[0]({}, m.cx); mt = m.render();
  assert.equal(textOf(byId(mt, 'sound:cycle')).trim(), 'Sound: Reminders only (muted in Herdr)');
  assert.match(byId(mt, 'sound:cycle').attributes.tooltip[0], /Herdr's sounds are off, so Roster is silent too/);
  assert.deepEqual(m.f.calls, []);
});

test('the shared timer: each event is taken once; an older read never undoes a newer one; idle starts afresh', () => {
  const n = new NeedsYou();
  assert.equal(n.join(['a'], n.read(), 0), 0);
  assert.equal(n.join(['a'], n.read(), 500), 0, 'a second copy joins the running timer');
  const first = n.read(), second = n.read();
  assert.equal(n.take(['a'], second, MIN2), 'reminder');
  assert.equal(n.take(['a'], first, MIN2), null, 'the same reminder, taken by the other copy: nothing');
  assert.equal(n.count, 1);
  // A newer read has b; a copy that has not redrawn still holds the older list without it.
  const stale = n.read(), fresh = n.read();
  assert.equal(n.take(['a', 'b'], fresh, MIN2 + 1000), 'arrival');
  assert.equal(n.take(['a'], stale, MIN2 + 1000), null, 'the older list is ignored');
  assert.equal(n.take(['a', 'b'], fresh, MIN2 + 2000), null, 'so b does not arrive twice');
  assert.equal(n.count, 2);
  // Every copy closed: the next one to join starts silently, and the count never goes back.
  assert.equal(n.join(['a', 'b', 'c'], n.read(), MIN2 + 2000 + IDLE_MS + 1), 2);
  assert.equal(n.take(['a', 'b', 'c'], n.read(), MIN2 + 2000 + IDLE_MS + 2), null, 'c was pending at that start');
});

// Copies of one Roster class, as Herdr makes them from one mod context: one host, one clock.
function copies({ storage = null, settings = null } = {}) {
  let clock = 1000;
  const f = fakeHost([terminal('t1', 'working', { created_ms: 110 }), terminal('t9', 'blocked', { created_ms: 90 })]);
  f.host.now = () => clock; f.values.focused = null;
  const played = [];
  const app = { ...appOf(f.host), settings: () => settings, window: () => ({ active: true }) };
  const Type = createRosterView(kit, app, { host: f.host, layoutHost: layoutHostUnused, initialView: 'status', collapseUnassigned: false, storage, playSound: s => played.push(s) });
  const open = [];
  const s = { f, played, open };
  s.add = () => {
    const c = context(), every = [], after = [];
    c.cx.timer.every = (ms, fn) => every.push({ ms, fn }); c.cx.timer.after = (ms, fn) => after.push({ ms, fn });
    const view = new Type(); view.init({}, c.cx);
    const copy = { view, ...c, every, after, render: () => view.render(c.cx) };
    copy.bell = () => flatten(view.render(c.cx)).find(e => e.attributes.id?.[0] === 'group-icon:' + JSON.stringify(['attention']));
    open.push(copy); return copy;
  };
  s.close = copy => { open.splice(open.indexOf(copy), 1); };
  // Herdr redraws every open copy when its data changes, then each copy's timer ticks.
  s.render = () => open.forEach(copy => copy.render());
  s.tick = (ms = 1000) => { clock += ms; for (const copy of open) copy.every[0].fn(copy.cx); };
  s.set = (address, status) => { f.values.terminals = f.values.terminals.map(t => t.address === address ? { ...t, status } : t); };
  return s;
}

test('two copies, default Sound: the reminder chimes once, and both bells pulse', () => {
  const s = copies(); const a = s.add(), b = s.add(); s.render(); s.tick();
  s.tick(MIN2 - 1000);
  assert.deepEqual(s.played, [CHIME], 'one chime for one reminder');
  for (const copy of [a, b]) {
    assert.deepEqual(copy.after.map(x => x.ms), [PULSE.ms], 'each copy pulses its own bell');
    assert.deepEqual(copy.bell().attributes.loop?.[0], 'opacity');
  }
  s.tick(MIN2); assert.deepEqual(s.played, [CHIME, CHIME], 'the next reminder, once');
  // Either copy may tick first: still one.
  s.open.reverse(); s.tick(MIN2); assert.deepEqual(s.played, [CHIME, CHIME, CHIME]);
});

test('two copies, Arrival and reminders: one chime on arrival and one per reminder', () => {
  const s = copies({ storage: memory({ [SOUND_KEY]: 'arrival' }) }); const a = s.add(), b = s.add(); s.render(); s.tick();
  s.set('t1', 'blocked'); s.render(); s.tick();
  assert.deepEqual(s.played, [CHIME], 'one arrival, one chime');
  assert.deepEqual([a.after.length, b.after.length], [1, 1], 'both bells pulse for it');
  for (let i = 0; i < 5; i++) { s.render(); s.tick(); }
  assert.deepEqual(s.played, [CHIME], 'refreshes never replay it');
  s.tick(MIN2 - 5000); assert.deepEqual(s.played, [CHIME, CHIME], 'one chime for the reminder');
  assert.deepEqual([a.after.length, b.after.length], [2, 2]);
});

test('a copy that closes takes nothing with it; one opened later never replays a sound', () => {
  const s = copies({ storage: memory({ [SOUND_KEY]: 'arrival' }) }); const a = s.add(), b = s.add(); s.render(); s.tick();
  s.set('t1', 'blocked'); s.render(); s.tick();
  assert.deepEqual(s.played, [CHIME]);
  // The copy whose tick took the arrival goes; the other still sounds the reminder.
  s.close(a);
  s.tick(MIN2); assert.deepEqual(s.played, [CHIME, CHIME], 'the reminder still sounds, once');
  // A copy opened later: no replay of the arrival or reminder; it pulses with the next one.
  const c = s.add(); c.render(); s.tick();
  assert.deepEqual(s.played, [CHIME, CHIME]); assert.equal(c.after.length, 0);
  s.tick(MIN2 - 1000); assert.deepEqual(s.played, [CHIME, CHIME, CHIME]);
  assert.deepEqual([b.after.length, c.after.length], [3, 1]);
  // b has not redrawn since t1 came back, so it holds an older list without t1: that list
  // never makes t1 leave and arrive again.
  s.set('t1', 'idle'); s.render(); s.tick();
  s.set('t1', 'blocked'); c.render(); s.tick();
  assert.equal(s.played.length, 4, 'the second arrival, once');
  for (let i = 0; i < 3; i++) s.tick();
  assert.equal(s.played.length, 4, 'b holds the older list: no second arrival');
  // All copies closed; t1 comes back while none is open; the next copy starts silently.
  s.set('t1', 'idle'); s.render(); s.tick();
  s.close(b); s.close(c);
  s.tick(IDLE_MS + 1);
  s.set('t1', 'blocked');
  const d = s.add(); d.render(); s.tick(); s.tick();
  assert.equal(s.played.length, 4, 'pending at start: silent'); assert.equal(d.after.length, 0);
  s.tick(MIN2); assert.equal(s.played.length, 5, 'then its reminders');
});
