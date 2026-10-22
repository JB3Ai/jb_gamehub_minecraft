# JBGH-024 — First-Run Onboarding

Status: **JBGH-024 CLOSED / PASS (2026-10-22).
JBGH-024A, JBGH-024B and JBGH-024C CLOSED / PASS.**

JBGH-022 and JBGH-023 remain CLOSED / PASS. Onboarding prepares the host and
hands off to the existing wizard. It does not replace provisioning, ownership,
consent, preflight or lifecycle contracts.

## Milestone boundaries

| Slice | Scope |
| --- | --- |
| 024A | Read-only host readiness, environment discovery and readiness screen |
| 024B | Reviewed storage/runtime references, revisioned settings and atomic audit persistence |
| 024C | Durable completion, normal dashboard handoff, fresh-process restart and preservation acceptance |
| 024D (deferred follow-up) | Clean-machine runtime acquisition/installation; excluded from this reference-based onboarding closure |

## 024A API and authorization

`GET /api/setup/readiness` invokes the existing configured admin authorizer
directly, without its audit-writing wrapper. Missing/invalid/non-admin credentials
are rejected before probes. Authorization failures never weaken the REST or
WebSocket guards. No readiness or authorization audit record is persisted.
The `authorizeProvisioning` wrapper deliberately writes an audit row, so using
the same configured authorizer directly preserves the admin boundary while keeping
this assessment observational.

An optional `provider=minecraft` or `provider=minecraft-bedrock` selects provider
requirements. Other query parameters, paths and executable names are rejected.
Remote-host policy is rejected: this slice observes only `hostId: local`.
Other methods return 405. Responses are `Cache-Control: no-store`.

The report contains schemaVersion, checkedAt, platform, aggregate status,
readOnly=true, authorizationGranted=false and configuration/preservation metadata.
Each check supplies id, category, code, status, title, message, optional remediation
and safe scalar details. Configuration reports whether operator-owned roots and
provider profiles exist, managed/attached definition counts and preserveExisting=true.
It is observed state, not a persisted onboarding-complete flag.

No absolute roots, executable/database paths, environment dumps, source manifests,
license records, credentials, process command lines or raw native errors are
returned. Missing/ambiguous observations are never converted into a successful
check. Overall status is the worst child: BLOCKED > WARNING > PASS.

## Checks and their limits

### Windows, privilege and network inventory

One fixed hidden, non-interactive PowerShell query observes process elevation,
native Windows x64, PowerShell 5+ and TCP/UDP inventory capabilities. The subprocess
has a 7-second timeout and bounded output. No request/policy text is interpolated
into a command. No UAC, installation, firewall, listener or execution-policy change
is performed. Unsupported architecture/capabilities or unavailable inventory block;
non-elevation warns because ordinary operation need not run as administrator.

Required endpoints come from trusted `setup.profiles` defaults. No defaults means
ENDPOINTS_NOT_CONFIGURED, not invented ports. Only complete, structurally valid
live TCP/UDP inventory can produce ENDPOINT_OBSERVED_FREE. Transport, port,
wildcards and addresses are considered; IPv6 wildcard behavior is conservative
about dual stack. TCP and UDP are distinct.

Active durable claims produce ENDPOINT_RESERVED / WARNING even when stopped.
Observed occupied ports also warn; preflight continues to reject provisioning
endpoint conflicts. Invalid defaults or an incomplete inventory block readiness.
Onboarding never releases/acquires claims or stops a conflicting process. Free
observations are point-in-time evidence, not reservations or replacements for
preflight/apply checks. Concurrent requests share only in-flight checks for the
same selected provider; later retries always rerun observations.

### Storage and disk space

Only existing operator-owned root references are inspected. No configured root
means STORAGE_NOT_CONFIGURED. Relative/UNC paths, symlinks/junctions and non-directory
components are rejected. Missing roots use their nearest existing ancestor for
capacity/access observations and report STORAGE_CREATION_REQUIRED without mkdir.

**Read-only writability is advisory.** Windows fs.access does not establish ACL
write permission. Access denial blocks; otherwise STORAGE_WRITE_UNVERIFIED remains
WARNING, with an explicit writeTestPerformed=false. The assessment never creates
a probe file. A future reviewed write/cleanup probe remains separate from saving
host references; a warning is not proof
that a future write will succeed or permission to bypass provisioning checks.

Capacity uses statfs.bavail * statfs.bsize with bigint arithmetic, returned as
decimal bytes. The injectable diagnostic thresholds default to 1 GiB minimum and
2 GiB recommended. Below minimum blocks; below recommended warns; meeting the
recommended threshold passes this capacity check. This is not a guarantee that a
particular runtime fits. Invalid threshold ordering fails closed.
Unavailable capacity blocks rather than masquerading as a completed observation.

References: [Windows access limitations](https://nodejs.org/api/fs.html#fsaccesspath-mode-callback)
and [filesystem statistics](https://nodejs.org/api/fs.html#class-fsstatfs).

### Java and Bedrock prerequisites

Provider knowledge stays in provider adapters. Java discovery considers trusted
runtime references, MINECRAFT_JAVA_PATH, JAVA_HOME and bounded absolute PATH entries
(64 candidates maximum). Each discovered regular-file candidate is probed with
exactly `-version`, without a shell, with a 4-second timeout and 16 KiB per-stream
output bound. Java option-injection environment variables are removed for the
probe. No server JAR, world or BDS process is launched. Tests inject the version
probe and never depend on installed Java.

The parser accepts one bounded Java/OpenJDK version line from stdout/stderr and
returns only the sanitized version and major. Invalid, duplicate or failed output
warns without exposing raw output or paths. Java 8/17/21/25 discoveries are reported
without a global Java 21 compatibility rule. Source hash, architecture, license and
profile-specific compatibility approval remain configuration/preflight concerns.

Missing discovered Java warns before provider selection and blocks when Java is
selected. Java source checks inspect required runtime/server files. Bedrock source
checks inspect declared bundle files and entrypoint without launching BDS or
selecting a different version. Missing sources block the selected provider;
unconfigured optional providers warn. Source presence is not cryptographic approval
or complete dependency validation; those checks remain in 024B and preflight.

### SQLite, configuration and existing runtimes

The database check reads only filesystem metadata and the first 16 header bytes
using a read-only file handle. It never opens a SQLite connection, initializes a
database, migrates schema, checkpoints WAL, creates parents or creates sidecars.
Invalid/unreadable files or inaccessible locations block. Missing databases warn.
Readable SQLite headers still report unverified write access; this is not a full
database integrity or concurrency assessment.

Configuration and managed/attached counts are read through existing abstractions.
Existing runtime counts are informational PASS checks and explicitly marked for
preservation. No definitions, claims,
receipts, journals, source files or policy records are modified by assessment.

## Readiness screen

Create server opens the existing setup wizard at its `host-readiness` state. It
asks for an administrator key. Connect first calls the readiness API; setup
discovery is deferred until explicit Continue on a valid PASS/WARNING report.
The UI renders titles, PASS/WARNING/BLOCKED states,
messages and remediation, with capacity/version facts and an aggregate summary.

PASS enables Continue. WARNING enables Continue with review guidance; all later
configuration/preflight checks remain mandatory. BLOCKED, missing, malformed,
inconsistent, loading or failed results disable Continue. Credential edits
invalidate the report. Recheck issues a fresh GET. Generations and AbortController
prevent old responses from unlocking Continue after a newer check, edit or close.

The dialog contains keyboard focus, supports Escape/cancel and restores focus to
Create server. It works at desktop, 390px and 320px with scrollable content.
The key is kept locally during assessment. Explicit Continue hands the verified
key to the existing page-memory administrator connection and loads provider choices;
it does not create/start anything. No key is written to browser storage or URLs.
No readiness result is persisted and no installation consent is inferred.

## Validation and acceptance boundary

Focused tests cover authorization before probes and zero audit writes, disk
thresholds, storage denial/missing roots/junctions, unsupported hosts, malformed
inventory, TCP/UDP conflicts, retained claims, missing/selected-provider Java,
source-path prerequisites, SQLite headers/no sidecars, existing managed definitions,
safe projections, retry/concurrency and fail-closed client Continue behavior.

Browser QA uses the actual built application with a disposable fixture host and
real readiness API, plus clearly identified injected PASS/BLOCKED/stale/malformed
responses for failure-state coverage. No browser request performs a mutation.
Clean-profile browser coverage does not claim clean-machine runtime installation.

024A has no persisted configuration to recover after restart. 024B adds persistence;
Fresh-process restart and preservation acceptance are covered by 024C below.
Full clean-machine runtime installation remains a separate deferred follow-up.

## Future milestone boundary

JBGH-028 — Smart Worlds Framework remains locked after installation and daily
operations work. Baseline: [JBGH_World_switcher PRD](./JBGH_World_switcher.md),
JBGH-SW-001 draft v0.1, dated 19 October 2026. The source document's legacy
JBGH-020 heading maps to JBGH-028; the supplied PRD remains unchanged.
028A must perform repository gap analysis against this baseline before
implementation and revalidate its dated compatibility findings before selecting
runtime builds.
Smart Worlds does not interrupt 024.

## 024A closure evidence — 2026-10-22

| Acceptance | Result |
| --- | --- |
| 024A-01 unauthenticated request | PASS: 401 before probes |
| 024A-02 non-admin request | PASS: 403 before probes |
| 024A-03 authenticated admin | PASS: report with no-store |
| 024A-04 aggregate PASS | PASS: deterministic service/client status coverage |
| 024A-05 WARNING outranks PASS | PASS |
| 024A-06 BLOCKED outranks WARNING | PASS: inconsistent client payload rejected |
| 024A-07 unsupported host | PASS: platform/architecture or unavailable capabilities block |
| 024A-08 storage inaccessible | PASS: denial blocks; accessible storage retains advisory writability warning |
| 024A-09 disk capacity | PASS: configured thresholds, boundary values and bigint capacity |
| 024A-10 Java missing | PASS: warning before selection; selected Java requires discovery |
| 024A-11 Java version sanitized | PASS: stdout/stderr parsing, multiple majors and invalid output rejection |
| 024A-12 occupied TCP port | PASS: warning without binding/stopping anything |
| 024A-13 occupied UDP port | PASS: warning; TCP/UDP/address distinction preserved |
| 024A-14 existing runtimes preserved | PASS: fixtures and real Java/Bedrock tree/table comparison |
| 024A-15 paths private | PASS: no absolute locations in public report/rendered errors |
| 024A-16 credentials private | PASS: no token in DOM text or public errors |
| 024A-17 no new operation | PASS: complete database table comparison unchanged |
| 024A-18 no new claims | PASS: complete database table comparison unchanged |
| 024A-19 no new managed definition | PASS: complete database table comparison unchanged |
| 024A-20 no game runtime launch | PASS: Java version-only probes; no Java server/BDS process or managed listener |
| 024A-21 BLOCKED disables Continue | PASS: reducer/client and browser |
| 024A-22 WARNING permits Continue | PASS: explicit Continue loads options; no approval inferred |
| 024A-23 Recheck refreshes | PASS: fresh GET replaces previous report |
| 024A-24 stale async result ignored | PASS: credential edits, reset and cancelled request coverage |
| 024A-25 keyboard flow | PASS: Enter, Tab containment, Escape and focus restoration |
| 024A-26 390px | PASS: no horizontal overflow |
| 024A-27 320px | PASS: no horizontal overflow |

Validation: lint PASS; focused readiness/setup/authentication tests **134/134 PASS**;
provider/API contracts **5/5 PASS**; production build PASS with the existing CJS
import.meta warning; whitespace PASS. Full suite **568/569 PASS**: the sole failure
is the pre-existing Content Library native Bedrock root assertion, expected 201 /
received 422. It was not fixed or counted as green.

Chromium/Playwright was used because the Browser plugin was unavailable. The real
readiness endpoint ran against a disposable fixture application and the current
Windows host; injected browser reports are separately identified for failure-state
coverage. The native assessment produced warnings as intended, did not add an audit
row, and left the managed target empty. Tests exercised Continue into the existing
wizard, page-memory credential handoff, focus containment/restoration, Recheck,
malformed responses and cancelled stale requests. No mutation request was sent.

Real-host acceptance also mounted the production readiness router against read-only
views of the existing Java and Bedrock acceptance databases, without starting the
full application or running startup recovery. Both `java-023c-live` and
`bedrock-023c-live` remained MANAGED. Every database table, policy bytes, both
managed runtime trees and all 3,038 protected BDS source files compared unchanged.
The authenticated report returned WARNING, discovered Java 21/25/17, and observed
complete TCP/UDP inventory. No game runtime launched or occupied the managed ports.

The disposable QA server was stopped and its fixture cleaned. Private evidence is
retained outside Git without a disposable-path link. No real Java server or BDS
runtime was started or modified by this assessment; Java version-only probes did
run. No runtime install, configuration write, download, license acceptance or
provisioning action was performed.

This closes the 024A readiness boundary only. Full onboarding, persisted host
configuration and clean-machine/restart acceptance continue in the slices below.

## 024B — Storage and runtime configuration persistence

The host-settings step follows readiness and precedes provider selection:
Connect → Host readiness → Configure host → Review host configuration → Save →
Complete onboarding → Continue to GameHub. A later Create server action opens
provider selection. Host Save and server CREATE have separate review and approval
boundaries. Save never grants a provisioning, boot or license authorization.

### Authenticated configuration contract

`GET /api/setup/configuration` uses the same configured admin authorizer as
readiness. It returns a no-store public view: local host ID, current revision,
catalog digest, safe choice IDs/labels, default ports and optional saved settings.
It excludes absolute paths, hashes of individual executables, operator identity,
license material and trusted manifests. GET creates no settings or audit row.

Choices derive from existing operator-owned managed-root and approved runtime
profile references. Root and runtime IDs are stable opaque references; paths and
approved executable hashes remain server-side. A catalog digest binds the entire
reviewed mapping. Changing a root, runtime hash/reference, source or default after
review invalidates the save with `409 CATALOG_STALE`.

The database choice is deliberately limited to `default`, the running GameHub
database. Persisting that reference does not change GAMEHUB_DB_PATH, move an
existing database or abandon its managed definitions. Database relocation needs a
separate reviewed migration; this step does not implement one.

`POST /api/setup/configuration` accepts only:

```json
{
  "schemaVersion": 1,
  "expectedRevision": 0,
  "catalogDigest": "<digest returned by GET>",
  "approved": true,
  "storage": { "rootId": "<approved choice ID>" },
  "database": { "locationId": "default" },
  "java": { "runtimeId": "<approved Java choice ID>" },
  "bedrock": { "runtimeId": "<optional approved Bedrock choice ID>" },
  "ports": { "java": 25565, "bedrock": 19132 }
}
```

At least one runtime selection is required; omit unselected runtime objects.
Unknown fields/IDs, paths, traversal, invalid ports, missing approval and invalid
revision values are rejected. Storage must already exist and be accessible with
at least the diagnostic 1 GiB floor; Save creates no directories or write-probe
files. Database inspection requires the current readable SQLite file. Selected
Java executable or native BDS entrypoint bytes must match their trusted hash;
these checks never run `java -version`, execute BDS, copy artifacts or download.
Bedrock entrypoint presence/hash is reference validation, not approval of a whole
distribution or license. Provisioning still validates the full approved bundle.

Complete Windows x64 TCP/UDP inventory is required. Occupied default ports produce
visible warnings, without stopping listeners, binding sockets or acquiring claims.
Storage writability remains advisory and is also reported as a visible warning.
Existing approved setup profiles remain authoritative for server CREATE endpoints;
stored host preferences do not rewrite their pinned targets, ports or approvals.

### Persistence and concurrency

SQLite schema v11 adds only `setup_configuration`. A repository abstraction
separates the service from SQLite. The stored record contains schemaVersion,
hostId, revision, updatedAt/updatedBy, selected root/database/runtime IDs, default
ports, catalogDigest and configuredEnoughToProceed. It stores no license decision.

`BEGIN IMMEDIATE` encloses a fresh revision comparison, the settings update and
one `setup.configuration.saved` audit insertion. Audit failure rolls back the
settings update. Workers cannot overwrite a newer revision; stale writes receive
`409 CONFIGURATION_STALE` even when the stale request's values happen to match.
An identical payload at the current revision is idempotent: unchanged=true, no
revision increment, timestamp change or additional audit row. A changed payload
with the current revision increments the revision once. Validation completes
before the transaction, and revision/catalog bindings are checked again at save.

The existing settings remain intact after failed validation. GET never replaces
them with defaults. Runtime definitions, ownership, lifecycle state, claims,
operations, receipts, journals, source artifacts and operator policy are outside
this write path. The schema migration adds the settings table without rewriting
existing provisioning rows; old-schema migration fixtures cover this boundary.

### UI, retries and completion boundary

The wizard renders safe choice labels and port fields. Back preserves input.
Review explicitly states that no Minecraft server is created or started. Save is
single-submit, blocks close while pending, and only a confirmed matching revision
can unlock provider discovery. Configured defaults never substitute for the
explicit later CREATE approval. Occupied-port/write-access warnings remain visible.

HTTP/network or stale-revision errors retain entered values. They require Reload
and a fresh explicit review/save; the client never silently resends POST. Reload
keeps the entered draft for comparison with the latest revision. Generations and
AbortController ignore late GET results after edits, close or recheck. Keyboard
focus and the existing dialog behavior are preserved at desktop, 390px and 320px.

configuredEnoughToProceed describes the saved host-settings revision, not full
onboarding completion. Host Save alone leaves onboarding incomplete; the separate
024C completion record controls the public onboardingComplete flag. The
record must be reviewed again before another explicit completion attempt after
catalog changes; it is never used to bypass preflight. Durable READY is not reset
when a later revision changes. 024C owns completion/handoff as described below;
clean-machine runtime acquisition remains outside this closure boundary.

### 024B validation and preservation evidence — 2026-10-22

Authenticated GET/POST, safe public views, schema validation, current-revision
idempotence, stale writes, competing workers, atomic audit rollback, runtime hash
drift, missing IDs, storage/database/inventory failures and no provisioning effects
have deterministic regression coverage. The original migration tests now drop the
setup tables when constructing an older-schema fixture and expect the latest
schema (v12 after 024C).

Chromium/Playwright (Browser plugin unavailable) exercised the built application
at desktop/390px/320px. Each happy path sent one configuration POST, followed by
provider discovery, with no provisioning/lifecycle mutation. Back preserved input;
stale write and uncertain network response required Reload before explicit retry;
late GET results were ignored. Page identity, meaningful rendering, no framework
overlay, console health, keyboard focus and horizontal overflow checks passed.
A separate fresh GameHub process restored the saved revision from the same fixture
database. The QA host was stopped and its disposable fixture cleaned.

Preservation acceptance used the real operator policy/source references with
isolated SQLite backups of both existing acceptance databases. Only the backup
received schema v11 and a host-settings save/audit. Its provisioning tables stayed
unchanged; idempotence, stale rejection and repository reopen passed. The actual
databases were opened read-only and all tables compared unchanged. Both original
023C managed identities/ownership, runtime trees, real policy and all 3,038 protected
BDS source files remained unchanged. No Java/BDS process launched. No real host
configuration was promoted; acceptance evidence contains no new license event.

Validation: focused readiness/setup/configuration tests **145/145 PASS**; contracts
**5/5 PASS**; lint/build/whitespace PASS. The build retains its existing CJS
import.meta warning. Final full suite **581/582 PASS**: only the known unrelated
Content Library native Bedrock root assertion fails (expected 201, received 422).
It remains out of scope and is not counted as green. An earlier run collided with
the contracts runner on shared fixed port 3310; the final full suite ran without
that competing process and passed that API contract.

JBGH-024B is CLOSED / PASS for the reviewed settings-persistence boundary.
Available choices require existing operator-owned root/runtime references; this
slice does not invent source approvals, acquire runtimes or accept licenses.
Database relocation, actual write-permission proof and real configuration
promotion are not claimed by these fixture/isolated-copy tests. The final milestone
closure and validation counts follow.

## 024C — Durable first-run completion and handoff

`GET /api/setup/onboarding` is an authenticated, no-store, read-only status query.
A fresh database reports INCOMPLETE, configurationRevision=0. No GET inserts a
completion record. Responses omit completedBy and internal paths. Once completed,
the stored READY record supplies the original completedAt/configurationRevision;
the response also reports currentConfigurationRevision and configurationChanged.

`POST /api/setup/onboarding/complete` is admin-only and accepts exactly:

```json
{ "configurationRevision": 1 }
```

Completion requires a valid saved configuration with the submitted current
revision and unchanged trusted catalog binding. It freshly validates selected
runtime references/hashes, existing storage/database and complete Windows network
inventory, then runs a fresh host readiness assessment. It does not reuse the
browser's old readiness report. WARNING can complete; BLOCKED cannot. The selected
runtime checks use bytes/metadata, not Java version commands or native BDS launch.
Provider runtime acquisition, license acceptance and provisioning remain separate.

SQLite schema v12 adds `onboarding_state`, independent of provisioning state.
The configuration repository's completion method uses BEGIN IMMEDIATE to re-read
the configuration revision/binding, insert READY and append one
`setup.onboarding.completed` audit atomically. Missing/invalid configuration or
blocked readiness returns `409 ONBOARDING_NOT_READY`; revision races return
`409 CONFIGURATION_STALE`. Failed audit persistence rolls back READY. Duplicate
completion is idempotent, preserving the original timestamp/actor and audit count.

READY is durable and sticky. Later settings edits, catalog changes or host issues
do not reset it to INCOMPLETE. A repeated completion request must still pass the
current revision/readiness checks, but it does not replace the original completion
record. Revision differences are shown as a diagnostic, not an automatic setup
reset. Normal lifecycle/preflight protections continue to apply. An explicit
re-run/reset operation is not introduced in this milestone.

### Completion UX

GameHub setup and Create server share the existing authenticated wizard shell.
Before a new connection enters first-run steps, it reads persisted onboarding
status. INCOMPLETE follows readiness/configuration/review/save and completion.
Confirmed completion displays:

> GameHub is ready
>
> Host configuration has been saved.
> No Minecraft server has been created or started.
>
> Continue to GameHub

Continue closes setup and returns to the normal dashboard. It sends no CREATE or
start request. A later Create server action on a READY installation skips host
setup and opens the existing provider-selection flow. No configuration save or
completion POST is sent merely because READY was loaded. The dashboard remains
available for diagnostics while disconnected; there is no anonymous onboarding
status endpoint or assumed READY status before administrator authentication.

Saving/completing blocks close while pending. A lost completion response offers
Check completion (GET), so a committed READY response can be recovered without
resending POST. Stale configuration requires Reload and explicit review. Async
generation guards prevent late status/ready responses from changing newer state.
Keys remain in page memory only. No automatic first boot, server provisioning,
license event, policy rewrite or managed ownership change occurs.

### Final milestone acceptance — 2026-10-22

| Gate | Result |
| --- | --- |
| Authenticated GET and admin-only completion | PASS |
| Fresh database remains INCOMPLETE | PASS |
| Missing/invalid configuration or blocked readiness rejected | PASS |
| WARNING and matching saved revision complete | PASS |
| Async configuration race rejected at final transaction | PASS |
| Completion/audit atomicity and duplicate idempotence | PASS |
| READY survives later settings revisions without automatic reset | PASS |
| Desktop / 390px / 320px first-run completion and keyboard flow | PASS |
| READY skips repeated setup; stale async result ignored | PASS |
| Lost committed completion response recovered with GET only | PASS |
| Fresh-process restart restores READY and opens normal dashboard | PASS |
| No provisioning operation, runtime launch, policy or ownership mutation | PASS |

Final focused onboarding/readiness/setup regressions: **152/152 PASS**.
Contracts: **5/5 PASS**. Lint, build and whitespace: PASS. The build retains its
pre-existing CJS import.meta warning. Full suite: **588/589 PASS**; the only failure
is the known unrelated Content Library native Bedrock root assertion (expected
201, received 422). That failure is not fixed or represented as green.

Chromium/Playwright was used because the Browser plugin was unavailable. Six
isolated QA hosts covered first-run desktop/390px/320px, stale completion, a lost
committed response and late-response handling. Normal flows emitted exactly one
settings POST and one completion POST, no provisioning mutations and no browser
errors. A separately started GameHub process restored READY from the same fixture
database; browser acceptance then opened the normal dashboard without readiness,
configuration or completion writes. All QA hosts were stopped and fixtures cleaned.

Real-host preservation acceptance used the current operator policy and real source
references with isolated copies of the existing acceptance databases. Configuration
save, completion, duplicate completion and reopen passed on those copies. The real
databases were read-only: every original table, policy, both 023C runtime trees,
managed identities/ownership and all 3,038 protected BDS source files compared
unchanged. No Java/BDS game runtime launched. No real onboarding configuration or
license record was promoted. Private evidence remains outside Git, without links
to disposable evidence locations.

JBGH-024A, JBGH-024B, JBGH-024C and JBGH-024 are CLOSED / PASS for this boundary.
Clean-machine runtime acquisition, database relocation, actual storage write proof
and player/live game-runtime acceptance remain outside this milestone. Smart Worlds
stays locked as JBGH-028; onboarding closure does not start its implementation.
