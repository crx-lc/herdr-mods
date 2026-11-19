import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readSettings, setProjectIcon, parseSettings } from '../settings.js';
import { validateIcon, iconDescriptor } from '../icons.js';
const config = () => ({version:1, projects:[{id:'project-a',displayName:'Sample'}], projectBindings:[{coreId:'core-a',token:'sample',projectId:'project-a'},{coreId:'core-b',token:'sample',projectId:'project-a'}], contexts:[],processProviders:[],projectProviders:[],icons:[]});
const svg = s => new TextEncoder().encode(s);
const goodSvg = svg('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="0" y="0" width="20" height="20" fill="#123456"/></svg>');
function chunk(type, data) {
  const t = Buffer.from(type); let crc = 0xffffffff;
  for (const byte of Buffer.concat([t,data])) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  const length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length,t,data,sum]);
}
const ihdr = Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0]);
const png = new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))), chunk('IEND',Buffer.alloc(0))]));
function host(initial = JSON.stringify(config())) {
  let value = initial;
  return { deadline: p => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), 15))]), readSettings: async () => value,
    compareAndSwapSettings: async (expected, next) => { if (value !== expected) return 'conflict'; value = next; return 'ok'; },
    change: x => { value = x; }, value: () => value };
}
test('assign, rename, two cores and clear preserve identity and mappings', async () => {
  const h = host(); await setProjectIcon(h, 'project-a', 'sample.svg');
  const c = JSON.parse(h.value()); c.projects[0].displayName = 'Renamed'; h.change(JSON.stringify(c));
  const r = await readSettings(h); assert.equal(r.config.icons[0].projectId, 'project-a'); assert.equal(r.config.projectBindings.length, 2);
  await setProjectIcon(h, 'project-a', null); assert.deepEqual(JSON.parse(h.value()).icons, []);
});
test('unknown projects and unsafe assets cannot be assigned', async () => {
  const h = host(); for (const name of ['../x.svg','https://x.svg','a\\b.png','a/evil.svg']) await assert.rejects(setProjectIcon(h,'project-a',name));
  await assert.rejects(setProjectIcon(h,'unknown','x.svg'), /unknown-project/);
});
test('malformed and unsupported configuration is never overwritten', async () => {
  for (const raw of ['{', '{}', JSON.stringify({...config(), version:2}), JSON.stringify({...config(), icons:[{projectId:'missing',asset:'a.svg'}]})]) {
    const h = host(raw); await assert.rejects(setProjectIcon(h,'project-a','a.svg')); assert.equal(h.value(),raw);
  }
  assert.equal(parseSettings(null).version,1);
});
test('atomic conflicts preserve concurrent data and failures are explicit', async () => {
  const h = host(); h.compareAndSwapSettings = async () => { h.change('newer'); return 'conflict'; };
  await assert.rejects(setProjectIcon(h,'project-a','a.svg'), /conflict/); assert.equal(h.value(),'newer');
  h.change(JSON.stringify(config())); h.compareAndSwapSettings = async () => 'error'; await assert.rejects(setProjectIcon(h,'project-a','a.svg'), /write-failure/);
  h.compareAndSwapSettings = async () => { throw Error('disk'); }; await assert.rejects(setProjectIcon(h,'project-a','a.svg'), /host-failure/);
});
test('hung, missing, malformed and rejected host answers are bounded', async () => {
  for (const read of [() => new Promise(() => {}), () => undefined, () => { throw Error('disk'); }]) { const h = host(); h.readSettings = read; await assert.rejects(readSettings(h)); }
  const h = host(); h.compareAndSwapSettings = () => new Promise(() => {}); await assert.rejects(setProjectIcon(h,'project-a','a.svg'));
});
test('static SVG subset rejects active, external, malformed and oversized content', () => {
  assert.equal(validateIcon(goodSvg,'x.svg'),true);
  for (const s of ['<svg><script/></svg>','<svg><image href="https://example.test/a"/></svg>','<svg onload="x"/>','<!DOCTYPE svg><svg/>','<svg><path fill="url(#x)"/></svg>','<svg><g></svg>','<svg width="1025"/>','<svg><foreignObject/></svg>']) assert.equal(validateIcon(svg(s),'x.svg'),false,s);
  assert.equal(validateIcon(new Uint8Array(262145),'x.svg'),false);
});
test('PNG requires bounded structurally valid chunks, dimensions and CRC', () => {
  assert.equal(validateIcon(png,'x.png'),true);
  // A corrupt CRC or signature is never accepted; native decode remains unverified.
  assert.equal(validateIcon(png.slice(0,8),'x.png'),false);
  const corrupt = png.slice(); corrupt[20] ^= 1; assert.equal(validateIcon(corrupt,'x.png'),false);
  assert.equal(validateIcon(new Uint8Array(262145),'x.png'),false);
});
test('fallback survives absent, deleted, unreadable and invalid icons', async () => {
  const project = {id:'project-a',displayName:'Sample'}, c = config(); c.icons = [{projectId:'project-a',asset:'a.svg'}];
  for (const readIcon of [async () => null, async () => { throw Error('missing'); }, async () => ({path:'local',bytes:svg('<svg onload="x"/>')}), () => new Promise(() => {})]) {
    const d = await iconDescriptor({...host(),readIcon},project,c); assert.equal(d.name,'Sample'); assert.equal(d.monogram,'S'); assert.equal(d.image,null);
  }
  const d = await iconDescriptor({...host(),readIcon:async () => ({path:'private-path',bytes:goodSvg})},project,c); assert.equal(d.image.format,'svg'); assert.equal(d.name,'Sample'); assert.equal(d.monogram,'S');
  assert.equal((await iconDescriptor(host(),project,config())).image,null);
});
