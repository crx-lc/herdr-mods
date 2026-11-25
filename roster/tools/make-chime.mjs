#!/usr/bin/env node
// Writes the PCM source of Roster's Needs you chime from nothing but arithmetic: two sine notes
// with a soft overtone and an exponential decay. make-chime.ps1 encodes it to
// mods/roster/sounds/chime.mp3 with the MP3 encoder built into Windows (Media Foundation).
//
//   node roster/tools/make-chime.mjs <out.wav>
//   powershell -NoProfile -File roster/tools/make-chime.ps1 <out.wav> roster/mods/roster/sounds/chime.mp3
//
// The WAV is the same bytes every time (its SHA-256 is printed); the MP3 depends on the Windows
// encoder's version.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const RATE = 44100, SECONDS = 0.9;
const PEAK = 0.2;
// A5 then E6, 120 ms apart: a rising fifth, short and quiet.
const NOTES = [{ hz: 880, at: 0, decay: 5.5 }, { hz: 1318.51, at: 0.12, decay: 6.5 }];
export function chimeSamples() {
  const n = Math.round(RATE * SECONDS), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const note of NOTES) {
      const u = t - note.at;
      if (u < 0) continue;
      const env = Math.min(1, u / 0.006) * Math.exp(-note.decay * u);
      v += env * (Math.sin(2 * Math.PI * note.hz * u) + 0.18 * Math.sin(2 * Math.PI * 2 * note.hz * u));
    }
    const tail = Math.min(1, (SECONDS - t) / 0.08); // the last 80 ms fade to silence
    pcm[i] = Math.round(Math.max(-1, Math.min(1, v * PEAK * tail)) * 32767);
  }
  return pcm;
}
export function wav(pcm) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const out = process.argv[2];
if (out) {
  const bytes = wav(chimeSamples());
  fs.writeFileSync(out, bytes);
  console.log(`${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
