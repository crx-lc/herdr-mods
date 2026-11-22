# Pure module API reference

The following contracts describe the merged R1–R4 functions. Runtime acquisition,
production defaults, current scope and acceptance limits are in [README.md](README.md).

## Pipeline and exports

```js
import { normalizeApp } from './normalize.js';
import { resolveIdentities } from './identity.js';
import { enrichMetadata } from './metadata.js';

const observation = { observedAt: 100000, refresh: 'success' };
const record = normalizeApp({
  address: 'edge/t7', state: 'live', created_ms: 100,
  status: 'working', labels: { 'herdr.role': 'developer',
    'herdr.project': 'sample', 'herdr.issue': 'example/repo#8' },
}, observation, 100000);
const identified = resolveIdentities([record], [{
  alias: 'edge', id: 'core-b', verified: true,
  source: 'machine-list', hostLabel: 'build-host',
}]);
const { rows, rejectedConfig } = enrichMetadata(identified, {
  projects: [{ id: 'project-7f42', displayName: 'Sample project' }],
  projectBindings: [{ coreId: 'core-b', token: 'sample', projectId: 'project-7f42' }],
});
// rows[0]: Developer #8; GitHub from label:herdr.issue;
// project-7f42; build-host; Context unknown; live/current/working.
```

`normalize.js` exports three adapters `(record, observation, now)` returning a
normalized record or `null` for an invalid routing address:

| Export | Source shape | Optional labels/incarnation | Status input |
|---|---|---|---|
| `normalizeApp` | One App `terminals()` snapshot record | labels / created_ms | plain word |
| `normalizeCompact` | One `hc ls --all --json` compact entry | always unavailable / null | plain word |
| `normalizeFull` | One optional full Terminal record | labels / created_ms | object with state |

These adapters do not acquire data and do not claim to validate the complete
upstream schema. They select only needed facts. Do not cast compact entries as
full Terminals or query children with caller-bearing `get` to fill their gaps.
Use explicit adapter selection, never automatic shape guessing.

Records accept exact `tN` or `alias/tN` addresses (N lowercase base-36, nonzero first digit), state
`live|finished`, parent string, name string, created_ms/finished_ms/status_ms
(nonnegative safe integer milliseconds), and optional labels. Only the four
`herdr.role/project/issue/pr` labels are retained. Invalid optional label keys are
retained in `invalidLabels`; commands, directories, report messages and other
private fields are discarded. Text is trimmed and bounded to 1024 characters;
control characters and nonstrings are rejected. `parentMalformed` preserves an
invalid reference as a condition without retaining arbitrary private content.

`observation` accepts `observedAt`, `refresh: success|loading|error`,
`connection: offline` when explicitly known, `startedAt`, `loadingLimitMs`
(default 15000), `ttlMs` (default 90000), `present: false` for an absent retained
observation, `localAlias` (default empty/local), and explicitly supplied
`tabTitle`/`tabNamed`. For full records only, `parentNamespace: {alias, source}`
can assert the supported namespace of bare parent references. `alias` must be
an exact verified mapping alias (empty means local), and `source` must name the
caller's supporting evidence. Missing/invalid assertions leave bare full parents
unresolved. Supplying this field is a caller assertion, not source verification
performed by these modules; never fill it from the record's routing prefix or
the newest observation. `now` is mandatory for a current freshness claim.
`freshness(observation, now)` is also exported. Offline takes precedence;
loading expires; error/expiry/absence yields stale when prior evidence exists,
otherwise unknown. Future/missing timestamps are unknown. Layout unavailable
alone is not offline. status_ms never controls freshness.

Normalized output includes source, exact address, localAlias, parentNamespace, parentReference,
name/tabTitle/tabNamed, labels/invalidLabels, incarnation, lifecycle,
rawStatus, appStatus, freshness, observedAt, statusChangedAt and provenance.
Lifecycle and freshness are independent. Contradictory finish timestamps yield
unknown lifecycle. `done` is a status of a live session, not a finished session.
Recognized raw words are working/blocked/done/idle/error. Only a current live
record can expose working/blocked/done/idle as `appStatus`; all other cases use
unknown. No missing row becomes a fabricated finished session. Caller supplies
retained observations explicitly; these modules maintain no history.

Small validation helpers `object`, `list`, `text`, `stamp`, `tuple` and
`addressParts(value, localAlias)` are also exported for the other modules.
`addressParts` returns `{alias, terminalId}` or null; `tuple` serializes an array
with JSON so delimiters in identifiers cannot collide.

## Identity and parents

`normalizeCores(entries)` accepts verified assertions
`{alias, id, verified:true, source, hostLabel?, name?}`; empty alias means local.
It drops unverified/invalid entries. `resolveIdentities(normalizedRecords,
coreEntries)` returns new sorted rows. Call it only on adapter output.

Each row adds `terminalId`, `terminalKey`, `associationKey`, `core`,
`identityResolution`, `identityEvidence`, `metadataConflict`, `metadataEvidence`
and `parent`. `core` has id/alias/verified/source/hostLabel/name plus sorted
`evidence` of assertions matching the routing alias. `source` is reconciled only
within that alias: different sources on different aliases are legitimate. For a
verified identity, sorted `displayEvidence` contains every verified assertion
for its core ID, including aliases without observations and assertions on an
ambiguous alias. Each display field is retained only if all those assertions
agree; a missing value is null and disagrees with a present value. All missing
values stay null without a conflict. `conflicts` names disputed source or display
fields. An unverified or ambiguous routing identity has no core-wide display
evidence or verified display facts. Core input order and observation timestamps
never select display facts. Verified
terminalKey is JSON `["core",coreId,terminalId]`; provisional keys are
`["provisional",alias,terminalId]`. Never persist provisional keys as verified
identity. Association keys are JSON `[terminalKey,createdMs]` and exist only
with verified core and known incarnation. Terminal mappings must match that
incarnation; core rebuilds must have a different core ID. If recovery does not
supply a changed incarnation, these modules cannot prove session continuity:
the caller must invalidate sensitive associations rather than claim recovery
verification. Do not transfer mappings by alias, hostname, title or model.

Aliases of the same verified core/terminal/incarnation collapse. Different
incarnations remain separate evidence rows. Missing incarnation does not merge
with a known one. Conflicting aliases for a core produce provisional identity.
The newest observation provides routing; ties use address, source, then serialized normalized facts.
`identityEvidence` retains all source/address/time observations. Differing
metadata (including unavailable versus present labels) blocks metadata claims;
lifecycle, raw status and freshness are reconciled independently. Agreement on
live or finished survives a disagreement in another dimension. Lifecycle or
freshness disagreement makes only that dimension unknown; raw status
disagreement suppresses effective activity. `lifecycleConflict`,
`freshnessConflict`, `statusConflict` and `statusEvidence` expose each dimension.
Effective `appStatus` requires agreement on a current live observation and its
activity across all observations; fresh plus stale live/working stays live,
but freshness and effective activity are unknown. No older record fills a
newer session's labels.

`resolveIdentities` is not a supplemental-data join. Before combining current
richer observations with compact history, callers must exclude compact entries
already represented by current richer observations using verified core/terminal
identity at the acquisition boundary. For example, App `t7` on `core-a` with
created_ms 100 and compact `t7` on that same verified core represent overlapping
current evidence: keep the App observation and omit the supplemental compact
entry from that combined set. Keep a distinct finished compact `t9` as history
when it is not represented. A shared raw `t7` on another core is not overlap.
When overlap or incarnation cannot be established safely, callers must handle
the returned ambiguous/duplicate-incarnation evidence without duplicate UI or
navigation rows. Do not merge null incarnation into a known session, copy labels
across them, or treat this module as solving history acquisition. Later feed and
projection stages own that decision, including conservative treatment of reused
IDs and uncertain recovery; these pure identity functions do not implement a feed or UI.

`parent` exposes key/associationKey/resolution/reference/source and `evidence`
for every observation (reference, source, address, observedAt, namespace,
qualified target key and qualification resolution). Each observation is qualified
before comparing semantic targets. Bare App and compact listing parent IDs refer
to that observation's localAlias (the viewing namespace). This follows the pinned
public `terminals()` contract and App source described below; it is not based on
the remote record's core alias. The bare-parent namespace of optional full
records is not established by the available evidence: require the caller's
supported `parentNamespace` assertion or leave it unresolved. Qualified references
use only verified aliases. A hostname or raw remote prefix is never guessed.
Different qualified targets conflict even when raw strings match; equivalent
references through verified aliases may agree. Any unresolved observation blocks
a verified edge even when another observation has a known target. Conflicting
absent/present references also block an edge. Routing freshness never chooses
the namespace. A unique target must
have known incarnation no newer than the child's. Resolutions include none,
verified, unresolved, ambiguous, orphan, malformed, conflict, self,
incarnation-unknown and cycle. Nonverified edges have null keys. All edges in a
cycle are cut; traversal is iterative and bounded. Original reference remains
available. Lifetime parent references cannot prove active assignments or
historical parent incarnations; no delegation semantics are produced here.

## Metadata and explicit configuration

`normalizeConfig(input)` returns new projects/projectBindings/contexts/
processProviders/projectProviders arrays plus `rejected` entries `{field,index}`.
Missing/nonarray collections are empty. IDs/tokens use 1–128 ASCII letters,
digits, dot, underscore or hyphen, starting with a letter/digit. Invalid array
entries are rejected, not partially applied. No persistence or icons are handled.

`enrichMetadata(identityRows, rawConfig)` returns `{rows,rejectedConfig}`;
`rawConfig` always has the shape below, even if previously normalized.

| Collection | Entry |
|---|---|
| projects | `{id, displayName}` |
| projectBindings | `{coreId, token, projectId}` exact core/project token |
| contexts | `{coreId, id, label, source: verified|explicit-map, exclusive:true}` for an asserted single-context core, or `{coreId, terminalId, incarnation, id, label, source}` |
| processProviders | `{coreId, terminalId, incarnation, provider}` |
| projectProviders | `{projectId, provider, applicable:true}` |

Provider is `github|azure-devops`. A multi-context core without exact terminal
assertions stays Context unknown. Terminal assertions override core defaults;
conflicting assertions at the same scope remain unknown. Machine/core identity
and hostLabel remain separate from executionContext `{id,label,source,evidence}`.
Viewing host, SSH login, LLM family/model and GitHub login are not evidence.

Metadata adds role/roleSource, displayLabel, workItem/workItemResolution/
workItemEvidence, project, executionContext, providerBadge. Accepted roles are
coordinator/planner/developer/reviewer/watcher/supervisor. Only validated labels
establish roles. Known tasks format Planner #12, Developer #8, Reviewer PR #9.
Unknown role uses meaningful explicitly named nonnumeric tab title, then the
terminal's core name (`name`), verified core display name, then exact address.
All of that fallback is display only. No role is inferred from the title.

`parseWorkItem(value, kind='issue')` returns provider/repositoryIdentity/kind/
numberOrId/reference or null. Supported full references are `example/repo#12`
(the field determines issue versus PR), exact HTTPS github.com owner/repo
issues/N or pull/N, dev.azure.com organization/project/_workitems/edit/N, and
organization/project/_git/repo/pullrequest/N. N must be a positive safe integer.
URL query/fragment suffixes, bare numbers and other hosts/shapes are unknown.
For ADO work items, repositoryIdentity denotes organization/project scope; a
work item need not belong to a Git repository. No ADO service is contacted.
Both issue and PR fields together are conservatively conflicting, even when
one is malformed. Valid candidate task evidence remains available.

Project `{id,displayName,source,resolution,evidence}` comes only from an exact
verified core/token binding with one project definition. Equal tokens, names
or shared Space never merge projects. Multiple bindings/definitions conflict;
missing binding stays unbound. An unlabeled child may inherit a verified
parent's known membership with parent association provenance. Invalid,
conflicting or explicit unbound child metadata never inherits. Explicit child
membership conflicting with its parent retains its own ID, marks
parent-conflict, and does not silently change projects. Renaming displayName
preserves ID and exact pair bindings across cores. Unassigned is display text,
not a persistent project ID.

Provider precedence is a validated linked work item, exact process mapping,
then explicitly applicable project default. Malformed/competing task evidence
blocks defaults. Conflicting process mappings block project fallback. Mixed
GitHub/ADO tasks retain their own provider. Unknown is null/unbadged.
`providerBadge` has id/source/accessibleName. Provider never comes from an LLM
family. Raw labels, invalid keys and metadataEvidence remain on rows for later
consumers to explain unresolved metadata.

## Evidence, limits and verification

Contracts use the [official manual](https://github.com/herdrdev/herdr-app/blob/317e673f1f1568b876cbaa0b41dabeb9153ecbea/defaults/AGENTS.md)
and [public types](https://github.com/herdrdev/herdr-app/blob/317e673f1f1568b876cbaa0b41dabeb9153ecbea/defaults/herdr.d.ts)
pinned at App commit `317e673f1f1568b876cbaa0b41dabeb9153ecbea`, plus hc
0.1.21's CoreInfo/Terminal/Status/MachineView schema and the compact-list
observation from the #4 design. The public `terminals()` documentation describes
the listing contract with viewing-local bare parents. Inspected App
[`live_for` and its parent-address test](https://github.com/herdrdev/herdr-app/blob/317e673f1f1568b876cbaa0b41dabeb9153ecbea/src/hc.rs)
rewrite prefixed parents and preserve bare `t7` on a remote `beta/t6` record.
These support the App/compact viewing-namespace rule. No inspected hc core/get
implementation establishes full-record bare-parent behavior; it remains unknown
without caller-supplied evidence. This is source/schema evidence, not evidence
about an installed Windows App. No new network sources, packages or assets.

Run `npm test` at repository root. Neutral fixtures cover the three source
shapes, identity and incarnation collisions, parents/cycles, metadata conflicts,
project renames, mixed providers, contexts, lifecycle/freshness and immutability.
Pure module fixtures do not prove rendering or live behavior. See README.md for the current sidebar adapter and remaining acceptance gaps. Pure projection/filtering, settings and icon helpers are documented below.

## Private settings and local icons (R4 / #7 helper contract)

`settings.js` exports `parseSettings(raw)`, `readSettings(host)` and
`setProjectIcon(host, projectId, assetOrNull)`. The v1 document uses the R1
configuration collections unchanged, with an `icons` array. A neutral example:

```json
{"version":1,"projects":[{"id":"project-a","displayName":"Sample"}],"projectBindings":[{"coreId":"core-a","token":"sample","projectId":"project-a"},{"coreId":"core-b","token":"sample","projectId":"project-a"}],"contexts":[],"processProviders":[],"projectProviders":[],"icons":[{"projectId":"project-a","asset":"sample.svg"}]}
```

Only stable project IDs select icons. Renames and explicit bindings across cores
retain the mapping. Clearing it never deletes an asset. Unknown projects, invalid
names, malformed JSON, unknown versions and invalid configuration fail without
writing. Documents are capped at 262144 characters and each collection at 1024
entries. Errors include `invalid-settings`, `invalid-argument`, `unknown-project`,
`conflict`, `write-failure`, and `host-failure`.

The future host selects a Roster-specific private App data namespace outside the
repository and installed mod source. It implements `readSettings()` returning the
exact stored text or null for absence, and `compareAndSwapSettings(expected,
next)` returning `ok` or `conflict`. The comparison and write **must be atomic**,
including creation when expected is null; read-then-unconditional-write is not
sufficient. Other results fail. `deadline(promise)` must settle within a bounded
interval even when the operation hangs. A timed-out write may still complete:
reread before retrying. The host must isolate keys, ensure private permissions,
and never log or publish values. No storage adapter or personal data is created
by these modules.

`icons.js` exports `validateIcon(bytes, leafName)` and `iconDescriptor(host,
project, config)`. `readIcon(leafName, maxBytes)` returns `{bytes: Uint8Array,
path}` or fails. The host must reject URLs, absolute paths, traversal and symlink
escapes, resolve the single validated leaf only inside the chosen private Roster
namespace, enforce the byte limit during reading, and return a local renderer path
for that same file. It must prevent replacement/escape between validation and
rendering; otherwise the future view must use an immutable private snapshot. The
host supplies OS-specific path behavior; these modules do not construct paths.
No URL or network operation is supported.

Assets are limited to 256 KiB, with PNG dimensions at most 1024 by 1024. PNG
checks signature, chunk bounds, CRCs, IHDR and IEND, but does not decode image
data or establish native decoder success. SVG is a conservative ASCII static
subset: svg, g, path, rect, circle, ellipse, line, polyline and polygon with
simple geometry, color and stroke attributes; double-quoted attributes only,
no entities, declarations, CSS, references, scripts, events or external content.
Individual SVG tags are limited to 8192 bytes to bound synchronous parsing. SVG width and height, when present, are positive unitless values at most 1024.
Unsupported files fall back. The descriptor always retains name, monogram and
18px suggested size, including when it also contains a validated image path.
The future view must keep the neutral fallback and name present even if native
rendering fails. Native decoding and renderer failure callbacks have not been
verified; these helpers make no such claim. Local assets are not synchronized
across devices. This helper does not provide an App storage/asset adapter.

## Delegation and attention (R2 / #8)

The producer is **herdr-agents**, schema **herdr-agents/delegations**, version
**1**, pinned at [`55c71df91dbd60cf07358bbcaebba5586870fd44`](https://github.com/crx-lc/herdr-agents/tree/55c71df91dbd60cf07358bbcaebba5586870fd44/contracts/delegations).
The published README and `bin/delegation-read.mjs` define validation and live
continuity. This is an independent consumer implementation; upstream source and
fixtures are downloaded only as external verification evidence, not bundled.
No runtime imports or dependencies on that repository exist.

`delegations.js` exports:

- `assessDelegations({text, producer, terminals, machines, lastRevision?, coreId?})`:
  returns `{status:'unknown',why}` or `{status:'ok',revision,assignments}`. Each
  assignment has id/role/project/item/child and state active/ended/unknown, with
  reason/by for ended and why for unknown. Optional unknown v1 fields are ignored.
  Whole-document schema/version/shape/duplicate/revision checks precede every
  continuity check. Producer requires live address/created/pid, launcher root,
  matching run and ready machine; keep is intentionally irrelevant for producers.
  Workers additionally require keep false, matching launch ID, expected parent
  and same core. Unknown core ID is omitted, never inferred from machine names.
  Cross-core v1 children are unknown. Duplicate live child addresses fail closed.
- `consumeDelegations(input, history=[])`: returns `{result,history}` without
  changing input/history. History is an array of `{key,revision}` records keyed
  by producer core (when explicitly supplied), local terminal ID, creation, pid
  and run. Otherwise the routing namespace remains provisional. Preserve the
  highest accepted revision across disconnects, read failures and reconnects.
  Verified aliases share history; unrelated incarnations do not. Callers own
  history lifetime; do not discard an incarnation's history while it can recur.
  `updatedAt` age is informational and has no freshness TTL.
- `readDelegations(host, producer, generation)`: only reads the absolute
  `herdr.delegations` label path, on the machine derived from producer.address
  (`null` for bare/local, remote prefix otherwise). The host supplies
  `readTextFile(path,{on})`, `deadline(promise)` and `generation()`. A deadline
  must settle even if a read hangs; implement it with `cx.timer.after`, never
  `cx.sleep`. The host changes its token on every refresh, disconnect, reconnect
  or discovery-path change. A superseded completion yields unknown, never a
  cached result. Success is `{status:'read',text,generation}`; missing, rejected,
  nontext or oversized answers fail conservatively when acquired/assessed.
  Malformed JSON is rejected by assessment. Text is capped at 1 MiB characters
  (the App additionally enforces its 1 MiB byte read limit); paths at 4096.
- `machineOf(address)` and `qualifyChild(address, producerAddress)` support that
  exact documented routing namespace, without hostname/core inference.

Discovery belongs to the future host: take labeled producers from `terminals()`
and readiness from `machines()`, read separately, then reduce with current live
observations. Reads do not grant current status. On disconnect clear successful
read observations immediately, retain revision history, and acquire new text on
reconnect. Never pass cached pre-disconnect text as a new observation. This
module has no polling, loading UI, producer writes or native actions.

`attention.js` exports `reduceRoster(metadataRows, options={})`. Options are
`documents:[{producer,text,generation?}]`, current raw `terminals`, `machines`,
`history`, optional `correlations`, and `generation` (default null for entirely
synchronous injected fixtures). Omitted, undefined or null current generation
accepts only untagged, undefined or null-generation fixture documents; tagged
documents fail closed. An explicit current generation requires an exact document
token match. Async hosts must supply a non-null generation and matching
acquisition tokens. Old generations produce no waiting. Return
`{rows,targets,counts,assessments,history}`. Every row retains its native fields and adds `roster`; no native status is rewritten.

R1 adapters now accept lowercase base-36 terminal IDs such as `t4z` and `t7a`
as well as existing numeric IDs. Explicit configuration selectors use the same
syntax. Noncompact normalized rows add `process:{pid,run}`; compact rows use
null. Identity resolution retains every observation's process in
`processEvidence`. This does not change R1 identity keys or resolve its
uncertain incarnation boundaries. Delegation joins require all process evidence
to match live pid/run, a unique verified R1 identity, creation time, current live
status, a verified direct parent association and matching explicit core ID.
Without supplied verified core mappings, the low-level reader can assess
continuity but the reducer leaves delegation associations unknown. A mod cannot
manufacture core IDs. Conflicting/old process evidence cannot supply activity to
a new run with the same address or creation time. R1 status and metadata
conflicts remain authoritative. Aliases are joined through R1 identity evidence.

`roster.delegation` exposes knowledge known/partial/unknown, pendingCount,
workingCount, delegates `{id,associationKey,role,working}`, and unresolved IDs.
Knowledge is unknown when required evidence is missing or all outstanding
assignments are unresolved; a mix of confirmed and unresolved delegates is
partial. Counts are confirmed lower bounds when knowledge is partial/unknown. Ended,
finished, reused or R1 done children are never pending; an active idle/blocked
worker can be pending without working. Missing R1 child evidence is unresolved.
Waiting needs an idle Coordinator, confirmed pending assignments and at least
one genuinely working linked agent. An idle parent contributes zero to
`counts.working`; that count measures actual current working agents, including
work unrelated to an assignment. `counts.needsYou` counts actionable targets.

| Roster state | Group | Collapsed label | Expanded semantic icon / tooltip |
|---|---|---|---|
| waiting | Working | Waiting for delegate | delegation-waiting / detail below |
| needs-you | Needs you | Needs you | needs-you |
| child-needs-you | Needs you | Child needs you | child-needs-you |

For waiting, `display.tooltip` and `display.detail` preserve `Waiting for
Developer`, `Waiting for Reviewer`, `Waiting on 1 agent` for an unknown role, or
`Waiting on N agents`. Delegation purpose comes from the confirmed published
`assignment.role`: only `developer` and `reviewer` yield named detail. Missing or
unrecognized assignment roles stay generic, even if child labels or names
suggest a role. A child's missing or mismatching role label never overrides the
assignment; its own R1 row role and metadata remain unchanged. The semantic
icon is a distinct token for the later view to map to an accessible glyph; it is not an App icon API or a bundled asset. The reducer itself does not draw UI.

Own blocked attention wins. Contextual direct-child attention replaces waiting
only on a current idle parent; a working parent retains state working and group
Working while exposing the same blocked-child context. `roster.children`
preserves each verified direct child's
associationKey/address/terminalKey/incarnation. Contextual Child needs you
is not actionable; only the child's own entry appears in `targets`. Inferred
ancestry cannot create a direct child attention edge. Existing R1 verified
parent evidence supports direct-child context, not proof of an assignment.
Null or malformed raw terminal/machine entries supply no evidence. Irrelevant
invalid entries do not invalidate other valid observations; missing required
evidence remains unknown and cannot produce waiting.
Targets preserve exact identity; unverified rows remain explicit via terminalKey
and null associationKey.

Watcher attention remains by default: v1 supplies no suppression correlation.
The optional trusted host assertion has `{verified:true,soleCause:true,source,
generation,delivery,targetDelivery,watcher:{associationKey,pid,run},
target:{associationKey,pid,run}}`. Suppression requires a current non-null
matching generation, identical nonempty delivery IDs, current blocked live
Watcher and target on ready machines, and exact process/association matches.
The host must independently verify the sole cause and delivery relationship;
setting this assertion from names, wording, ancestry or v1 data is invalid.
Missing, partial, mismatched, stale or disconnected evidence retains the
Watcher's entry. Suppression changes only Roster attention metadata/targets.

Run `npm test` for independent neutral regression fixtures. For offline exact
upstream parity, download `bin/delegation-read.mjs` and all
`contracts/delegations/v1/*` at the pinned SHA into a separate evidence directory,
then run `ROSTER_DELEGATION_FIXTURES=<directory> npm test` (or set that environment
variable in the platform's shell). `.tests/pinned-parity.test.mjs` compares full
results with the reference reader and every published world's expected result;
it skips explicitly when those external verification files are absent. No test
fetches anything. The consumer adds conservative duplicate-address and text
bounds beyond upstream parity. No licenses/assets from upstream are bundled.

These pure helpers alone do not prove App rendering, installation, native navigation or workstation behavior. See README.md for the current implementation limits. No settings, Quotr, shipped Agents,
native notifications, input, approvals or lifecycle are changed.

## Projects, Status and local navigation plans (R3 / #9)

`projection.js` and `navigation.js` extend the R1 → `reduceRoster` pipeline.
They accept the actual R2 result; they do not infer assignments, reproduce the
waiting reducer, acquire data, import a host API or execute commands. The pure functions themselves supply no host calls; the sidebar wiring is described in README.md.

```js
import { projectRoster, transition } from './projection.js';
import { moveCursor, actionIntent } from './navigation.js';

const projected = projectRoster(reduced); // default Projects; routes disabled
const state = transition(projected.state, { type: 'view', view: 'status' });
// Reproject with current host assertions to enable local navigation:
const options = { navigation: { generation: 'refresh-7', routes: [{
  associationKey: reduced.rows[0].associationKey,
  coreId: reduced.rows[0].core.id, address: reduced.rows[0].address,
  verified: true, source: 'current-pane-snapshot', generation: 'refresh-7',
  presentation: 'pane', // or explicitly verified 'pane-less'
}] } };
const next = projectRoster(reduced, state, options);
const cursor = moveCursor(next.order, null, 'next');
// Read these independently from the host's current store at activation time:
const current = { state: currentViewState, generation: currentAcquisitionGeneration,
  scopes: currentScopeAssertions }; // scopes defaults to []
const plan = actionIntent(currentReduced, next, cursor, currentNavigationEvidence, current);
// plan.intent is data only; no focus/peek/native command was invoked.
```

`projectRoster(reduced, state?, options?)` returns `{state, binding, instances, order,
counts}`. Input rows must be the unique R1 evidence rows passed through R2.
`viewState(input?)` normalizes state; `transition(state,event)` handles `view`,
`filters` (coreIds/contextIds independently), and `fold` (key/collapsed).
State contains only view, coreIds, contextIds and folds. Fold booleans are keyed
by the exact returned instance key. True collapses; false expands; omitted
uses defaults. Switching, filtering, folding and moving the cursor are pure
operations and emit zero focus, peek, relaunch or native terminal commands.

Projects uses stable project IDs, verified actual parents inside that same
placement, and separate explicit Unassigned groups carrying R1's resolution.
Filtered, cross-project and unavailable parents retain context rather than a
fabricated nesting edge. Orphans, ambiguous parents and cycles remain explicit;
traversal is iterative, including a defensive cycle cut. Projects and parent
rows start expanded; finished roots/children live in a collapsed Done section
under their actual project/parent. A nonfinished branch whose direct parent has
finished is lifted to a placement root, with its exact verified parent retained
in `context.parent`. It is never nested under a guessed surviving ancestor.
This rule also applies through multiple finished ancestors and when history is
expanded: each identity still has only one tree occurrence. A live branch below
a finished child of a live parent is likewise a placement root. Finished-only
history remains collapsed; expanding history never duplicates the lifted rows.
Project folds hide lifted branches; their own parent folds hide their nested
children. Historical parent/Done folds affect history, not lifted live roots.
Filtered parents retain exact context without nesting. Live OSC done stays distinct from finished.
Every fold, including nested Done, has its own key. Flat Status is global Needs you,
contextual Child needs you (when present), Working, Done (initially collapsed), Idle, Offline, Stale, Unknown. It retains
project, parent, host/core and execution-context facts on each row. Loading is
Unknown here, never an infinite spinner. A raw error retains explicit Error
text under Unknown, with native raw status intact; R2 does not authorize an
error attention target or a synthetic permission prompt.

Global actionable Needs you always precedes the trees/groups, unaffected by
folds or filters. R2's contextual Child needs you remains nonactionable with
actual child association keys; it creates no extra attention target or stop.
Own attention and waiting precedence are exactly R2's. Waiting is Working,
contributes zero actual workers, and retains pending/delegation facts. Projects
uses compact waiting only when all confirmed delegate children are visibly
nested under that parent; otherwise it supplies the full R2 detail. Status
always uses full waiting detail. Tooltip/detail and semantic icons remain for
the later accessible view; no animation or GPUI behavior is claimed.

`options.scopes` accepts explicit host assertions `{associationKey, coreId,
verified:true, scope:'core-wide', source}` for the exact incarnation. R1 has no
service-scope field, so role Supervisor alone never proves core-wide scope.
A known project wins over a conflicting scope assertion. Only a unique verified
scope assertion on an otherwise unassigned row puts it in Infrastructure. It
appears once there per R1 identity, never per project. Several real Supervisor
terminals remain separate with core/alias/identity context. Only distinct
simultaneously current, live Supervisor evidence identities on the same verified
core receive `multiple-supervisors`. Finished prior runs, stale/offline evidence,
unknown or ambiguous cores and equal names on different cores do not warn. `health:'unknown'` is intentional:
this stage accepts no health evidence and never turns liveness into Healthy.

Machine filters use `coreIds`, independent of readable host labels; context
filters use R1 `executionContext.id`. Null collection means all; empty means
none; `[null]` explicitly selects unknown core/context. Two cores with one
hostname remain distinct; a multi-context core can be filtered per terminal.
Outside-filter global attention retains project/parent/core/context plus
`outsideFilters` reasons `core-outside-filter` and/or `context-outside-filter`.
Those instances are explanatory and disabled for navigation. Clearing filters
makes a current valid target navigable again; it never silently navigates to
an outside-filter contextual terminal.

Counts are distinct `(terminalKey, incarnation)` evidence identities, never
rendered-instance totals. `all` covers the input set; `filtered` covers matches
before folding; `visible` covers terminal instances actually materialized,
including globally exposed outside-filter attention. `outsideFilterAttention`
covers just that exception. Each has identities/working/waiting/needsYou;
section `counts` uses its own member scope before folds. Working is R2's actual
current working criterion, while waiting is a separate contextual count. A
Working section containing three workers and one waiting Coordinator therefore
has working 3 and waiting 1, not working 4. NeedsYou counts actionable identities,
not contextual parents. Finished Done headers also expose their direct count.

The acquisition caller **must omit overlapping compact history** already
represented by a richer live observation, as R1 requires. Projection cannot
prove that a null-incarnation compact row and a known incarnation are one run.
It preserves those separate evidence identities with `identityDiagnostic`,
disables ambiguous current routes, and does not guess a merge. Counts of such
an unsanitized set are evidence counts, not a claim of distinct real sessions;
do not present them as a confirmed agent census. The regression fixture shows
both this failure boundary and the correctly acquired one-worker result.

Visible terminal instances include row, context, placement, status, display,
outsideFilters and guarded navigation. Deterministic JSON tuple keys include
view, section/tree ancestry and full evidence identity; equal titles, same IDs
on different cores, repeated attention/tree and nested Done cannot collide.
`navigationOrder(instances)` scans actual visible instances, skipping headers,
context-only/outside-filter/disabled rows. First visible navigable identity
wins; repeated instances add no stops. `moveCursor(order,key,direction)` wraps
next/previous locally and returns a key or null, never an action. Unknown old
cursor starts at the first/last current stop. No setAgentOrder call occurs.

`navigationTarget(row,rows,evidence)` requires verified R1 core/incarnation,
current live lifecycle/freshness, a valid current address in identityEvidence,
no competing nonfinished incarnation, and exactly one matching route assertion.
The evidence contract above is a **trusted host assertion**, not verification
performed by this module and not an invented App API. The host must obtain it
from current routing/core and pane observations; never set presentation from
role, parent, title or whether an agent appeared in a filtered list. Invalidate
it on refresh generation, disconnect, reconnect, route/core recovery and pane
changes. The route must match generation/core/association/address/source and
explicit pane or pane-less presence. Bare local routing is preserved exactly;
remote routes keep their prefix; every intention also carries the core ID,
terminal ID, incarnation and association key. The later view may map focus to
supported `pane.focus` and peek to `terminal.peek`, only at explicit activation.
`actionIntent(reduced,projection,instanceKey,evidence,current)` requires an
independent caller assertion `current:{state,generation,scopes?}` at activation.
The projection's `binding` captures canonical view/filter/fold state and acquisition
generation. Absent current state/generation, state mismatch (even within the same
acquisition) or any generation mismatch fails closed with
`projection-state-changed`. The supplied current state must be a plain data
object (ordinary or null prototype). Valid partial states, including `{}`, are accepted: omitted fields
use the same defaults as `viewState`. Supplied fields must be `view` (`projects`
or `status`), `coreIds`/`contextIds` (null or arrays of null or nonempty string IDs,
at most 1024 characters, without surrounding whitespace or control characters),
and `folds` (a plain data object mapping keys to booleans). Unknown fields,
accessors, symbols and malformed shapes fail closed before canonicalization.
Valid state is then canonicalized for comparison, so duplicate filter IDs and
filter ordering do not matter. UI `viewState` normalization is unchanged. The host
must read current state and generation independently from its current store, never copy the saved
projection's binding back as proof of currency. Advance acquisition generation on
every refresh or routing/pane invalidation, and serialize activation with these
reads; immediately before executing a returned plan, revalidate host state and
target. A pure function cannot detect unseen host changes or a host asserting
stale data as current.

After matching that binding, activation rebuilds the projection from current R2
rows, current state, routes and current scope assertions (default `[]`). A vanished
key/identity, changed contextual attention, core/context, parent, placement or
route cannot rely on old `outsideFilters`/`contextOnly` flags. Current scope
assertions are needed for Infrastructure keys. Exact current target checks still
apply; the result is `{enabled,reason,intent}`, with null intent when disabled.
This adds no host calls or external App capability. Reproject after any state or
acquisition change before retrying an explicit action.
No sending, keys, run, kill, keep, label, native status or lifecycle plan exists.

## Local detail presentation

`detail.js` has no native imports or host operations. `rowContext(instance)` keeps
project, verified-parent, machine/route and execution context separate with truthful
unknowns. `machineSummary` abbreviates only the visible row; full machine diagnostics
remain unchanged in reader/hover. `actionReason` owns the existing reason mapping; `detailFields` and
`detailLabel` share it between reader, footer and full contextual waiting hover.
Only `context.parent.displayLabel` can name a parent; route aliases do not prove
hosts, and provider names describe work items/configuration, never an LLM.

`detailPages(fields)` returns ordered `{fieldIndex,fieldId,label,start,end,text,
fieldPage,fieldPages}` source spans. Offsets are UTF-16; pages contain at most
64 code points/three line breaks (CRLF or lone CR/LF). Whitespace is retained; there is no total cap.
Empty fields get a page. Common combining/variation/skin-tone/ZWJ boundaries,
regional-indicator pairs (run parity), emoji tag sequences and CRLF are protected
where feasible without Intl. Oversized graphemes split at the bounded limit to
retain progress; this is not full UAX #29 or a native shaping guarantee.
Concatenating a field's spans exactly recovers its value. Native shaping/fit is
an outstanding Windows check, not established by Node Unicode coverage.

The view captures fields with the exact source instance key as Details at opening,
keeps a separate reader control set, and never activates a row from reader Enter.
D or Info/Details opens; arrows/Previous/Next page; Home/End jump; Esc/Back returns
to that surviving control/reveals its row, else Projects. View/filter/fold/Options
changes close it without origin return; toolbar clicks retain the clicked cursor.
A pending Back/Esc return is cancelled by intervening transitions. No snapshot storage/timers/new route protocol or global keys.
Rows keep four independent visible lines at 64px; machine summary and context
share the last line in equal zero-basis flex columns with independent truncation, and Options uses a fixed
viewport up to 52px with no max_h, retaining existing direct-child indices.
These layout and reveal requests await exact-head native acceptance.
