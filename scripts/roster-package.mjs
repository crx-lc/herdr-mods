#!/usr/bin/env node
// Read-only, repository-only inventory. Never import or execute the mod or sync.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Deliberate shipping allowlist: additions require review here, not a broad extension glob.
export const SHIPPING = Object.freeze([
  'MODULES.md', 'README.md', 'attention.js', 'controller.js', 'delegations.js',
  'desktop.js', 'feed.js', 'icons.js', 'identity.js', 'layout.js', 'local-reader.js',
  'main.js', 'metadata.js', 'mod.json', 'navigation-rows.js', 'navigation.js',
  'normalize.js', 'projection.js', 'settings.js', 'view.js',
].sort());
const omitted = new Set(['.tests', '.cache', '.backups', 'gpui-kit.d.ts', 'herdr.d.ts', 'jsconfig.json']);
const native = new Set(['herdr', 'gpui-kit', 'gpui-base']);
const parser = `import { SourceTextModule } from 'node:vm';
import fs from 'node:fs';
const sources = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(sources.map(source => new SourceTextModule(source).dependencySpecifiers)));`;

// Bounded parser process; validate its response before treating it as a dependency list.
export function parseRequests(sources, run = spawnSync) {
  const parsed = run(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', parser],
    { input: JSON.stringify(sources), encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  if (!parsed || parsed.error || parsed.status !== 0) throw Error('module parse failed');
  let requests;
  try { requests = JSON.parse(parsed.stdout); } catch { throw Error('invalid parser response'); }
  if (!Array.isArray(requests) || requests.length !== sources.length
    || requests.some(refs => !Array.isArray(refs) || refs.some(ref => typeof ref !== 'string')))
    throw Error('invalid parser response');
  return requests;
}

export function inventory(root) {
  root = path.resolve(root);
  // The package itself must be a real directory. Ancestors may be ordinary
  // directory links (for example macOS /var); establish a canonical traversal root.
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw Error('symlink package root');
  if (!stat.isDirectory()) throw Error('package root is not a directory');
  root = fs.realpathSync(root);
  const files = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const rel = prefix + entry.name;
      // Links are errors even when their name would otherwise be excluded. Never follow them.
      if (entry.isSymbolicLink()) throw Error(`symlink: ${rel}`);
      if (omitted.has(entry.name)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else if (entry.isFile() && SHIPPING.includes(rel)) files.push(rel);
      else throw Error(`nonshipping file: ${rel}`);
    }
  }
  walk(root);
  files.sort();
  for (const file of SHIPPING) if (!files.includes(file)) throw Error(`missing shipping file: ${file}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mod.json'), 'utf8'));
  if (manifest.place !== 'none' || manifest.focusable !== true) throw Error('unexpected Roster manifest');
  const modules = files.filter(f => f.endsWith('.js'));
  const sources = modules.map(f => fs.readFileSync(path.join(root, f), 'utf8'));
  // Conservative source policy: current package has only eager imports and no image assets.
  // icons.js has an audited local svg(bytes) validator, not a renderer.
  // Comments can cause refusals; do not evaluate code to discover references.
  for (let i = 0; i < sources.length; i++) {
    if (/\bimport\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*\(/.test(sources[i])
      || /\b(?:require|image)\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*\(/.test(sources[i])
      || (modules[i] !== 'icons.js' && /\bsvg\s*\(/.test(sources[i])))
      throw Error(`unsupported dynamic import or asset reference: ${modules[i]}`);
  }
  // V8 parses actual static dependencies (including re-exports and escaped specifiers).
  // No linking/evaluation, Herdr calls, network, environment lookup or home reads.
  const requests = parseRequests(sources);
  for (let i = 0; i < modules.length; i++) for (const ref of requests[i]) {
    if (native.has(ref)) continue;
    // No absolute, URL, backslash, query, encoded or parent traversal imports.
    if (!ref.startsWith('./') || /[\\%?#\x00-\x1f]/.test(ref) || ref.split('/').includes('..'))
      throw Error(`external or escaping import: ${modules[i]} -> ${ref}`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(modules[i]), ref));
    if (!files.includes(target) || !target.endsWith('.js')) throw Error(`missing packaged import: ${modules[i]} -> ${ref}`);
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw Error('usage: node scripts/roster-package.mjs (no destination or live-home options)');
    const root = fileURLToPath(new URL('../roster/mods/roster/', import.meta.url));
    const files = inventory(root);
    console.log(files.map(f => `roster/mods/roster/${f}`).join('\n'));
    console.error(`Validated ${files.length} shipping files; inventory only, nothing copied.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
