#!/usr/bin/env node
// Compare or copy one mod between this repository and the live Herdr app.
//
//   node scripts/sync.mjs status  <mod>            what differs (default; changes nothing)
//   node scripts/sync.mjs install <mod> [--prune]  repo → live: copy new and changed files
//   node scripts/sync.mjs pull    <mod> [--prune]  live → repo: copy new and changed files
//
// Repo side: <repo>/<mod>/mods/<mod>/. Live side: $HERDR_APP_HOME/mods/<mod>/, else
// ~/.config/herdr-app/mods/<mod>/ (Herdr's home on every platform).
// Files that exist only at the destination are listed and left alone, unless --prune is given.
// Every file overwritten or pruned is first copied to .backups/<mod>-<command>-<time>/ in this
// repo (ignored by git), or under $HERDR_MODS_BACKUPS.
// Never touches Herdr's runtime files (gpui-kit.d.ts, jsconfig.json, .cache/) on either side.
// Herdr reloads a mod whenever a non-hidden file in its folder is saved, so `install` takes effect at once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const IGNORED = new Set(["gpui-kit.d.ts", "jsconfig.json", ".cache"]);
export const COMMANDS = ["status", "install", "pull"];
const USAGE = "usage: node scripts/sync.mjs status|install|pull <mod> [--prune]";
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

/** Removes `files` (relative paths) from `dir`, then any folders that left empty. */
export function removeFiles(dir, files) {
  for (const f of files) {
    fs.rmSync(path.join(dir, f), { force: true });
    for (let d = path.dirname(f); d && d !== "."; d = path.dirname(d)) {
      try { fs.rmdirSync(path.join(dir, d)); } catch { break; } // not empty: stop
    }
  }
}

/** "20261117-190005" (UTC), for a backup folder's name. */
const stamp = (date) => date.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

/**
 * One command against a pair of folders. Returns the exit code; prints through `log` / `fail`.
 * install: repo → live. pull: live → repo. Whatever is about to be overwritten or pruned at the
 * destination is first copied to <backupRoot>/<mod>-<command>-<time>/.
 */
export function run({ command, mod, prune = false, repoDir, liveDir, backupRoot, log = console.log, fail = console.error, now = new Date() }) {
  if (!COMMANDS.includes(command)) { fail(`unknown command: ${command}\n${USAGE}`); return 2; }
  if (!mod || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(mod)) { fail(USAGE); return 2; }
  if (!fs.existsSync(repoDir)) { fail(`no such mod in this repo: ${repoDir}`); return 2; }
  const live = fs.existsSync(liveDir);
  const diff = compare(repoDir, liveDir);
  log(`repo: ${repoDir}\nlive: ${liveDir}${live ? "" : " (not installed)"}`);
  log(`same ${diff.same.length}, changed ${diff.changed.length}, only in repo ${diff.onlyFrom.length}, only live ${diff.onlyTo.length}`);
  for (const f of diff.changed) log(`  changed    ${f}`);
  for (const f of diff.onlyFrom) log(`  repo only  ${f}`);
  for (const f of diff.onlyTo) log(`  live only  ${f}`);
  if (command === "status") return 0;
  if (command === "pull" && !live) { fail("not installed: nothing to pull"); return 2; }

  const install = command === "install";
  const [from, to] = install ? [repoDir, liveDir] : [liveDir, repoDir];
  const added = install ? diff.onlyFrom : diff.onlyTo; // new at the destination
  const extra = install ? diff.onlyTo : diff.onlyFrom; // at the destination only
  const pruned = prune ? extra : [];
  const replaced = [...diff.changed, ...pruned];
  if (replaced.length) {
    const backup = path.join(backupRoot, `${mod}-${command}-${stamp(now)}`);
    copyOver(to, backup, replaced);
    log(`backup of ${replaced.length} file(s) from the ${install ? "live mod" : "repo"}: ${backup}`);
  }
  copyOver(from, to, [...diff.changed, ...added]);
  removeFiles(to, pruned);
  log(`${install ? "installed" : "pulled"} ${diff.changed.length + added.length} file(s), removed ${pruned.length}`);
  if (extra.length && !prune) {
    log(`${extra.length} file(s) exist only ${install ? "live" : "in the repo"} and were left alone; add --prune to remove them (they are backed up first)`);
  }
  return 0;
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const [command = "status", mod] = argv.filter((a) => !a.startsWith("--"));
  const unknown = flags.filter((f) => f !== "--prune");
  if (unknown.length) { console.error(`unknown option: ${unknown.join(" ")}\n${USAGE}`); return 2; }
  return run({
    command, mod, prune: flags.includes("--prune"),
    repoDir: path.join(REPO, mod ?? "", "mods", mod ?? ""),
    liveDir: path.join(liveHome(), "mods", mod ?? ""),
    backupRoot: process.env.HERDR_MODS_BACKUPS || path.join(REPO, ".backups"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
