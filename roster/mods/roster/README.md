To add the mod, ask an agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/crx-lc/herdr-mods/tree/main/roster
```

# Roster

Roster is an opt-in sidebar with Spaces, Projects and Status tabs. It starts with
`place:none`: installation alone adds no panel or layout change. Terminal identity,
project and execution context remain provisional or unknown where the host cannot
prove them. Native session navigation uses the current exact terminal/pane snapshot;
it never selects a terminal by its display name. Authoritative delegation waiting
still requires independent admitted evidence that the stock adapter does not supply.

## Using the sidebar

Spaces shows Herdr's Spaces under their machines. Projects groups observed sessions
by their current Space or independently verified project/parent association; Status
groups sessions by reported status. Done starts folded. Global **Needs you** stays
above the tabs, outside the main scrolling list, including when filters hide the
same session elsewhere. Its repeated group row is an echo of the same session.
While Needs you is not empty its bell pulses on a new arrival and again every 2 minutes,
with a chime by Options › Sound (see [Needs you reminders and sound](#needs-you-reminders-and-sound)).

**Details**, **Options** and **Open folder as Space** share one disclosure state:
opening one closes the other. Click the same trigger again to close it. These are
inline panels, with surrounding rows still usable; none covers the sidebar.

- Info (ⓘ), D on a session control, or the footer's Details opens Agent Details
  directly below that exact row inside its group. The row stays mounted. Current
  host-reported/verified facts appear first; Technical details expands IDs and paths.
  Listed Stale/Unknown, disconnected and missing-machine rows remain readable with
  an unavailable-action reason; unknown identity and missing facts remain unknown. The row name retains its exact
  guarded native activation. Opening/closing Details does not activate a terminal;
  **Go to terminal** is a separate explicit action using the same fresh host checks.
- Options expands immediately below the tab toolbar. It retains independent
  Machine/Context filters, motion preference, the Sound choice and existing Agents-slot controls.
  Active filters always have a reset. Choosing a filter keeps Options open.
- A machine's + expands the folder form below that machine's header, showing its
  exact target machine. The toolbar + uses the shown Space's machine and places
  the form at that machine; with only this computer listed it sits below the toolbar.
  Choose folder uses Herdr's unchanged native picker locally. Remote targets use
  a path field or host-reported suggestions. Checking a path performs the existing
  bounded read-only Git checks on that machine. Only explicit **Create Space**,
  **Open existing Space**, **Create another Space**, or the final **Create anyway**
  action can create/open anything. An unverified folder requires a separate explicit
  confirmation. Cancel, Esc and a toggled trigger create/open nothing.

Up/Down and Tab/Shift-Tab traverse visible controls in visual order, including
surrounding rows and inline actions; Enter/Space activates the selected control.
Herdr's own Tab binding moves native focus before a mod hears the key, so Roster
binds Tab and Shift-Tab to actions of its own under its `Roster` key context.
Tab at the last control and Shift-Tab at the first hand on to native focus traversal
(the window's next or previous tab stop) without wrapping or forcing terminal focus.
GPUI also clicks a focused trigger on Enter or Space; that click is ignored once
after the key already activated it, so Enter on the + after Esc reopens the form.
The real path input keeps its editing keys and Enter checks the path; Tab leaves
it. Focus is requested after mounting; editing-key ownership starts only on an actual
focus event. Reopening with Enter after Esc also requests the field when the exact
current machine trigger holds focus; another control or pane does not authorize it.
Failed requests leave sidebar keys usable. Home/End and PageUp/PageDown read the panel's scrollable content when the input
is not editing. Esc closes the panel and focuses the exact surviving trigger via
its retained native focus handle; if the target disappeared, Projects is the stable
fallback. Automatic target removal returns focus only when a native focus handle
or the input's actual focus event says Roster holds the keyboard; visual selection
alone never authorizes taking focus from a terminal. Native keyboard routing,
input Esc propagation and focus return still require final Windows validation.

Panels preserve group folds, list handles and stable row containers. Opening Details
or a folder form requests a minimal reveal of its owning direct list child after
render, plus its first inner control (a remote form's focused path field). Herdr runs
a task started from render at once, inside render, where `cx.notify()` throws: the
post-render task awaits once before it reveals, redraws or requests focus. Already visible children stay put through the
supported ScrollHandle API; close adds no compensating jump. Other viewports retain
their offsets. Actual external Space selection changes reveal promptly from a
post-render task, including return from Projects/Status and a changed drawn position
of the same active Space. Folds, unrelated refreshes and panel layout changes do not
request a selection reveal. Changes observed during inspection are consumed without scrolling
and are never replayed when a panel closes. Details and
the folder form use a bounded 112px internal vertical scrollbar (96px for pinned
Details); the folder form shrinks (to 60px at least) so it fits the visible list with
its machine header, measured with `on_size_change` (window px, divided by the zoom). In a
list too short for both, the form becomes its own list row, at most the list's height, and
revealing it shows the focused path field while the header may scroll off; Options retains its 52px viewport. Long values/actions wrap, with invisible
wrap opportunities in tokens longer than 24 code points. Accessible labels and
native action arguments retain the original text. These are compact-layout provisions,
not evidence of native fit or Unicode shaping. No new screenshot is claimed.

A panel binds to the exact current projection instance and observed terminal
incarnation/process/run and observed machine identity/availability, including a
currently absent machine record. Folder actions require the exact unique ready
machine (null means this computer). A remote machine named `local` has a separate
key. Removal, replacement or an observed availability change hides an open panel
and cancels its state in a subsequent event/task. Opening a new read-only inspection
of a currently unavailable row is permitted. Ambiguous raw occurrences show an
explicit Details-unavailable reason instead of a focusable Info trigger. View/filter/fold changes close Details;
unchanged refreshes do not. Old action callbacks recheck the panel owner, current
machine, path and proof. Existing Space actions recapture the model and reject a
changed target. Late picker/check answers cannot enter a replacement panel.
The public machine API supplies no durable Core/reconnection identity, so no claim
is made about an unobserved disconnect/replacement between host snapshots. Native
commands remain the final authority; unsupported identity facts are never invented.

## Needs you reminders and sound

When a session starts needing you, Herdr itself plays its `blocked` sound and, unless you
are looking at that session, posts a toast. Roster adds a reminder for as long as
something is still waiting:

- **On a new arrival** in Needs you the bell pulses once (about 2 seconds, then still).
- **Every 2 minutes** after that, while Needs you is not empty, the bell pulses again
  and Roster plays its chime. A new arrival starts the 2 minutes again; reminders stop as
  soon as Needs you is empty. Sessions already waiting when Roster starts make no sound
  then; their first reminder comes 2 minutes later.
- **No reminder while you are looking**: when Herdr's window is active and the focused
  terminal (or the one a pane or agent block shows) is the pending session, the reminder
  is skipped and the next one is 2 minutes later. With several sessions pending, looking
  at one does not silence the others.
- Nothing on the rows moves, and Roster posts no notification or toast of its own:
  Herdr's toast stays the only one. A remote session reminds the same way; the chime
  plays on this computer.
- **One sound per event, however many Roster copies are open.** The copies Herdr runs
  from this mod share one reminder timer, so an arrival or reminder sounds once while every
  copy's bell pulses, and closing or opening a copy neither loses nor replays a sound. The
  timer knows how many copies are open, because Herdr tells each copy when it closes: a copy
  that opens while none is open starts silently, as Roster does at start, and one that opens
  beside another changes nothing, so a reminder that fell due while the computer slept still
  sounds once. Not verified in a running Herdr: that every copy that goes is told so (after
  a missed one, the next Roster to open once all had closed would go on with the old timer
  instead of starting silently: one pulse or chime as it opens, never two for one event), and
  whether two Herdr windows can run separate copies of the mod that cannot see each other,
  which would each sound.

**Options › Sound** has three values (activate the entry to move to the next):

| Sound | Arrival | Every 2 minutes |
|---|---|---|
| **Reminders only** (default) | Herdr's `blocked` sound, as before | Roster's chime |
| **Arrival and reminders** | Roster's chime | Roster's chime |
| **Off** | Herdr's `blocked` sound, as before | nothing |

With **Arrival and reminders**, Herdr still plays its own `blocked` sound too, so you
would hear the arrival twice. To avoid that, point Herdr's needs-you sound at a short
silent MP3 in your own `~/.config/herdr-app/settings.json` (personal configuration,
not part of this mod): `"sounds": { "enabled": true, "blocked": "<silent file>.mp3" }`.
Herdr's `done` sound and its toasts are unchanged.

**How to mute:** Options › Sound › Off silences Roster and leaves Herdr as it was.
`"sounds": { "enabled": false }` in Herdr's settings mutes all of Herdr's alert sounds
(including `done`), and Roster reads that setting and stays silent too, whatever Sound
says (the entry then reads "muted in Herdr"). Options › Motion › reduced keeps the bell
still; the chime still follows Sound. Both choices are kept in this mod's `localStorage`.

**The chime** (`sounds/chime.mp3`, 0.9 s, about 10 KB) is original to this repository
and under its MIT license, like the rest of Roster's own work. It contains no samples:
`roster/tools/make-chime.mjs` computes it (two sine notes, A5 then E6, with a soft
overtone and a decay) and writes a WAV, and `roster/tools/make-chime.ps1` encodes that
with the MP3 encoder built into Windows (Media Foundation). The WAV is the same bytes on
every run; the MP3 can differ with the Windows encoder's version. No third-party sound,
encoder or library is bundled.

**Limits, not verified in a running Herdr yet:** whether `playSound` itself honors
`sounds.enabled: false` (Roster checks the setting first, so it does not depend on that);
that `playSound('mods/roster/sounds/chime.mp3')` resolves against Herdr's home and plays
this file; how loud it is next to Herdr's sounds; whether `focused()` reports a remote
session's address in the same form as `terminals()`; and the live acceptance (one
arrival heard exactly once, a reminder heard and seen after 2 minutes, a second arrival
resetting the timer). Herdr does not tell a mod which session a toast was suppressed
for, so the "looking" rule above is Roster's reading of `window().active` and
`focused()`, not Herdr's own rule.

## Validation and screenshots

Issue #21 was accepted separately; its historical [Windows R3 report](https://github.com/crx-lc/herdr-mods/issues/21#issuecomment-7083288510)
covered runtime `929d85903dc0b32e2fe05b4b98e8d258c63b7f74`. The repository's preview PNGs
retain that historical neutral Windows capture provenance. They do not show these
inline changes. Native navigation/Spaces polish subsequently merged in PR #26;
this candidate does not infer Windows acceptance for #29 from either earlier result.

**Issue #29 Windows validation is pending on the final candidate.** Linux Node tests
and a package inventory do not prove GPUI geometry, pointer hit testing, focus,
scroll offsets, native picker behavior or accessibility. No installed App/types are
available in this implementation environment, so App check and typecheck were not run.
At a neutral 330×350 sidebar, record final commit SHA, installed file hashes, Desktop/
Core version, OS scale and zoom; verify at zoom 1 and 1.1:

1. Details is immediately below its exact row in Projects, Status and pinned Needs
   you in all tabs. Test duplicate names, pending echoes and Info/D/footer on listed
   Stale/Unknown, loading/disconnected/missing-machine and unknown-lifecycle rows.
   Unavailable rows explain why actions are disabled; existing live inspections close
   on disconnect/replacement before a new unavailable inspection can be opened.
2. Info/D/toggle/Esc do not focus/open a terminal; row-name activation still targets
   the exact local/remote/pane-less session. Panel actions cannot activate a row.
3. Tab/Shift-Tab and arrows reach surrounding rows and all actions. Check actual
   focus, not selection tint; Esc returns to exact Info/footer/machine +/Options.
   Tab forward past the last and backward past the first must leave Roster through
   native traversal, including from a folder panel; confirm input editing after real
   focus and usable arrows/Enter/Space when input focus fails. Repeat + → input → Esc
   → Enter and verify typing enters the path with root focus false and trigger focus
   true; moving to another control or pane before the task must not steal focus.
4. Scroll a long list; open/close each panel without resetting its offset/folds.
   Open at the bottom main row and third/bottom pinned alert: panel and close/Cancel
   must be visible, with the trigger visible where feasible. Check all three tabs,
   exact owning viewport and no unrelated offset changes. Needs you stays pinned.
   External active-Space changes reveal promptly without a panel; changes during
   inspection must not cause a delayed jump on close, refresh or the next timer.
   Change selection in both Projects and Status, return to Spaces, then insert/reorder
   above the same active Space: reveal promptly once at its fresh position. Folding,
   unchanged refresh and opening/closing panels must not cause unrelated jumps.
5. Read long names, paths, URLs, multiline/Unicode facts and Technical details;
   use both internal scroll and keyboard reading without horizontal clipping.
6. Local/remote folder target and validation are visible. Expand/toggle/Cancel/Esc,
   including Esc in the input/native picker, create nothing. Test explicit verified,
   unverified-confirmed, existing and duplicate actions; check the exact machine/path.
7. Remove/restart a target, filter/fold/switch tabs, disconnect/remove a machine and
   deliver a late picker/check result. Panels close without rebinding or stale actions;
   focus falls back safely without stealing terminal input.
8. Open each panel from every other kind; only one remains. Confirm native Herdr
   dialogs retain their behavior. Record screenshots, actual focus/scroll observations
   and failures per state. UIA/Narrator remains the separate #28 tracker.

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
The delegation reader never reads another machine. Other remote reads follow D8 (see
Modules, data sources and limits). There are no runtime hc commands,
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

**Remote reads follow the owner's D8 rule** ([crx-lc/herdr-agents#141](https://github.com/crx-lc/herdr-agents/issues/141)):
Roster reads another machine only while Herdr reports it ready, checks readiness again
from a fresh `machines()` immediately before each remote call (each individual Git
command and each os-release read, one at a time) and again on the answer,
skips stopped, disconnected or unknown machines, drops queued work for a machine that
stops being ready (whichever tab is shown, including a machine that drops out of
`machines()`), sends no further command once readiness is lost, a command fails or
returns a malformed or unexpected result, or the job's deadline passes, and shows the
whole answer as **Unknown**, never partial. Git's own "not a git repository", a detached
HEAD and a branch with no upstream are known answers. Nothing is retried
through a reconnect or another path; a later read waits for the normal schedule while
the machine is ready. **Limitation:** this narrows the window, it does not close it. A
Core can stop between the check and the call, and a read that reaches a stopped Core may
start it; until the host offers an attach-only read
([herdrdev/herdr-app#1441](https://github.com/herdrdev/herdr-app/issues/1441)) this is
**not a no-wake guarantee**. The rule covers the Spaces probes: `/etc/os-release` through
`readTextFile(path, { on })` and the read-only `git` queries through `exec`, including
the folder check in "Open folder as Space…". The delegation reader below stays local-only.

Terminal row icons: each row's one leading icon comes from Herdr's own program table
(the `program` Herdr reports for the terminal), never from a tab title, name or role.
Agent and program icons (Claude Code, Codex, Antigravity, the Watcher's and Supervisor's
entries, other shells) are Herdr's shipped files in `icons/` of Herdr's home, drawn by
reference and not bundled here; their notices are Herdr's (`icons/LICENSES.md`). Roster
ships two original glyphs, `icons/bash.svg` and `icons/powershell.svg`: a generic prompt
in each shell's customary color, not either project's logo. An unknown program gets the
neutral `icons/terminal.svg`. Motion is limited to the Working header icon and the short
pulses of the Needs you bell (`reminders.js` decides when); Herdr does not report a system reduced-motion preference, so
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
sorted, repository-relative paths of the 52 installed-folder files that would
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
