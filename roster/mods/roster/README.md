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

The [external Windows R3 report](https://github.com/crx-lc/herdr-mods/issues/21#issuecomment-7083288510) validated runtime source `929d85903dc0b32e2fe05b4b98e8d258c63b7f74` on Windows 11 Pro 10.0.26300, stock Desktop 0.1.16, hc 0.1.21, Node 26.13.1 and tsc 7.0.2. At 100% OS scale the slot was 330×350 physical pixels: zoom 1 uses 330×350 logical, zoom 1.1 uses 300×318 logical. The report records 53 pass, 1 fail, 4 not verifiable, and isolation 3/3. Toolbar return, reader paging, machine/context fit, Options, scrolling and selected-slot opt-in/undo/restart passed the described presentation checks at that source head. Repo tests were 416 total, 415 pass and one optional skip; package inventory had 21 files, typecheck and native check passed, 16 sample states passed and 22 deliberate breaks were detected. This packaging changes only documentation and preview images; runtime files remain byte-identical to that source. Windows did not run on the later packaging commit. Raw private logs were not independently audited here.

**Remaining criteria:** stock Windows UIA exposes no Roster labels; Narrator was not run. Production exact Open/Peek (local, remote and pane-less), authoritative Waiting, private project images and finished rows were not verifiable. Injected route and waiting positives are UI test fixtures, not production capability proof. Issue #21 remains open; no full release acceptance or scope waiver is claimed. Stock Desktop 0.1.16 overlay shows only toolbar and Options; selected Agents-slot opt-in is the tested path.

The native tooltip can clip at the window edge; D or pointer Info/Details supplies the complete in-panel reading path. Tested common Unicode and page boundaries preserved text without clipping. Stock fonts displayed regional-indicator components rather than flags, tag sequences as a black flag, and ZWJ sequences as components; lone CR was invisible. These rendering limits are distinct from text loss. The pagination is not full UAX #29.

Projects groups known project memberships and verified parent relationships;
otherwise rows appear under explicit Unassigned groups. Status separates Needs
you, contextual Child needs you, Working, Done, Idle, Offline, Stale and Unknown.
Only terminals in the current snapshot are displayed; vanished observations are
omitted, including superseded incarnations at a reused address. No finished state
is invented. Done starts folded. No supplementary terminal history is acquired.

Projects/Status, group and child folds, and independent Machine/Context filters
change only the sidebar. Open **Options** for filters and Agents-slot controls.
Unfiltered dimensions with only one available value have no redundant selector;
when a filter is active, its reset stays available. Global Needs you survives filters and folds; an entry
outside filters explains why it cannot be opened. Contextual Child needs you
creates no second actionable parent. Provider badges represent work items, never
an LLM or group. Rows keep a neutral project monogram and inline provider/state
chips on their title line. Separate Project and verified Parent lines extend
beneath the chips. The last line gives machine/route and execution context equal,
independently bounded columns. It abbreviates an unknown host to Local route or
Route <alias>; an alias does not verify a host. Full host-unknown and unverified-identity
diagnostics remain in Details and full hover text.
Only the projected verified parent supplies a name; missing relationships show
Not reported or Unknown with the existing resolution. Unassigned projects,
unknown hosts remain explicit in full details and unknown contexts stay visible. Long row lines ellipsize
independently; full values are available through Details. Info is a sibling of
the terminal control and never opens the terminal. Provider markers remain
separate from project images.

Click gives the sidebar focus. Up/Down selects controls; Enter activates the
selected control. Normal row Enter keeps its guarded Open semantics. D on a row,
Info or child-fold control opens the local reader, as do Enter/click on Info or
the footer's Details (D). The disabled reason retains its own 16px line above a
16px summary/Details line (32px total); enabled selections use 16px. Full contextual
hover uses the same facts/reason mapping as the reader, including full waiting
text even when expanded children use compact Waiting. Native tooltips can clip
at the window edge; use Info/Details to read every field.

**Details at opening** replaces the content below the toolbar with a captured,
nonpersistent snapshot of that exact projection instance. Each page shows one
literal field or its continuation: name, project, verified parent, machine/route,
context, state, full waiting text when present, work-item/project provider,
action availability, outside-filter reasons and identity diagnostic. Left/Up and
Previous go back, Right/Down and Next go forward, Home/End jump first/last, and
Esc/Back returns to the same surviving control and reveals its row. If that
instance vanished, return safely to Projects; identical names never rebind it.
Enter in the reader only operates a reader control and cannot Open a terminal.
Toolbar clicks close the reader and keep the clicked toolbar cursor/highlight.
View/filter/fold or Options state transitions cancel origin returns, including a
Back/Esc return queued before the next render. Unhandled keys
retain host behavior. The existing explicit focus command still focuses this copy;
there are no new global keys, overlays or terminal-input changes.

Pages preserve every source character, including whitespace and blank lines,
with at most 64 Unicode code points and three line breaks (CRLF, lone CR or LF) per page;
there is no total-length clipping. Feasible boundaries preserve regional-indicator
pairs, emoji tag sequences, CRLF, and common combining/variation/skin-tone/ZWJ
sequences without Intl. Oversized graphemes split within the fixed budget to
guarantee progress; this is not a full Unicode grapheme algorithm or font-shaping
guarantee. Fresh 12px wrapped literal text uses the panel
width, without ellipsis or clamping. Only the active page is rendered. This
budget was tested in the R3 report at both zooms, subject to the stock font limits above. The normal-list planning budget is 148px fixed; the reported native worst case showed two full rows and a heading at both zooms.

With independently verified injected evidence, the actual merged navigation guard
maps eligible explicit actions to `pane.focus {terminal:exactAddress}` or
`terminal.peek {terminal:exactAddress}`. It checks the current model pane snapshot
and its completeness, generation, readiness, identity and current view state.
Activation recaptures the six getters once; old callbacks, observed disconnects
and changed model routes fail closed. The shipped adapter cannot supply these
proofs, and no experimental Core reader is bundled.

## Selected Agents-slot opt-in and undo

“Choose an existing Agents slot…” (in **Options**) inspects the current layout only when clicked.
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

The installable tree is self-contained. `main.js` imports only Herdr/gpui-kit/gpui-base and
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

Terminal row icons: each row's one leading icon comes from Herdr's own program table
(the `program` Herdr reports for the terminal), never from a tab title, name or role.
Agent and program icons (Claude Code, Codex, Antigravity, the Watcher's and Supervisor's
entries, other shells) are Herdr's shipped files in `icons/` of Herdr's home, drawn by
reference and not bundled here; their notices are Herdr's (`icons/LICENSES.md`). Roster
ships two original glyphs, `icons/bash.svg` and `icons/powershell.svg`: a generic prompt
in each shell's customary color, not either project's logo. An unknown program gets the
neutral `icons/terminal.svg`. Motion is limited to the Working header icon and one short
pulse of the Needs you bell; Herdr does not report a system reduced-motion preference, so
Options > Motion turns both off (kept in this mod's `localStorage`), as does a
`reduce_motion` flag if Herdr's settings ever carry one.

Run `npm test` in the repository. For optional offline published contract parity,
set `ROSTER_DELEGATION_FIXTURES` to the separately downloaded pinned evidence
folder containing `reader-cases.json` and `delegation-read.mjs`; tests never fetch.
Strict Node fake-host tests exercise the actual entry, controller, reducers,
native-call arguments, keyboard/tooltip data, read budgets and layout operations.
They do not establish QuickJS/GPUI/native Windows behavior.

Remaining original acceptance gaps include Core-qualified local/remote/pane-less
navigation, authoritative runtime waiting/delegateWorking and observed remote
continuity, Core-bound project/context associations, and private configured icons.
These remain **not verifiable**, blocked by #10 rather than waived. The UIA gap above remains open under [#21](https://github.com/crx-lc/herdr-mods/issues/21). Global shortcut changes are outside
the current scope; the old Phase 2/#18 gate is retired.

## Package inventory and acceptance evidence

From the repository root, run `node scripts/roster-package.mjs`. It prints the
sorted, repository-relative paths of the 21 installed-folder files that would
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
That historical run found header crowding and missing UIA labels. The R3 report above supersedes its presentation observations for the pinned runtime.

The share artifacts [Projects preview](https://github.com/crx-lc/herdr-mods/blob/main/roster/preview.png) and [Status preview](https://github.com/crx-lc/herdr-mods/blob/main/roster/preview-status.png) are neutral production 330×350 crops from the R3 Windows run, copied byte-for-byte. They live outside the installed package. No live installation or native Windows rerun was performed for this packaging change.
