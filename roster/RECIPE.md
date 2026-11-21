# Roster

A passive, explicitly opt-in Projects/Status sidebar for stock Herdr Desktop.
The current adapter keeps terminal identities provisional and project/context
associations unknown. This recipe describes the merged implementation, not full
[#4](https://github.com/crx-lc/herdr-mods/issues/4) release acceptance.
No Windows capture is available yet; `preview.png` is intentionally absent.

## What you see

A theme-colored scrolling sidebar (`surface`/`foreground`, 13px text, 6px padding,
4px gaps). Projects and Status buttons precede separate Machine/Context filters,
including explicit unknown options. Group headers fold; Done starts folded.
Rows show display label, observed state, validated work-item provider badge,
Unassigned/project name, host/route and Context unknown. Every project keeps an
18px monogram/name fallback. Open-unavailable reasons remain visible. Global
Needs you stays visible through filters/folds. Contextual Child needs you is a
separate, nonactionable context entry when independently verified ancestry exists.

Hover detail, accessibility labels and a visible selected-control detail provide
context. An independently proven injected waiting parent can show a static ◈
when its delegates are directly visible, otherwise full waiting text. Production
has no admitted delegation evidence and makes no authoritative waiting claim.
The footer offers choosing an existing Agents slot and, in a token-owned working
copy, restoring Agents in that slot. Layout results/refusals appear as text.

## How it behaves

`place:none` makes installation inert. Explicitly show a copy only after authorized
isolated checks; installation instructions are not permission to activate it.
Rendering captures six stock getters once: terminals, machines, panes, spaces,
agents and focused. Only current snapshot observations appear; vanished rows and
superseded incarnations are omitted. No supplementary history is acquired.
Equal names, remote aliases, viewing machine and account/model do not prove identity.
Projects stay unbound and contexts unknown without Core-qualified configuration.

Projects/Status, filters and folds affect this copy. Click focuses it; Up/Down
select a visible control, Enter activates it; `focus` focuses the handle. Preserve
surviving cursor keys and choose a nearby position when a control disappears.
Never bind global next/previous or call setAgentOrder. Production Open is disabled:
no independently bound Core identity, endpoint or uninterrupted remote epoch is
available. Injected tests may prove exact focus/peek plans; that is not a native
capability claim. Native terminal statuses, input, approvals and lifecycle stay native.

Explicit opt-in inspects one current Agents slot, preserves the effective tree,
saves a private restoration record, creates a separate working layout replacing
only that slot, then switches. Undo rereads its record after restart and restores
only the still-owned slot in the latest working tree. Refuse mismatches/concurrent
changes. Two-second UI deadlines do not cancel late native writes; expected-text
writes are not OS-wide CAS. Partial failures can leave files for inspection.

## Built from

One self-contained `mods/roster/`: `mod.json` has `place:none`, `focusable:true`;
`main.js` wires gpui-kit/Herdr to `view.js`. `desktop.js` exposes stock snapshots
and guarded layout I/O. `controller.js` connects `feed.js`, `local-reader.js`,
projection and action guards. Pure modules have no Herdr imports:
`normalize.js`, `identity.js`, `metadata.js`, `delegations.js`, `attention.js`,
`projection.js`, `navigation-rows.js`, `navigation.js`, `settings.js`, `icons.js`,
and `layout.js`. Keep the actual reducer chain and independent evidence contracts;
see `mods/roster/MODULES.md` for data shapes.

Production supplies empty Core mappings, admissions, documents, routes, scopes and
correlations. Thus it acquires zero delegation files, performs zero terminal
actions, and reads no private settings/images. Local-reader admission requires
independent process/Core/continuity proof; only local text reads are allowed with
bounded candidates/bytes, two native slots and `cx.timer.after` deadlines. Never
enable native remote readTextFile: it can start a Core at the inspected revision.
No experimental acquisition reader, runtime hc probe or network request is shipped.

Only explicit layout controls read/write layouts and private App data restoration
records. Never bundle those records or personal assets. No third-party assets,
packages or network sources are added. Source pins in the installed README are
reference contracts, not installed Desktop evidence. Repository-only scripts and
`.tests` do not ship. `node scripts/roster-package.mjs` lists exactly the 20 files
that would ship, validates eager import closure, and performs no install/sync.

## Watch out

Stock snapshots cannot prove permanent Core/remote-epoch binding. Unknown must
remain unknown; do not enable actions, authoritative waiting or private images to
make a demonstration look complete. Host fixtures exercise stronger contracts;
production must not adopt invented fixture proof. Waiting parents count zero
workers; three genuine working delegates count three under admitted contracts.

The original layout file and shipped Agents source are not rewritten by opt-in;
actual Windows preservation/restart/undo behavior remains unverified. Keep Quotr,
other slots/settings and private data intact. Timed-out writes may settle later:
reread before retry. Do not promise automatic cleanup or whole-tree rollback.

Node tests and Windows Node CI cannot prove QuickJS/GPUI layout, focus, tooltip,
accessibility or native image decoding. Herdr check alone cannot see later async
states or actual layout; sample-state checks need an effective deliberate break.
Do not claim any App/typecheck/Windows/visual run without its actual evidence.

## Done when

Repository packaging is reviewable when `npm test`, optional offline pinned
contract parity when available, and the read-only inventory pass, with negative
controls rejecting missing/forbidden files, links and escaping references. Record
actual commands/counts separately from planned workstation checks.

Full acceptance is still open in [#11](https://github.com/crx-lc/herdr-mods/issues/11),
[#10](https://github.com/crx-lc/herdr-mods/issues/10) and
[#4](https://github.com/crx-lc/herdr-mods/issues/4). The separate Windows effort must
supply installed manual/types evidence, real App/sample-state checks plus a failing
control, isolated opt-in/undo/restart and Quotr/settings preservation, native
sidebar focus/accessibility/static presentation checks, and a real neutral
narrow-sidebar Windows capture as `roster/preview.png`. Integrate that capture
with provenance; never generate or substitute it. Core-qualified local/remote/
pane-less actions, authoritative waiting and configured private images remain
unverifiable until their independent proof gaps are resolved. This packaging
alone does not meet those gates or authorize live activation.
