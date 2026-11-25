import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inventory, SHIPPING, parseRequests } from './roster-package.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [...SHIPPING].reverse()) fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }), fs.writeFileSync(path.join(root, file), file.endsWith('.js') ? 'export const sample = 1;' : 'neutral sample');
  fs.writeFileSync(path.join(root, 'mod.json'), JSON.stringify({ place: 'none', focusable: true }));
  return root;
}
const write = (root, file, text = 'neutral sample') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };

test('inventory is deterministic, excludes development/runtime files, and does not mutate files', t => {
  const root = fixture(t);
  for (const file of ['.tests/sample.test.mjs', '.cache/private.json', '.backups/old.js', 'gpui-kit.d.ts', 'herdr.d.ts', 'jsconfig.json']) write(root, file);
  const before = fs.readFileSync(path.join(root, 'main.js'));
  assert.equal(SHIPPING.length, 55);
  assert.deepEqual(inventory(root), SHIPPING);
  assert.deepEqual(inventory(root), SHIPPING);
  assert.deepEqual(fs.readFileSync(path.join(root, 'main.js')), before);
});
test('missing module and forbidden private/unknown files fail rather than quietly ship', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'feed.js'));
  assert.throws(() => inventory(root), /missing shipping file/);
  write(root, 'feed.js', 'export {};');
  for (const file of ['settings.json', '.env', 'data/private.json', 'node_modules/sample.js', 'preview.png']) {
    write(root, file);
    assert.throws(() => inventory(root), /nonshipping file/);
    fs.unlinkSync(path.join(root, file));
  }
});
test('links and linked roots are rejected without reading targets', t => {
  const root = fixture(t), outside = fixture(t);
  fs.symlinkSync(outside, path.join(root, '.cache'), 'junction');
  assert.throws(() => inventory(root), /symlink/);
  assert.throws(() => inventory(path.join(root, '.cache')), /symlink/);
});
test('real package behind a linked parent is accepted, but linked root and included paths fail', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-package-parent-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'real', 'roster');
  fs.mkdirSync(path.dirname(root));
  fs.cpSync(new URL('../roster/mods/roster/', import.meta.url), root, { recursive: true });
  const linkedParent = path.join(parent, 'alias');
  fs.symlinkSync(path.dirname(root), linkedParent, 'junction');
  const throughParent = path.join(linkedParent, 'roster');
  assert.deepEqual(inventory(throughParent), SHIPPING);
  const linkedRoot = path.join(parent, 'linked-root');
  fs.symlinkSync(root, linkedRoot, 'junction');
  assert.throws(() => inventory(linkedRoot), /symlink/);
  // Link in an included traversal path; directory junction works on Windows
  // without requiring permission to create file symlinks.
  fs.symlinkSync(path.dirname(root), path.join(root, 'included-link'), 'junction');
  assert.throws(() => inventory(throughParent), /symlink/);
  fs.unlinkSync(path.join(root, 'included-link'));
  assert.deepEqual(inventory(throughParent), SHIPPING);
});
test('real parser catches escaped imports and re-exports, missing and excluded references', t => {
  const root = fixture(t);
  for (const ref of ['../other.js', '/tmp/sample.js', 'https://example.invalid/mod.js', 'node:fs', './absent.js', './.cache/secret.js', './gpui-kit.d.ts', './nested/../../feed.js', './feed.js?x', './%2e%2e/private.js']) {
    write(root, 'main.js', `export * from ${JSON.stringify(ref)};`);
    assert.throws(() => inventory(root), /import/);
  }
  write(root, 'main.js', String.raw`import './\u002e\u002e/private.js';`);
  assert.throws(() => inventory(root), /import/);
  write(root, 'main.js', "import { sample } from './feed.js'; export { sample }; import 'herdr'; import 'gpui-kit';");
  assert.deepEqual(inventory(root), SHIPPING);
});
test('dynamic imports, assets and malformed syntax fail closed without executing mod code', t => {
  const root = fixture(t);
  for (const source of ["import /* gap */ ('../private.js')", "image('../private.png')", "svg(variable)", "require('./feed.js')", 'export const = ;']) {
    write(root, 'main.js', source);
    assert.throws(() => inventory(root), /unsupported|parse failed/);
  }
  write(root, 'main.js', "throw Error('must never execute'); import './feed.js';");
  assert.deepEqual(inventory(root), SHIPPING);
});
test('manifest drift cannot activate the package by default', t => {
  const root = fixture(t);
  write(root, 'mod.json', '{"place":"left","focusable":true}');
  assert.throws(() => inventory(root), /manifest/);
});

test('parser subprocess failures, silence, timeouts and malformed responses cannot validate a package', () => {
  for (const answer of [null, {status: 1, stdout: '[]'}, {status: null, error: Object.assign(Error('timeout'), {code: 'ETIMEDOUT'})},
    {status: 0, stdout: ''}, {status: 0, stdout: 'broken'}, {status: 0, stdout: '{}'},
    {status: 0, stdout: '[]'}, {status: 0, stdout: '[[null]]'}]) {
    assert.throws(() => parseRequests(['export {};'], () => answer), /parse|parser/);
  }
  let observed;
  assert.deepEqual(parseRequests(['export {};'], (_cmd, _args, options) => {
    observed = options;
    return {status: 0, stdout: '[[]]'};
  }), [[]]);
  assert.ok(observed.timeout > 0 && observed.timeout <= 10000);
  assert.ok(observed.maxBuffer > 0 && observed.maxBuffer <= 4 * 1024 * 1024);
});

test('view.js may draw icons only through its five exact helpers; any other svg or image reference fails', t => {
  const helper = "const icon = (name, size) => svg('mods/roster/icons/' + name + '.svg').size(size);\n"
    + "const picture = (name, size) => image('mods/roster/icons/' + name + '.svg');\n"
    + "const herdrGlyph = (name, size) => svg('icons/' + name + '.svg');\n"
    + "const herdrPicture = (name, size) => image('icons/' + name + '.svg');\n"
    + "const projectPicture = (sha, size) => image('mods/roster/.cache/icons/' + sha + '.svg');\nexport const sample = 1;";
  const root = fixture(t); write(root, 'view.js', helper);
  assert.deepEqual(inventory(root), SHIPPING);
  for (const [file, text] of [['view.js', helper + "\nsvg('mods/other/x.svg');"], ['view.js', "svg('mods/roster/icons/monitor.svg');"],
    ['view.js', helper + "\nimage('mods/roster/icons/plus.svg');"], ['detail.js', helper],
    ['view.js', helper + "\nimage('icons/' + path + '.svg');"], ['view.js', helper + "\nimage(program.icon);"],
    ['view.js', helper + "\nsvg('../icons/' + name + '.svg');"], ['spaces.js', "image('icons/' + name + '.svg');"],
    // Only the cache's icons folder, by sha: no other cached file, and no other module draws one.
    ['view.js', helper + "\nimage('mods/roster/.cache/' + name + '.svg');"], ['view.js', helper + "\nimage('mods/roster/.cache/icons/' + sha + '.png');"],
    ['catalog-source.js', "image('mods/roster/.cache/icons/' + sha + '.svg');"]]) {
    const bad = fixture(t); write(bad, file, text);
    assert.throws(() => inventory(bad), /unsupported dynamic import or asset reference/, file + ': ' + text.slice(-40));
  }
  const stray = fixture(t); write(stray, 'icons/extra.svg');
  assert.throws(() => inventory(stray), /nonshipping file: icons\/extra\.svg/);
});
