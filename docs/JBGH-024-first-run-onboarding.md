# JBGH-024 — First-Run Onboarding

Status: **JBGH-024 OPEN. JBGH-024A CLOSED / PASS (2026-10-22).
024B storage/runtime configuration and persistence is next.**

JBGH-022 and JBGH-023 remain CLOSED / PASS. Onboarding prepares the host and
hands off to the existing wizard. It does not replace provisioning, ownership,
consent, preflight or lifecycle contracts.

## Milestone boundaries

| Slice | Scope |
| --- | --- |
| 024A | Read-only host readiness, environment discovery and readiness screen |
| 024B | Reviewed storage/runtime configuration, explicit write verification, approved runtime validation and safe persistence |
| 024C | Broader first-run integration using the persisted host configuration |
| 024D | Clean-machine/profile walkthrough, restart persistence, existing-runtime preservation and milestone closure |

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
a probe file. A reviewed write/cleanup probe belongs to 024B; a warning is not proof
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
024D remains responsible for the full clean-machine/profile/restart walkthrough.
JBGH-024 remains OPEN.

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
configuration and clean-machine/restart acceptance remain 024B–024D work.
