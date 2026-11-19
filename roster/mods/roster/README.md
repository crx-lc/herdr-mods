# Roster normalization modules (R1)

This folder contains pure modules for issue #6. It is not an installable mod:
there is no view, manifest, docking, polling, storage, or activation. Later Roster
stages supply those pieces. No Herdr, Node, filesystem, process or network API is
imported. Callers supply JSON-shaped records, current verified mappings and time.
No module reads ambient state or mutates inputs. Unknowns remain explicit.

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

Records accept exact `tN` or `alias/tN` addresses (N positive), state
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
IDs and uncertain recovery; no feed or UI is implemented here.

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
This module stage has no render, install or live behavior pass. Navigation,
delegation/attention/counting, UI/filtering, feed acquisition, private settings,
icons and packaging remain separate work. The full #4 navigation and lifecycle
producer release requirements remain unchanged.

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
across devices. No App integration or view is implemented here.
