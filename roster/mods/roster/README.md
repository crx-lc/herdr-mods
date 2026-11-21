To add the mod, ask an agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/crx-lc/herdr-mods/tree/main/roster
```

# Roster

Roster is an opt-in sidebar with Projects and Status views. It starts with
`place:none`: installation alone adds no panel or layout change. The current
Desktop adapter displays provisional terminal rows, native status, validated
role/work-item labels and accessible GitHub/Azure DevOps badges. Unknown identity,
project and execution context stay explicit. Counts describe observed identities,
not a verified census across aliases.

**Current limits:** stock Desktop snapshots do not independently establish permanent
Core identity or uninterrupted remote connection generations. Production therefore
supplies empty Core mappings, documents, routes, scopes and correlations. **Open
terminal actions and authoritative delegation waiting are disabled by default.**
Core-based project/context mappings remain unbound. Equal names or aliases do not
establish identity. This is a passive fallback from [PR #19](https://github.com/crx-lc/herdr-mods/pull/19) for [#10](https://github.com/crx-lc/herdr-mods/issues/10), not proof
that every original acceptance criterion is met.

## Using the sidebar

After installation and the usual isolated App checks, explicitly open a copy with
`openOverlay({mod:'roster'})` from an authorized mod/agent, or place a copy in a
personal layout. No live installation or activation was performed for this change.
Projects groups known project memberships and verified parent relationships;
otherwise rows appear under explicit Unassigned groups. Status separates Needs
you, contextual Child needs you, Working, Done, Idle, Offline, Stale and Unknown.
Only terminals in the current snapshot are displayed; vanished observations are
omitted, including superseded incarnations at a reused address. No finished state
is invented. Done starts folded. No supplementary terminal history is acquired.

Projects/Status, group and child folds, and independent Machine/Context filters
change only the sidebar. Global Needs you survives filters and folds; an entry
outside filters explains why it cannot be opened. Contextual Child needs you
creates no second actionable parent. Provider badges represent work items, never
an LLM or group. Every row keeps project name/fallback, host/route description,
execution context, provider accessibility name and disabled-action explanation.

Click gives the sidebar its own keyboard focus. Up/Down moves a visible cursor
through its controls; Enter activates the selected control and retains its position
when that control survives. A removed control selects the nearest current position.
The explicit `focus` command also gives it focus. Selected row detail is visible as a keyboard-focus
tooltip as well as a hover tooltip and accessibility label. No global key binding,
`setAgentOrder`, terminal input, approval, status, notification or lifecycle changes
are made. Native GPUI focus/accessibility behavior still needs desktop validation.

With independently verified injected evidence, the actual merged navigation guard
maps eligible explicit actions to `pane.focus {terminal:exactAddress}` or
`terminal.peek {terminal:exactAddress}`. It checks the current model pane snapshot
and its completeness, generation, readiness, identity and current view state.
Activation recaptures the six getters once; old callbacks, observed disconnects
and changed model routes fail closed. The shipped adapter cannot supply these
proofs, and no experimental Core reader is bundled.

## Selected Agents-slot opt-in and undo

“Choose an existing Agents slot…” inspects the current layout only when clicked.
Select one exact existing slot. Roster first writes a preservation copy of the
**current effective tree**, then a private restoration record, then a separate
working layout with only that slot's content replaced, and switches to that copy.
The original layout file, shipped Agents source, other slots and Quotr remain
untouched. The working/preserved layout names are `roster-<token>` and
`roster-preserved-<token>`; restoration records use the private App data file
`data/roster/restoration-<token>.json` (shared across the mod's different props). Keep these local; never commit them.

“Restore Agents in this slot” reloads the record after restart, verifies that the
current slot is still exactly owned, and restores only its original content in
the latest working layout file. Unrelated intervening edits survive. It does not
restore a stale whole tree or switch back to a stale original. Removed/replaced
slots, changed layouts and concurrent edits cause refusal. Expected-text writes
are the documented native guard, **not an OS-wide atomic compare-and-swap
promise**. Two-second operation deadlines bound UI waiting; a timed-out write can still
settle later, so inspect and reread before retrying. Failed steps can leave
preservation/working files for inspection;
there is no automatic cleanup or rollback claim. Backups and private restoration
records can contain personal layout data.

## Delegation boundary and waiting

`local-reader.js` discovers only the exact published `herdr.delegations` label,
behind independently supplied Core, process and continuity admission for the exact
producer observation and generation. Production has no such admission, so it reads
zero files. The boundary rejects relative, URL, network/UNC, control-containing
and over-4096-character paths. Only local `readTextFile(path,{on:null})` is allowed.
**Remote native text reads remain prohibited**, even with ready machines: at the
source pin they invoke startup-capable `hc exec`. There are no runtime hc commands,
schema/discovery calls, ambient Core probes or directory scanning.

A read has a two-second UI deadline via `cx.timer.after`, at most 16 candidates,
two outstanding native reads, 1 MiB per file and 4 MiB accepted text per refresh.
A timed-out read still occupies its slot until the native operation actually
settles. Refresh attempts are at least ten seconds apart and triggered only by
observations that render; there is no automatic retry loop or loading spinner.
Superseded generation/fingerprint results are rejected. No stale text fallback is
used; revision high-water history survives failures and observed reconnects.

Acquisition generations advance before proof stamping on refresh or selected
terminal/process, identity, readiness, pane membership or proof changes. Injected
`evidence(snapshot,generation)` must be synchronous and pure: proof-only changes
may resample it once at the newly allocated generation. Derived stamps do not
feed back into the fingerprint. Focus, scrolling, selection and agent display
changes preserve admitted text without another file read. Even throttled refresh
attempts observe real invalidations before returning. Unobserved disconnects cannot
be detected by the public snapshot API.

The feed holds only current snapshot rows; it keeps no vanished-row map. For N
current rows and I displayed instances, the view builds one O(N) parent-key set
and makes O(1) presence checks per instance (O(N + I) for that work). Pure reducers
retain their existing current-scope costs and revision high-water semantics; no
whole-pipeline linear-time or bounded high-water-history claim is made.

Both views use `normalizeApp → resolveIdentities → enrichMetadata → reduceRoster
→ projectRoster`. R2 permits partial waiting; the host boundary first assesses
with R2, retains its history, removes parent documents whose delegation knowledge
is incomplete, then reruns R2. It never edits display strings to hide a semantic
claim. With complete injected evidence, an idle waiting Coordinator belongs to
Working but contributes zero workers: three genuinely working delegates count
three. Hidden children use full waiting text; visible direct children allow a
distinct **static** ◈ marker with full hover/focus/accessibility detail. No pulse,
animation or reduced-motion detection is claimed.

## Private settings and icons

`settings.js` retains `parseSettings`, `readSettings`, `setProjectIcon` and `bounded`.
V1 settings contain projects/projectBindings/contexts/processProviders/
projectProviders and icons keyed by stable project ID. The pure host contract
requires private storage, bounded operations and an atomic settings compare-and-
swap. That settings adapter is **not enabled** by the production sidebar.

`icons.js` retains `validateIcon` and `iconDescriptor`. A host must enforce a private
leaf namespace, containment, no symlink escape, bounded reads and safe immutable
rendering of the same validated bytes. PNG/static SVG checks cap assets at
256 KiB and dimensions at 1024. Native decoding is not proven by validation.
The production adapter cannot prove these host guarantees and reads no private
assets/settings. It always displays an 18 logical-pixel monogram with the project
name. A configured image picker, asset adapter and native icon display remain
unproven; no safety check was weakened to show an image.

Detailed pure exports and data shapes are in [MODULES.md](MODULES.md).

## Modules, data sources and limits

The installable tree is self-contained. `main.js` imports only Herdr/gpui-kit and
the local view; `view.js` draws and wires the host-injected controller, feed,
local reader and layout logic. Pure logic has no Herdr imports. Existing identity,
metadata, delegation, attention, projection, settings, icons and navigation
contracts remain the implementation; there is no parallel semantic reducer.

`normalizeApp`, `normalizeFull` and `normalizeCompact` select explicitly different
record shapes. `resolveIdentities` accepts only independent verified alias/Core
assertions, deduplicates exact incarnations and preserves uncertain relationships.
`enrichMetadata` accepts explicit Core/project/context/provider configuration.
`reduceRoster` consumes published delegations v1 with monotonic revision history;
`projectRoster`, `transition` and `actionIntent` retain the actual view/state and
navigation guard. Trusted injected host evidence is a test/extension seam, not a
new public Desktop API or a proof that installed Desktop exports those facts.

Source references: [App manual/types and implementation at 317e673](https://github.com/herdrdev/herdr-app/tree/317e673f1f1568b876cbaa0b41dabeb9153ecbea),
[Core at c751780](https://github.com/herdrdev/herdr-core/tree/c7517808d64f06609e4ecf0db1757005373cc3a3),
and [herdr-agents delegations v1 at 55c71df](https://github.com/crx-lc/herdr-agents/tree/55c71df91dbd60cf07358bbcaebba5586870fd44/contracts/delegations).
These pins are source evidence, not installed Desktop version proof. No network
source, external asset, dependency or Better Sidebar code/assets is bundled.

Run `npm test` in the repository. For optional offline published contract parity,
set `ROSTER_DELEGATION_FIXTURES` to the separately downloaded pinned evidence
folder containing `reader-cases.json` and `delegation-read.mjs`; tests never fetch.
Strict Node fake-host tests exercise the actual entry, controller, reducers,
native-call arguments, keyboard/tooltip data, read budgets and layout operations.
They do not establish QuickJS/GPUI/native Windows behavior.

Remaining original acceptance gaps: installed Core-qualified local/remote/pane-less
navigation; authoritative runtime waiting and observed remote continuity;
Core-bound project/context associations; private configured icons; actual stock
Windows opt-in/undo, accessibility, narrow-sidebar screenshot and App rendering.
No App check, typecheck, live install/sync, owner layout/settings/Quotr access or
real remote probe was run. There is no fabricated `preview.png`. Packaging is tracked in [#11](https://github.com/crx-lc/herdr-mods/issues/11);
isolated stock Desktop acceptance belongs to the separate Windows effort. Global
shortcut changes are outside the current scope; the old Phase 2/#18 gate is retired.


## Package inventory and acceptance evidence

From the repository root, run `node scripts/roster-package.mjs`. It prints the
sorted, repository-relative paths of the 20 installed-folder files that would
ship. It only reads the repository package; it never copies, installs, syncs,
loads mod code or consults a live App home. No destination options are accepted.
This is a separate inventory policy, not a dry run of `scripts/sync.mjs` (whose
broader file selection must not be substituted for this shipping list).

The script uses an explicit file allowlist and V8's module parser in a bounded
Node subprocess without linking or evaluating modules. All static imports and
re-exports must resolve to included JavaScript files or the Herdr-provided
`herdr`, `gpui-kit`, `gpui-base` modules. Missing files, unexpected files, symlinks,
escaping/external references and changed passive manifest defaults fail the check.
`.tests`, generated types/jsconfig, `.cache` and `.backups` are excluded, never
read recursively or shipped. Other hidden/private/unrecognized files fail rather
than quietly entering the inventory. There are no shipped image assets; direct
renderer calls and dynamic imports/require are conservatively refused (the local
`svg(bytes)` validator in `icons.js` is an audited exception). This static inventory
is not a general JavaScript security audit: new runtime loading patterns, native
API aliases or asset adapters need explicit review and checker changes. Keep all
private mappings, layouts and assets outside this folder.

Available historical evidence for the merged implementation: [PR #19's exact-head
independent review](https://github.com/crx-lc/herdr-mods/pull/19#pullrequestreview-6008211075)
and [the #10 result](https://github.com/crx-lc/herdr-mods/issues/10#issuecomment-7069343564)
record default Node tests (367 total, 366 pass, one optional parity skip), pinned
parity (396 pass), and three successful CI jobs including Windows Node 22. These
are repository/fake-host checks, not native Windows Desktop evidence.

The [#11 owner split](https://github.com/crx-lc/herdr-mods/issues/11#issuecomment-7070155324)
assigns actual stock Desktop validation and the neutral narrow-sidebar capture to
the Windows coordinator. No actual capture was supplied when this packaging was
prepared, so **`roster/preview.png` is absent and its criterion remains unmet**.
There is no substitute illustration. The coordinator must integrate a verified,
neutral Windows capture later and record its provenance.

The acceptance umbrella [#4](https://github.com/crx-lc/herdr-mods/issues/4) remains
open. Packaging does not establish installed manual/type parity, App/sample-state
checks and their deliberate negative control, real opt-in/undo/restart preservation,
local/remote focus/peek, authoritative waiting/attention transitions, private image
rendering, Windows accessibility or a narrow-sidebar preview. Core-qualified actions,
authoritative waiting and configured private images remain blocked by #10's proof
gaps. Stronger host-injected fixtures do not make them native capabilities. No
full release or completed Windows acceptance is claimed.
