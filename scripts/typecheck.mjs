#!/usr/bin/env node
// A local safety net for view code that no test or `herdr-app check` reaches: runs TypeScript over
// each mod and reports only the mistakes that are real in plain JavaScript (a name that doesn't
// exist, an import the module doesn't export, a duplicate object key, a missing module).
//
//   node scripts/typecheck.mjs [mod ...]      default: every mod in the repo
//
// Needs `tsc` on the PATH (npm install -g typescript) and the two files Herdr writes into a mod
// folder the first time it loads or checks it (gpui-kit.d.ts, jsconfig.json; both ignored by git).
// A mod without them is skipped with a note, so this can't run on CI. The rest of TypeScript's
// output (untyped parameters, theme colors as strings, methods joined to a class at run time) is
// noise for these mods and is not shown.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The diagnostics worth stopping for, by TypeScript code. */
export const REAL = {
  TS1117: "duplicate object key",
  TS2300: "duplicate name",
  TS2304: "name not found",
  TS2305: "module has no such export",
  TS2307: "module not found",
  TS2451: "name declared twice",
  TS2552: "name not found (misspelled?)",
  TS2613: "module has no default export",
  TS2614: "module has no such export",
  TS2724: "module has no such export (misspelled?)",
};

/** The lines of tsc output that carry one of the REAL codes. */
export function realErrors(output) {
  return String(output).split(/\r?\n/).filter((line) => {
    const m = /error (TS\d+):/.exec(line);
    return m && Object.hasOwn(REAL, m[1]);
  });
}

function main(argv) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const mods = argv.length ? argv : fs.readdirSync(repo, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(repo, e.name, "mods", e.name, "main.js"))).map((e) => e.name);
  let failed = 0;
  for (const mod of mods) {
    const dir = path.join(repo, mod, "mods", mod);
    if (!fs.existsSync(path.join(dir, "jsconfig.json")) || !fs.existsSync(path.join(dir, "gpui-kit.d.ts"))) {
      console.log(`${mod}: skipped (run herdr-app check on ${dir} once, so Herdr writes its type files)`);
      continue;
    }
    // A fixed command line (no input in it), through the shell so Windows finds tsc.cmd.
    const run = spawnSync("tsc -p jsconfig.json --noEmit --noImplicitAny false", { cwd: dir, encoding: "utf8", shell: true });
    if (run.error || run.status === null || /not recognized|not found/i.test(run.stderr ?? "")) {
      console.error("tsc is not available: npm install -g typescript");
      return 2;
    }
    const errors = realErrors(`${run.stdout}\n${run.stderr}`);
    for (const line of errors) console.log(`${mod}/${line}`);
    console.log(`${mod}: ${errors.length ? `${errors.length} problem(s)` : "ok"}`);
    failed += errors.length;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
