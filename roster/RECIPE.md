# Roster

A passive, explicitly opt-in Projects/Status sidebar for stock Herdr Desktop.
The current adapter keeps terminal identities provisional and project/context
associations unknown. This recipe describes the UI repair candidate awaiting native validation, not full
[#4](https://github.com/crx-lc/herdr-mods/issues/4) release acceptance.

![Roster](preview.png)

Real external Windows Projects crop, 240×820, copied byte-for-byte; SHA-256
`60d483878d8436296fb47ce9275d3766b05215bb9080fb435b173557c3eb6790`.
Neutral Coordinator / Developer #42 / Reviewer PR #43 only. This tall sidebar
capture does not demonstrate usability in the default-height Agents slot.

## What you see

A theme-colored sidebar (`surface`/`foreground`, 12px base text, 5px padding,
3px gaps). A 26px horizontal toolbar holds Projects, Status and Options. Options
contains independent Machine/Context filters and selected-slot opt-in/undo controls
in a separately scrolling region with an explicit viewport height of min(52, n×24 + (n−1)×2)px, min_h(0), flex_none and no max_h. Unfiltered singleton dimensions
omit redundant selectors; active filters always retain a reset.

The remaining height is a scrolling row list: 24px group headers, non-shrinking
64px terminal rows. Each has an 18px title/badge line, independent 14px Project
and verified Parent lines spanning beneath badges, and a 14px machine/route and
execution-context line, plus 4px padding. Preserve depth indentation capped at
24px and one direct scroll child per instance. Keep Info and child-fold buttons
as siblings of terminal activation, with that same owner key and rowIndex.
Use truthful Unassigned, Not reported, Unknown (resolution), host unknown and
Context unknown fallbacks. State chips cap at 104px; each row line may ellipsize.
Done starts folded; global Needs you survives filters/folds. Contextual Child
needs you remains nonactionable. Provider badges describe work items/projects.

Disabled selections have a separate readable 16px reason above a 16px summary
and Details (D) affordance; enabled selections use 16px. A layout message uses
16px. Worst fixed normal-list budget is 148px, leaving about 170px at fixed
physical 350px/zoom1.1: plan two 64px rows, a 24px header and two 3px gaps (158px).
Verify actual fit natively; arithmetic is not acceptance. Full contextual row
hover includes waiting, project, parent, provider, route/context and reason.

Explicit Details at opening replaces everything below the toolbar with one
captured, nonpersistent instance snapshot. Display a 24px Back (Esc)/title line,
18px field label, 18px global/field progress, active literal value and 24px
Previous/Next controls, with 4px gaps. Use fresh text, full available width,
whitespace_normal, 12px, line_height(1.25); no clipping/ellipsis/clamp on the value
or ancestors. Pages have at most 64 Unicode code points and three line breaks
(CRLF or lone CR/LF), preserving every UTF-16 source span, whitespace and terminal suffix.
Render only the active page, with no total-length cap or detail-scroll dependency.
Use separate name/project/parent/machine/context/state/waiting/provider/availability/
filter/diagnostic fields. Keep full waiting in expanded compact and hidden-child
modes. Native wide-glyph/blank-line/long-token fit at both zooms is pending.
Production has no admitted authoritative waiting. Stock Desktop 0.1.16 UIA
exposes no mod labels; Narrator was not run, and the reader is no UIA pass.

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
D on a row/Info/fold, or Enter/click on Info/Details, opens the reader.
Left/Up/Previous and Right/Down/Next page; Home/End jump; Esc/Back returns and
reveals the surviving originating control, or selects Projects if its exact
instance disappeared. Never rebind duplicate names. Enter in the reader uses
only reader callbacks. View/filter/fold and Options changes close it locally;
unhandled keys retain host behavior. Never bind global next/previous or call setAgentOrder. Production Open is disabled:
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
`main.js` wires gpui-kit/gpui-base/Herdr to `view.js`. `desktop.js` exposes stock snapshots
and guarded layout I/O. `controller.js` connects `feed.js`, `local-reader.js`,
projection and action guards. Pure modules have no Herdr imports:
`normalize.js`, `identity.js`, `metadata.js`, `delegations.js`, `attention.js`,
`projection.js`, `navigation-rows.js`, `navigation.js`, `settings.js`, `icons.js`,
`detail.js` (presentation facts/reasons/lossless pages), and `layout.js`. Keep the actual reducer chain and independent evidence contracts;
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
`.tests` do not ship. `node scripts/roster-package.mjs` lists exactly the 21 files
that would ship, validates eager import closure, and performs no install/sync.

## Watch out

The `eb1df42` compact-head Windows run reports 31 pass, 5 fail, 4 not verifiable,
isolation 3/3. Its four mod defects were Options scrolling/reveal, clipped
project/parent, no full keyboard text path and waiting-hover context/edge clipping.
Those repairs passed the external 0623d11 retest; the final review corrections
below still need affected exact-new-head native retesting. Preserve
existing real tall preview and old 330×350 crops; never label them new-head proof.
The fifth failure is stock UIA and remains open without a scope waiver. A 108px
Options-only/no-max_h A/B and supported plain overflow_y_scroll fallback are
prepared outside the package for isolated native testing. Final Options cap is
52px to retain the owner's visible machine/context requirement in four-line rows.

Stock snapshots cannot prove permanent Core/remote-epoch binding. Unknown must
remain unknown; do not enable actions, authoritative waiting or private images to
make a demonstration look complete. Host fixtures exercise stronger contracts;
production must not adopt invented fixture proof. Waiting parents count zero
workers; three genuine working delegates count three under admitted contracts.

The original layout file and shipped Agents source are not rewritten by opt-in;
the external Windows report records preservation/restart/undo passes. Keep Quotr,
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

The [external Windows summary](https://github.com/crx-lc/herdr-mods/issues/11#issuecomment-7070369048)
at merged main `10c9d66`, stock Windows 11 / App 0.1.16 / hc 0.1.21, reports
22 checks: 17 pass, 2 fail, 3 not verifiable, and isolation 3/3 pass. Real repo
App check plus two sample-state checks passed with three deliberate-break failures.
Selected-slot opt-in, preservation-first, untouched source layout, byte-identical
undo after restart, chosen-state restarts and Quotr/settings preservation passed.
Sidebar keys/Enter, hover/focus tooltips and static rendering passed; OS reduced-motion
toggle was not tested. Owner 431 config files reportedly remained byte-identical,
list SHA-256 `D349EC390426AF8064D570E897D93201380FCE1EBFE45AF222E802AD72007546`.
Only the posted summary and source crops were supplied, not raw Windows logs;
this Linux worker neither reran native checks nor independently audited those logs.
The source Projects/Status crops stay in private evidence; preview is a share
artifact outside the installed package, with no editing/generation or private mapping
import. The Windows run does not validate the revised checker on macOS; macOS
portability is inferred from Linux linked-ancestor controls. This historical run does not validate the compact runtime changes.

Full acceptance remains open in [#11](https://github.com/crx-lc/herdr-mods/issues/11),
[#10](https://github.com/crx-lc/herdr-mods/issues/10) and
[#4](https://github.com/crx-lc/herdr-mods/issues/4): compact layout validation and the platform accessibility gap remain open under
[#21](https://github.com/crx-lc/herdr-mods/issues/21).
Core-qualified local/remote/pane-less actions, authoritative waiting/delegateWorking,
remote continuity and configured private images remain **not verifiable** due to
#10 proof gaps, not waived. Source pins do not prove installed Desktop capability.
This packaging and tall capture do not establish release readiness or authorize
live activation. This worker executed Node/default/pinned/package checks only;
no App, typecheck, native Windows/macOS, live install/sync or workstation run.

Final review corrections: toolbar/state transitions close Details without origin
return and cancel pending returns; explicit Back/Esc still restores/reveals the
exact surviving control. Machine/route summary and execution context use equal
zero-basis flex columns in the same 14px row line, independently truncated; omit
redundant diagnostic prose there but retain full host-unknown/unverified-identity
text in Details and hover. Route aliases never prove hosts. Protect feasible RI
flag pairs by run parity, emoji tags and CRLF as well as combining/variation/skin/ZWJ
boundaries, within 64 code points/three CRLF-or-lone-CR/LF breaks. Oversized clusters
use bounded lossless fallback; no full Unicode segmentation/shaping claim.
Windows retest at 0623d11 reports 51/1/4 with isolation3/3; these corrections need
affected exact-new-head retesting. Stock Desktop0.1.16 overlay showed toolbar only;
selected Agents-slot opt-in is the tested path. Preserve all existing PNGs.
