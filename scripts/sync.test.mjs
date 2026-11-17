// Tests for scripts/sync.mjs: what it compares, copies and leaves alone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compare, copyOver, listFiles, liveHome, run } from "./sync.mjs";

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mods-sync-"));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

test("Herdr's runtime files and the cache are never listed", () => {
  const d = tree({ "main.js": "a", "gpui-kit.d.ts": "x", "jsconfig.json": "{}", ".cache/logos/index.json": "{}", ".tests/a.test.mjs": "t", "assets/b.svg": "<svg/>" });
  assert.deepEqual(listFiles(d), [".tests/a.test.mjs", "assets/b.svg", "main.js"]);
});

test("compare: changed, one-sided and equal files", () => {
  const repo = tree({ "main.js": "new", "same.js": "s", "added.js": "a" });
  const live = tree({ "main.js": "old", "same.js": "s", "local.js": "l", ".cache/x": "c" });
  assert.deepEqual(compare(repo, live), { changed: ["main.js"], onlyFrom: ["added.js"], onlyTo: ["local.js"], same: ["same.js"] });
});

test("copy writes only what it is given and deletes nothing", () => {
  const repo = tree({ "main.js": "new", "added/deep.js": "a" });
  const live = tree({ "main.js": "old", "local.js": "l" });
  copyOver(repo, live, ["main.js", "added/deep.js"]);
  assert.equal(fs.readFileSync(path.join(live, "main.js"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(live, "added/deep.js"), "utf8"), "a");
  assert.equal(fs.readFileSync(path.join(live, "local.js"), "utf8"), "l", "the live-only file stays");
});

test("the live home follows HERDR_APP_HOME, else ~/.config/herdr-app", () => {
  assert.equal(liveHome({ HERDR_APP_HOME: "/x/home" }), "/x/home");
  assert.equal(liveHome({}), path.join(os.homedir(), ".config", "herdr-app"));
});

// --- run(): the commands end to end, on temporary folders ---
function setup(repoFiles, liveFiles) {
  const out = [];
  const base = {
    mod: "demo", repoDir: tree(repoFiles),
    liveDir: liveFiles ? tree(liveFiles) : path.join(os.tmpdir(), `herdr-mods-missing-${process.pid}-${Math.random().toString(36).slice(2)}`),
    backupRoot: fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mods-backup-")),
    log: (line) => out.push(line), fail: (line) => out.push(`ERR ${line}`), now: new Date("2026-11-17T19:00:05Z"),
  };
  return { base, out, read: (dir, f) => fs.readFileSync(path.join(dir, f), "utf8"), has: (dir, f) => fs.existsSync(path.join(dir, f)) };
}
const BACKUP = "demo-install-20261117-190005";

test("an unknown command or a bad mod name fails before anything is printed or touched", () => {
  const s = setup({ "main.js": "new" }, { "main.js": "old" });
  assert.equal(run({ ...s.base, command: "bogus" }), 2);
  assert.equal(s.out.length, 1);
  assert.match(s.out[0], /^ERR unknown command: bogus/);
  assert.equal(run({ ...s.base, command: "install", mod: "../x" }), 2);
  assert.equal(s.read(s.base.liveDir, "main.js"), "old");
});

test("status changes nothing and makes no backup", () => {
  const s = setup({ "main.js": "new" }, { "main.js": "old", "local.js": "l" });
  assert.equal(run({ ...s.base, command: "status" }), 0);
  assert.equal(s.read(s.base.liveDir, "main.js"), "old");
  assert.deepEqual(fs.readdirSync(s.base.backupRoot), []);
});

test("install backs up what it overwrites and leaves live-only files, saying so", () => {
  const s = setup({ "main.js": "new", "added.js": "a" }, { "main.js": "old", "old/gone.js": "g", ".cache/x": "c", "gpui-kit.d.ts": "t" });
  assert.equal(run({ ...s.base, command: "install" }), 0);
  assert.equal(s.read(s.base.liveDir, "main.js"), "new");
  assert.equal(s.read(s.base.liveDir, "added.js"), "a");
  assert.equal(s.read(s.base.liveDir, "old/gone.js"), "g", "left alone without --prune");
  const backup = path.join(s.base.backupRoot, BACKUP);
  assert.equal(s.read(backup, "main.js"), "old");
  assert.deepEqual(listFiles(backup), ["main.js"], "only what was overwritten");
  assert.ok(s.out.some((l) => /1 file\(s\) exist only live .* --prune/.test(l)));
});

test("install --prune removes live-only files after backing them up; runtime files stay", () => {
  const s = setup({ "main.js": "same" }, { "main.js": "same", "old/gone.js": "g", ".cache/x": "c", "gpui-kit.d.ts": "t", "jsconfig.json": "{}" });
  assert.equal(run({ ...s.base, command: "install", prune: true }), 0);
  assert.equal(s.has(s.base.liveDir, "old/gone.js"), false);
  assert.equal(s.has(s.base.liveDir, "old"), false, "the emptied folder goes too");
  for (const kept of [".cache/x", "gpui-kit.d.ts", "jsconfig.json", "main.js"]) assert.equal(s.has(s.base.liveDir, kept), true, kept);
  assert.equal(s.read(path.join(s.base.backupRoot, BACKUP), "old/gone.js"), "g");
});

test("install into a Herdr home without the mod creates it; nothing to back up", () => {
  const s = setup({ "main.js": "new", ".tests/a.test.mjs": "t" }, null);
  assert.equal(run({ ...s.base, command: "install" }), 0);
  assert.equal(s.read(s.base.liveDir, ".tests/a.test.mjs"), "t");
  assert.deepEqual(fs.readdirSync(s.base.backupRoot), []);
});

test("pull brings live changes back, backing up the repo's versions; refuses when not installed", () => {
  const s = setup({ "main.js": "repo", "repo-only.js": "r" }, { "main.js": "live", "new.js": "n" });
  assert.equal(run({ ...s.base, command: "pull" }), 0);
  assert.equal(s.read(s.base.repoDir, "main.js"), "live");
  assert.equal(s.read(s.base.repoDir, "new.js"), "n");
  assert.equal(s.read(s.base.repoDir, "repo-only.js"), "r");
  assert.equal(s.read(path.join(s.base.backupRoot, "demo-pull-20261117-190005"), "main.js"), "repo");
  const none = setup({ "main.js": "repo" }, null);
  assert.equal(run({ ...none.base, command: "pull" }), 2);
});

// --- scripts/typecheck.mjs: which TypeScript diagnostics count ---
import { realErrors } from "./typecheck.mjs";

test("typecheck keeps real mistakes and drops what is noise in plain JavaScript", () => {
  const output = [
    "marketclock.js(54,5): error TS1117: An object literal cannot have multiple properties with the same name.",
    "dialog.js(12,3): error TS2304: Cannot find name 'SESSION_LABELS'.",
    "main.js(9,10): error TS2305: Module '\"./quotes.js\"' has no exported member 'formatPrize'.",
    "main.js(40,7): error TS7006: Parameter 'cx' implicitly has an 'any' type.",
    "clockview.js(67,33): error TS2345: Argument of type 'string' is not assignable to parameter of type '`#${string}`'.",
    "main.js(165,35): error TS2339: Property 'assetIcon' does not exist on type 'Quotr'.",
    "",
  ].join("\n");
  assert.deepEqual(realErrors(output).map((l) => /TS\d+/.exec(l)[0]), ["TS1117", "TS2304", "TS2305"]);
  assert.deepEqual(realErrors(""), []);
});
