# herdr-mods

Mods for the [Herdr](https://herdr.dev) desktop app.

| Mod | What it is |
|---|---|
| [Quotr](quotr/mods/quotr/README.md) | Stock and crypto watchlist panel with logos, charts and pre/post-market data. Based on [Pulse](https://github.com/fatwang2/Pulse) by fatwang2. |
| [Roster](roster/mods/roster/README.md) | Opt-in Spaces/Projects/Status sidebar with inline Details, Options and folder panels; registered projects from the herdr-agents catalog with open issue and PR totals (GitHub, through `gh`). Final-candidate Windows validation for [#29](https://github.com/crx-lc/herdr-mods/issues/29) is pending; UIA/Narrator remains separate. |

## Install a mod

Open an agent in Herdr and ask it, with the mod's folder at the end:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/crx-lc/herdr-mods/tree/main/quotr
```

This is Herdr's own way to add a shared mod: the agent reads the mod's recipe and files, tells you
what it reaches (network, programs) and copies it into your Herdr home without overwriting anything.

## Layout

Each mod is its own folder, laid out the way Herdr shares mods, so it can be copied as is:

```
<mod>/
  RECIPE.md        the brief another agent could rebuild the mod from
  preview.png      a screenshot
  mods/<mod>/      the mod: main.js, mod.json, modules, assets, README, notices
    .tests/        its tests (hidden, so Herdr never loads them)
scripts/sync.mjs   compare or copy a mod between this repo and the live Herdr app
```

## Working from a clone

Herdr loads mods from `~/.config/herdr-app/mods/<mod>/` (or `$HERDR_APP_HOME/mods/<mod>/`). Copy the
mod's folder there, or let the script do it:

```
node scripts/sync.mjs status  quotr    # what differs between this repo and the live mod
node scripts/sync.mjs install quotr    # repo → live: copy new and changed files
node scripts/sync.mjs pull    quotr    # live → repo: bring back changes made in the live copy
herdr-app check ~/.config/herdr-app/mods/quotr
```

Run these commands from the repository root (`npm run status -- quotr` and
`npm run install-mod -- quotr` are shortcuts for the first two). Check status first: install and
pull are one-way copies, not merges, and **overwrite differing files at the destination**.

- Every file about to be overwritten or removed is first copied to
  `.backups/<mod>-<command>-<time>/` in this repository (ignored by git; set `HERDR_MODS_BACKUPS`
  to put it elsewhere).
- Files that exist only at the destination are listed and left alone. Add `--prune` to remove
  them, for example after a file was deleted from the repo: `node scripts/sync.mjs install quotr --prune`.
- Herdr's runtime files (`gpui-kit.d.ts`, `jsconfig.json`) and a mod's `.cache/` are never
  copied, overwritten or removed.

Herdr reloads a mod as soon as one of its files is saved. To show a mod as a panel: `herdr-app do pane.split '{"direction":"right","mod":"quotr"}'`.

## Tests

```
npm test
```

Runs every mod's `.tests` and the sync script's tests with Node's built-in test runner. It needs
Node 22 or later (the test script uses glob patterns, which older versions don't expand). The same
tests run on GitHub for pushes to main and pull requests, on Linux with Node 22 and the current
LTS, and on Windows with Node 22.

Also run `herdr-app check <mod folder>` after a change: it loads and renders the mod once. It has
no network and no window, so it can't show whether a request or a link works.

`npm run typecheck` is an optional local check (it needs `npm install -g typescript` and the type
files Herdr writes into a mod folder): it reports names that don't exist, bad imports and duplicate
object keys in code the other two checks never run.

Roster shipping inventory (read-only, no live home access):

```
node scripts/roster-package.mjs
```

Adding a mod, or changing one with an agent: see [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 crx-lc, for this repository's own work. Mods based on other projects keep those
projects' notices in their own folders (Quotr: `quotr/mods/quotr/LICENSE-PULSE.txt`).

The project icon (`project-icon.svg`, named by `project.json`) is the Herdr ram from
[herdrdev/herdr](https://github.com/herdrdev/herdr/blob/HEAD/assets/logo.svg), Apache-2.0, flattened and recolored:
see [project-icon.NOTICE.txt](project-icon.NOTICE.txt).
