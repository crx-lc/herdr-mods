# Roster

An explicitly opt-in Spaces, Projects and Status sidebar for Herdr Desktop. Inspect
sessions and choose folders in inline panels while keeping nearby work visible.
Unknown project/Core/context facts remain unknown.

![Roster](preview.png)

[Historical Status preview](preview-status.png). Both PNGs retain the existing real
neutral Windows R3 330×350 capture provenance; neither depicts issue #29's inline
candidate. No replacement screenshot was produced.

## What you see

Theme-colored surface, 12px base type, 5px padding and 3px gaps. Global Needs you
is pinned above a 26px toolbar with Spaces, Projects, Status, a Spaces + and Options.
The rest is a vertical scrolling list. Shared 30px bold group headers precede compact
24px session rows (44px for pending alert rows). Info and child-fold controls are
siblings of the session-name activation. Existing row facts, chips, program/OS icons,
Space avatars and worktree marks retain their design.

Details is a disclosure immediately below its row inside its stable list container.
A 112px internal vertical viewport shows truthful host/verified facts, a separate
Go to terminal action and expandable Technical details. Pinned Details uses 96px so
its triggering row and panel fit together in the pinned region. Labels sit above
full wrapped values; long tokens get invisible wrap opportunities every 24 code
points. Action arguments and accessible labels keep original strings.
Options sits immediately below the toolbar in its existing 52px scrolling viewport.
The folder form sits below its exact machine header/+ (below the toolbar for the
single-local-machine case), showing target machine, chosen/typed path, verification,
explicit Create/Open actions and Cancel. It shares the bounded 112px panel surface,
shrunk (60px at least) to fit the measured visible list under its machine header. In a
list too short for header and 60px form (zoom 1.1 under three pinned rows), the form is its
own direct list row, at most the list's height, so revealing it shows the focused path field.

## How it behaves

Projects (#30, #25): with a readable herdr-agents/projects v1 catalog, registered projects come first, one group
per stable ID and primary repository across Cores, idle ones too; a session joins only through its own machine's
current catalog and its exact herdr.project token, never a name. Fallback groups follow under "Not in a registered
project" in muted 12px headers. A registered header: validated catalog SVG (cached under .cache/icons, read back
before drawing) or monogram on the palette background, the name, "N issues" and "N PRs" totals (partial "≥N",
stale muted, unavailable "–", never a false 0), ⓘ, count, chevron. Issues opens the inline open-issue list (oldest
first, age, exact UTC date on hover/focus, board-status filters incl. No board status and Status unknown); PRs opens
per-repository counts; ⓘ opens Details (repositories, board, Cores). Agent rows end in a 14px status icon instead of
a chip; the echo is a bell that pulses once with the pinned bell on arrival (NeedsYou.arrived), never on a reminder. No catalog: one focusable notice, Spaces as before.


Only one Roster disclosure is open: Details, Options or folder entry. The same trigger
toggles it; Esc closes and returns native focus to that exact surviving trigger, or
a nearby stable Projects control when removed. Actual focus handles/input focus events
control automatic focus return; a visual cursor alone never takes terminal focus.
Up/Down and Tab/Shift-Tab traverse surrounding controls and inline actions; Enter/Space
activates. Tab/Shift-Tab are Roster actions bound under its own key context; at either
boundary they call native focus_next/focus_prev without wrapping.
The real path field retains editing keys only after actual focus; failed focus requests
leave sidebar keys usable. Enter-reopen after Esc accepts actual focus on the exact
current folder trigger as well as the root, never an unrelated control/pane.
Enter in the focused field checks the path. When
not editing, Home/End/PageUp/PageDown reveal panel content for keyboard reading.

Row-name activation keeps the existing exact native session/pane revalidation.
Details open/close never activates a terminal. Folder expansion/toggle/Cancel/Esc
never creates or opens a Space. A local Choose folder uses Herdr's native picker;
remote input/suggestions use exact paths on that machine. Existing bounded read-only
Git checks classify checkout/unverified. Explicit final actions alone call space.new
or select a still-matching existing Space. Unverified creation requires a second
explicit confirmation. Cancelled/late picker/check results never enter another panel.

Keep group folds, retained list scroll handles and stable direct children through
panel open/close. After render, minimally reveal the new panel
through its owning direct list child and first inner control; closing adds no jump.
Reveal external active-Space changes promptly after render, consuming changes during
inspection without replay on close. Return from Projects/Status and real active-row
position changes also reveal; fold, refresh and panel layout changes do not.
Needs you stays outside the scrolling tab list. While it is not empty, the 1s timer
(never render) pulses its bell on a new arrival and every 2 minutes after the last arrival,
reading Herdr afresh when a reminder falls due; nothing pending at start stays silent, and
no reminder while the window is active and focused on every pending session. Options ›
Sound (Off, Reminders only by default, Arrival and reminders) picks when playSound plays
the shipped chime; settings sounds.enabled:false always silences it; Motion stops the pulse.
One timer per mod context (reminders.js NeedsYou, made with the view class), shared by
every copy: the copy that takes an event sounds it, each copy pulses its own bell, a later
copy never replays, and a list from an older read is ignored. It counts the open copies,
from a copy's first draw to Herdr's close(cx) on its view: one that joins while none is
open starts the timer afresh and silently, one that joins beside another leaves it as it is.
No toasts of Roster's own. Bind to actual row
instance/incarnation/process/run and observed machine availability, not a label/index.
Read-only Details may open on currently listed unavailable rows and must explain disabled
actions. Folder admission still requires a unique exact ready machine (null local),
escaping the remote name local separately. Removal, identity/availability change or
view/filter/fold change closes existing panels conservatively. Unchanged refresh preserves it. No render-time panel/cursor/
focus mutation or notify: invalidate after rendering in a task/event. No global
navigation, terminal status/input/approval/lifecycle or native-dialog changes.

## Built from

One self-contained mods/roster folder. main.js wires Herdr and gpui-kit/gpui-base to
view.js; mod.json is place:none, focusable:true. controller/feed retain the tested
normalization, identity, metadata, delegation, attention, projection and navigation
guards. disclosure.js is portable anchor/toggle/focus-return/folder-admission/text logic.
The view owns the shared inline surface and event state. detail.js supplies truthful
facts; spaces.js supplies Space rows, Git/OS caches, folder verification and matching;
reminders.js the Needs you timer, Sound choice and looking rule; sounds/chime.mp3 is
original, generated by roster/tools/make-chime.mjs and .ps1;
all portable decisions accept injected host APIs. layout.js retains explicit selected
Agents-slot opt-in/undo. catalog.js ports the herdr-agents catalog reader (parity-tested on its pinned fixtures);
catalog-source.js reads one catalog per machine (D8 for remote, 5 s deadline, 60 s interval); project-groups.js
builds groups and membership; github.js runs only `gh api graphql` locally with arguments (counts every 5 min,
lists while open, 20 s per call, two at once, .cache/github.json); project-totals.js shapes totals and the list.
No sibling-mod imports or dependencies; GitHub via the person's own gh is the one network source.

The stock adapter exposes native session snapshots and exact navigation, while permanent
Core/project/context mapping and authoritative delegation evidence remain unproved.
Read-only Git/OS work uses exec/readTextFile only on ready machines with fresh readiness
checks before each request and on response, cx.timer.after deadlines and disconnect
cancellation. This is not an attach-only/no-wake host guarantee; no ambient Core probe
is permitted. Native commands own the final machine/path validation.

## Watch out

Herdr starts a cx.spawn task at once: one started in render runs inside render until its
first await, where cx.notify() throws and aborts the rest. Await once before post-render
reveals, redraws or focus requests. Herdr's Tab binding fires before on_key_down, so
bind Tab/Shift-Tab under a key context of your own. GPUI also clicks a focused element
on Enter/Space after on_key_down: ignore that echo once or a toggle opens and shuts.
The test fixture starts spawned tasks synchronously for this reason.

Public machine snapshots expose names/readiness, not durable Core or connection epochs.
Do not invent identity to cover an unseen disconnect/replacement. No Intl/time-zone
assumptions. Runtime files stay hidden; no caches/private state/layout records ship.
No new art/assets/licenses. Existing native folder picker and layout opt-in stay explicit.

Issue #21 acceptance and PR #26 are separate history. Issue #29 requires independent
review, green CI and exact-final-head Windows verification before merge. This Linux
implementation has no installed App/types and cannot claim App check, typecheck,
Windows fit/focus/scroll, native picker behavior or accessibility. Existing preview
provenance stays historical. UIA/Narrator remains #28, separate from this candidate.

## Done when

Run exact npm test and node scripts/roster-package.mjs on the repository copy; the
package allowlist has 57 shipping files. Record baseline/final counts and meaningful
negative controls. Never install into the owner's live home without separate authority.

On the exact final installed candidate, record SHA/file hashes and Desktop/Core/OS/
scale/zoom. At 330×350 and zoom 1/1.1 verify inline placement in every tab including
pinned Needs you, same-trigger toggle and single-open state, exact name/session action,
no open/cancel/Esc actions, actual trigger/fallback focus, logical keyboard traversal,
scroll/fold preservation, long/Unicode text and all folder actions/validation. Remove,
replace, filter/fold and disconnect targets and deliver late answers; no stale state or
action may transfer. Confirm native dialogs remain native. The installed README carries
the full checklist and limits. A portable fake cannot prove native Windows behavior.
