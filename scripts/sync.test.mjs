// Tests for scripts/sync.mjs: what it compares, copies and leaves alone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compare, copyOver, listFiles, liveHome } from "./sync.mjs";

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
