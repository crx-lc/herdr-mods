# herdr-mods instructions

Mods for the Herdr desktop app, one folder per mod. Read `README.md` first, and Herdr's own manual
(`~/.config/herdr-app/AGENTS.md`) before writing mod code: it is the reference for the mod API.

## Layout

```
<mod>/
  RECIPE.md        the brief another agent could rebuild the mod from (Herdr's five sections)
  preview.png      a screenshot of the running mod
  mods/<mod>/      what gets installed: main.js, mod.json, modules, assets, README.md, notices
    .tests/        node:test files (a hidden folder: Herdr never loads it)
scripts/sync.mjs   status | install | pull between this repo and the live Herdr home
```

A mod is self-contained: everything it needs is inside `mods/<mod>/`, because installing it is
copying that folder. No imports from another mod or from the repo root.

## Adding a mod

1. Create `<mod>/mods/<mod>/` with `mod.json` and `main.js`. Lowercase name, letters, digits, `-`.
2. Keep logic out of the view. Put everything that can be tested in modules with **no Herdr
   imports**, and pass Herdr's APIs in as a host object (`fetch`, `exec`, timers, storage, `now`).
   `quotr/mods/quotr/marketfeed.js` and `logocache.js` are the pattern. The view files (`main.js`,
   nested views) only wire Herdr to those modules and draw.
3. Tests go in `.tests/*.test.mjs` and run with `npm test`. Anything that reaches the network or
   runs a program needs tests for no answer, a hung request, an error status and a malformed answer.
4. Write the mod's `README.md` (start with the install prompt, as Quotr's does), then
   `<mod>/RECIPE.md` from the finished files and `<mod>/preview.png`.
5. Add the mod to the table in the root `README.md`.
6. Based on someone else's work? Keep their license notice in the mod's folder
   (`LICENSE-<PROJECT>.txt`) and credit and link the original at the top of the README.

## Rules that came from real failures

- `herdr-app check` has no network and no window: `fetch` is refused and `window()` returns null.
  A passing check says the mod loads and renders, nothing about requests, links or timers.
- It also draws only what the mod shows with no props. A dialog (a copy opened with props) is
  never drawn: after changing one, check a throwaway copy of the mod whose `props()` is replaced by
  a sample, once per state worth seeing, and confirm a deliberate break makes that check fail.
- A request can hang forever. Race it against `cx.timer.after`, not `cx.sleep`, and cap how long
  any "loading" state can show.
- Saving a non-hidden file in a live mod folder reloads the mod and clears its memory. Runtime
  files (caches, downloads) go in a hidden folder such as `.cache/`.
- Herdr's QuickJS has no `Intl` and no time-zone data; `toLocaleString` options are ignored.
- `image()` takes local paths only. `fs.writeFile` wrote empty files for binary data: download
  with `curl -o` and check the bytes before showing a file.
- Programs run directly with arguments, never through a shell. Open only `https://` URLs, with the
  opener chosen by platform (`opener.js`).
- `window` inside a view is GPUI's drawing global; import Herdr's `window()` under another name.
- `cx.spawn` starts its task at once: one started in `render` runs inside render up to its first
  `await`, and `cx.notify()` there throws. Await once before post-render work. Test fakes must
  start tasks synchronously too, or they hide this.
- Herdr's Tab binding moves native focus before `on_key_down` hears Tab: bind Tab to an action
  under a `key_context` of the mod's own. GPUI also clicks a focused `track_focus` element on
  Enter/Space after `on_key_down` ran, so a handler that activates on both toggles twice.

## Never commit

- Herdr's generated files (`gpui-kit.d.ts`, `jsconfig.json`), a mod's `.cache/`, `.backups/`.
- Personal data: watchlists, saved choices, user names, home paths, emails, tokens. Saved state
  lives in Herdr's shared state and `localStorage`, outside the mod folder; keep it there. Test
  fixtures use neutral sample data.
- Before every commit, search the staged files for the machine's user name and home path.

## Checks

- `npm test` (Node 22 or later) and `herdr-app check <repo>/<mod>/mods/<mod>` on the repo copy.
- `npm run typecheck` when `tsc` is installed: it catches a missing name, a bad import or a
  duplicate object key in view code that neither of the others runs. Local only.
- For anything `herdr-app check` can't see (requests, links, timers): install and look at the
  running mod, and say in the report what was and wasn't seen live.
- Report executed checks separately from proposed ones. A prepared workflow is not a CI pass.

## Live install, commits, publishing

- The live mod in `~/.config/herdr-app/mods/` is the owner's working app. Change it only when
  asked, with `node scripts/sync.mjs install <mod>` (it backs up what it overwrites). Never touch
  saved state or another mod.
- One topic per commit, a descriptive body, and an `Agent:` trailer; no generated-by lines.
  Commit locally; push, repository settings and topics only when the owner asks.
- The repository is public. New network sources, bundled third-party assets and anything with
  terms of use get a note in the mod's README under data sources and limits.
