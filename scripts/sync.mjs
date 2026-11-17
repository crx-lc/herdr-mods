#!/usr/bin/env node
// Compare or copy one mod between this repository and the live Herdr app.
//
//   node scripts/sync.mjs status  <mod>   what differs (default; changes nothing)
//   node scripts/sync.mjs install <mod>   repo → live: copy new and changed files
//   node scripts/sync.mjs pull    <mod>   live → repo: copy new and changed files
//
// Repo side: <repo>/<mod>/mods/<mod>/. Live side: $HERDR_APP_HOME/mods/<mod>/, else
// ~/.config/herdr-app/mods/<mod>/ (Herdr's home on every platform).
// Never deletes anything: files present on only one side are listed for you to handle.
// Never copies Herdr's runtime files (gpui-kit.d.ts, jsconfig.json, .cache/).
// Herdr reloads a mod whenever a non-hidden file in its folder is saved, so `install` takes effect at once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const IGNORED = new Set(["gpui-kit.d.ts", "jsconfig.json", ".cache"]);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function liveHome(env = process.env) {
  return env.HERDR_APP_HOME || path.join(os.homedir(), ".config", "herdr-app");
}

/** Relative paths of the files under `dir`, skipping Herdr's runtime files at the top level. */
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (!rel && IGNORED.has(entry.name)) continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(r);
      else if (entry.isFile()) out.push(r);
    }
  };
  if (fs.existsSync(dir)) walk("");
  return out.sort();
}

const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** { changed, onlyFrom, onlyTo, same } between two folders. */
export function compare(from, to) {
  const a = new Set(listFiles(from));
  const b = new Set(listFiles(to));
  const result = { changed: [], onlyFrom: [], onlyTo: [], same: [] };
  for (const f of a) {
    if (!b.has(f)) result.onlyFrom.push(f);
    else (hash(path.join(from, f)) === hash(path.join(to, f)) ? result.same : result.changed).push(f);
  }
  for (const f of b) if (!a.has(f)) result.onlyTo.push(f);
  return result;
}

export function copyOver(from, to, files) {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
}

function main(argv) {
  const [command = "status", mod] = argv;
  if (!mod || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(mod)) {
    console.error("usage: node scripts/sync.mjs status|install|pull <mod>");
    return 2;
  }
  const repoDir = path.join(REPO, mod, "mods", mod);
  const liveDir = path.join(liveHome(), "mods", mod);
  if (!fs.existsSync(repoDir)) { console.error(`no such mod in this repo: ${repoDir}`); return 2; }
  const live = fs.existsSync(liveDir);
  const diff = compare(repoDir, liveDir);
  console.log(`repo: ${repoDir}\nlive: ${liveDir}${live ? "" : " (not installed)"}`);
  console.log(`same ${diff.same.length}, changed ${diff.changed.length}, only in repo ${diff.onlyFrom.length}, only live ${diff.onlyTo.length}`);
  for (const f of diff.changed) console.log(`  changed    ${f}`);
  for (const f of diff.onlyFrom) console.log(`  repo only  ${f}`);
  for (const f of diff.onlyTo) console.log(`  live only  ${f}`);
  if (command === "status") return 0;
  if (command === "install") {
    copyOver(repoDir, liveDir, [...diff.changed, ...diff.onlyFrom]);
    console.log(`installed ${diff.changed.length + diff.onlyFrom.length} file(s); nothing deleted`);
    return 0;
  }
  if (command === "pull") {
    if (!live) { console.error("not installed: nothing to pull"); return 2; }
    copyOver(liveDir, repoDir, [...diff.changed, ...diff.onlyTo]);
    console.log(`pulled ${diff.changed.length + diff.onlyTo.length} file(s); nothing deleted`);
    return 0;
  }
  console.error(`unknown command: ${command}`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
