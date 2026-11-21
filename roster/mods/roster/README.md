To add the mod, ask an agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/crx-lc/herdr-mods/tree/main/roster
```

# Roster

Roster is an opt-in sidebar with Projects and Status views. It starts with
`place:none`: installation alone adds no panel or layout change. The current
Desktop adapter displays provisional terminal rows, native status, validated
role/work-item labels and GitHub/Azure DevOps badges with declared accessibility
names. Unknown identity, project and execution context stay explicit. Counts describe observed identities,
not a verified census across aliases.

**Current limits:** stock Desktop snapshots do not independently establish permanent
Core identity or uninterrupted remote connection generations. Production therefore
supplies empty Core mappings, documents, routes, scopes and correlations. **Open
terminal actions and authoritative delegation waiting are disabled by default.**
Core-based project/context mappings remain unbound. Equal names or aliases do not
establish identity. This is a passive fallback from [PR #19](https://github.com/crx-lc/herdr-mods/pull/19) for [#10](https://github.com/crx-lc/herdr-mods/issues/10), not proof
that every original acceptance criterion is met.

## Using the sidebar

**Known Windows failures:** in the default approximately 330×350 Agents slot,
existing PR19 header controls consume almost all the height, leaving one line of
rows or none. Scrolling does not guarantee usable rows at that size. Stock
Desktop 0.1.16 also exposes no mod `accessibility_label` to Windows UIA/Narrator
(a platform gap). Visible labels and keyboard detail do not prove assistive
technology exposure. Both failures remain open under #10/#11/#4; runtime fixes
are outside this packaging change. Badges/monograms appearing on separate lines
are an additional, uncounted observation.

After installation and the usual isolated App checks, explicitly open a copy with
`openOverlay({mod:'roster'})` from an authorized mod/agent, or place a copy in a
personal layout. This Linux packaging worker performed no live installation or
activation; the external isolated Windows run is recorded below.
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
The explicit `focus` command also gives it focus. Selected row detail is visible
as a keyboard-focus tooltip as well as a hover tooltip; the code also declares
accessibility labels. No global key binding,
`setAgentOrder`, terminal input, approval, status, notification or lifecycle changes
are made. The external run passed sidebar focus/Enter and visible tooltip detail,
but failed UIA label exposure as described above.

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

Remaining original acceptance gaps include Core-qualified local/remote/pane-less
navigation, authoritative runtime waiting/delegateWorking and observed remote
continuity, Core-bound project/context associations, and private configured icons.
These remain **not verifiable**, blocked by #10 rather than waived. The default-height
layout and UIA failures above also remain open. Global shortcut changes are outside
the current scope; the old Phase 2/#18 gate is retired.

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
`herdr`, `gpui-kit`, `gpui-base` modules. Missing files, unexpected files, explicitly
linked package roots or links in included traversal paths, escaping/external
references and changed passive manifest defaults fail the check.
Ordinary directory roots reached through linked ancestors are accepted after root
canonicalization; traversal never follows links inside the package.
`.tests`, generated types/jsconfig, `.cache` and `.backups` are excluded, never
read recursively or shipped. Other hidden/private/unrecognized files fail rather
than quietly entering the inventory. There are no shipped image assets; direct
renderer calls and dynamic imports/require are conservatively refused (the local
`svg(bytes)` validator in `icons.js` is an audited exception). This static inventory
is a current-package eager import inventory with direct-call restrictions, not
full JavaScript security/dataflow validation: new runtime loading patterns, native
API aliases or asset adapters need explicit review and checker changes. Keep all
private mappings, layouts and assets outside this folder.

Available historical evidence for the merged implementation: [PR #19's exact-head
independent review](https://github.com/crx-lc/herdr-mods/pull/19#pullrequestreview-6008211075)
and [the #10 result](https://github.com/crx-lc/herdr-mods/issues/10#issuecomment-7069343564)
record default Node tests (367 total, 366 pass, one optional parity skip), pinned
parity (396 pass), and three successful CI jobs including Windows Node 22. These
are repository/fake-host checks, not native Windows Desktop evidence.

The [external stock Windows report](https://github.com/crx-lc/herdr-mods/issues/11#issuecomment-7070369048)
records Windows 11, App 0.1.16 and hc 0.1.21 at merged main `10c9d66` (PR19):
**22 checks: 17 pass, 2 fail, 3 not verifiable; isolation 3/3 pass.** It reports
real App checks on the repo copy plus two sample-state copies, with three deliberate
breaks failing. Selected-slot opt-in, preservation-first behavior, untouched source
layout, byte-identical undo after restart, chosen-state restart persistence and
Quotr/settings preservation passed. Sidebar keys/Enter, visible hover/focus tooltips
and static rendering passed; the OS reduced-motion toggle was **not tested**.
The two failures and uncounted inline-layout observation are stated near usage above.

The external report says the owner's 431 config files were byte-identical, with
before/after list SHA-256
`D349EC390426AF8064D570E897D93201380FCE1EBFE45AF222E802AD72007546`.
Only the posted summary and crops were supplied here: this Linux worker did not
run native Windows checks or independently audit raw Windows logs. That run at
`10c9d66` does not validate the new package checker on macOS or any new runtime;
runtime code is unchanged. Source pins above do not prove installed Desktop parity.

The share artifact [Projects preview](../../preview.png) is the supplied real
Windows crop, copied byte-for-byte: 240×820, SHA-256
`60d483878d8436296fb47ce9275d3766b05215bb9080fb435b173557c3eb6790`.
It shows neutral Coordinator / Developer #42 / Reviewer PR #43 sample labels,
with no personal mappings imported. It is a tall sidebar capture, **not evidence
of success at default height**, and lives outside the 20-file installed package.
The supplied Projects and Status source crops remain in private project evidence.

This worker's executed checks are repository Node tests, pinned offline parity,
the static inventory and symlink controls, recorded in PR20 with full private logs.
No App/typecheck/native Windows/macOS run, live installation/sync, owner
layout/settings/Quotr operation or remote probe was performed by this worker.
The acceptance umbrella [#4](https://github.com/crx-lc/herdr-mods/issues/4),
[#10](https://github.com/crx-lc/herdr-mods/issues/10) and
[#11](https://github.com/crx-lc/herdr-mods/issues/11) remain open: the two failures
need resolution and Core-qualified actions, waiting/delegateWorking/remote
continuity and private images remain not verifiable. Stronger injected fixtures
do not make them native capabilities. No full release readiness is claimed.
