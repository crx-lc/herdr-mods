# herdr-mods

Mods for the [Herdr](https://herdr.dev) desktop app.

| Mod | What it is |
|---|---|
| [Quotr](quotr/mods/quotr/README.md) | Stock and crypto watchlist panel with logos, charts and pre/post-market data. Based on [Pulse](https://github.com/fatwang2/Pulse) by fatwang2. |

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

Run these commands from the repository root. Before install or pull, inspect status and commit
or back up changes you want to keep: both commands **overwrite differing files at the destination**
without making a backup. They are one-way copies, not merges.

The script never deletes files and never copies Herdr's runtime files (`gpui-kit.d.ts`,
`jsconfig.json`) or a mod's `.cache/`. Herdr reloads a mod as soon as one of its files is saved.
To show a mod as a panel: `herdr-app do pane.split '{"direction":"right","mod":"quotr"}'`.

## Tests

```
npm test
```

Runs every mod's `.tests` and the sync script's tests with Node's built-in test runner (Node 20+).
Also run `herdr-app check <mod folder>` after a change: it loads and renders the mod once.

## License

[MIT](LICENSE) © 2026 crx-lc, for this repository's own work. Mods based on other projects keep those
projects' notices in their own folders (Quotr: `quotr/mods/quotr/LICENSE-PULSE.txt`).
