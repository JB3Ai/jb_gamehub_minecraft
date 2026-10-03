# JBGH-022A - Unified Server Provisioning Architecture

Status: architecture proposal; no provisioning implementation delivered.
Date: 2026-10-03. Inspected baseline: `5952519` on `dev/laptop-continuation`.
JBGH-022 remains OPEN. JBGH-022B requires a separate implementation task.

## Scope and baseline

Define a provider-neutral, plan-first contract for creating a managed server or
registering an existing installation. Initial production targets are Java/Paper
(`minecraft`) and native BDS (`minecraft-bedrock`); synthetic planning proves
that core does not depend on Minecraft formats. The first implementation is
single-host, with an explicit host identity so endpoint ownership is unambiguous.

The current [JBGH-021A record](./JBGH-021A-native-bds-live-acceptance.md)
reports CLOSED / PASS, with all 18 live acceptance gates passed on 2026-10-01.
This document relies on that recorded server acceptance; it does not claim a new
laptop runtime run. The older JBGH-021 overview still says acceptance pending;
reconcile that documentation separately rather than changing runtime semantics.

Non-goals: implementing provisioning, downloads, an installer UI, remote agents,
containers, firewall/NAT automation, upgrades, destructive deletion, automatic
EULA acceptance, or changes to FamilyService, rewards, analytics, AI, and existing
Bedrock lifecycle behavior. Existing content import remains a separate approved
pipeline. No secrets or environment files change as part of this milestone.

## Current architecture observations

| Inspected source | Observation and consequence |
|---|---|
| `packages/provider-manager/index.ts` | `GameProvider` already has discovery, endpoints, start/stop/restart, status, worlds, validation, and optional player events. Reuse these. `InMemoryProviderManager` owns operations, audit and event publication. |
| Same file: registry | Providers are keyed by metadata ID; `register` uses `Map.set`. Registering another `minecraft` provider would replace the first. This is not a safe per-server creation API. |
| Same file: server lookup | `getServer(serverId)` searches all providers by server ID. New IDs must be globally unique while existing REST routes remain unqualified. |
| `packages/core/index.ts`, `runtime-config.ts` | Bootstrap explicitly composes Java, Bedrock and synthetic providers. Environment configuration describes one runtime of each Minecraft type and supplies defaults. Preserve this legacy composition; do not add provider-specific branching to provisioning core. |
| `packages/minecraft-provider/index.ts` | One configured server per provider instance; Java TCP status probe, optional Geyser UDP endpoint, configured lifecycle commands and simulated results when commands are absent. Start-command completion alone is not runtime readiness. |
| `packages/bedrock-provider/index.ts` | One configured native runtime, process-backed status and buffered player events, world discovery and pack validation. Provisioning must not bypass this lifecycle or reinterpret Geyser as native BDS. |
| `packages/synthetic-provider/index.ts` | Virtual endpoints and in-memory lifecycle provide the neutral contract test target. It does not currently provision servers. |
| `packages/core/sqlite-repository.ts` | Schema version 4; operation/event/audit records and server status snapshots persist behind `PersistenceRepository`. Snapshots do not contain a reconstructable server definition. Migrations use transactions. |
| `server.ts` | Existing `/api/servers/:id/*`, `/api/operations`, `/api/events`, history and WebSocket surfaces can serve provisioned servers without a second orchestration API. Content plans currently live in an in-memory map. |
| `packages/content-library/types.ts`, `importer.ts` | Import plans already describe approval, source hashes, staging, actions and failures. The nominally neutral planner currently restricts provider ID to `minecraft` and has format-specific destination rules. Do not assume it is a general provider dispatch service. |
| `packages/minecraft-provider/content-import.ts`, `bedrock-content-import.ts` | Separate adapters own Java and Bedrock layouts. A direct Bedrock adapter supports staged worlds/packs. The HTTP import-plan route still constructs the Java adapter, even for a resolved Bedrock root. |
| Provider, persistence, content-import, Bedrock-provider and Bedrock-content-import tests | Existing coverage establishes discovery, provider isolation, lifecycle tracking, source preservation, approval, collisions, unsafe archives, sessions and durable history. There is no unified provisioning contract yet. |

The known test failure remains: **Content Library API maps Bedrock plans to the
configured native provider root**, expected 201, received 422. Missing
`bedrock-world` support in the current planner and current route dispatch are
content-integration dependencies, not work performed by JBGH-022A.

## Architecture decision

Add an optional provisioning adapter associated with each existing Provider
Manager registry entry. A small neutral service, accessed through Provider
Manager, coordinates plan persistence, validation, claims, approval and recovery.
It does not run shell commands or understand server.properties, archives, pack
manifests, Java versions or native executables.

Keep `providerId` a stable provider identity, not a generated instance identity.
Before multiple real servers can be applied, providers need a per-server runtime
collection behind their existing `GameProvider` interface. Provider-owned wrappers
may delegate to existing single-runtime implementations; core must not instantiate
Minecraft-specific children. Forward each child's player events exactly once,
preserving providerId/serverId so existing FamilyService subscriptions still work.
Do not repeatedly call manager.register for additional servers.

Legacy environment-defined `minecraft-main` and `bedrock-main` continue to work.
Persisted definitions are loaded into their provider before manager state
reconciliation. Never replace a legacy runtime or silently resolve duplicate IDs.
Unknown provider/version definitions stay unavailable and diagnosable, not erased.

## Proposed contracts

These TypeScript sketches specify future boundaries, not current exports.
JSON extensions must be schema-validated, bounded, versioned and secret-free.
Actor identity comes from trusted request context, never from user-supplied tags.

```ts
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type StorageIntent =
  | { mode: "create"; rootId: string; directoryName?: string }
  | { mode: "adopt"; locationRef: string };
type WorldIntent =
  | { mode: "create"; name?: string }
  | { mode: "existing"; worldId: string }
  | { mode: "import"; contentId: string; sourceSha256: string };
type EndpointRequirement =
  | {
      id: string; protocol: string; transport: "tcp" | "udp";
      bindAddress: string;
      port: { mode: "fixed"; value: number } | { mode: "allocate"; poolId: string };
    }
  | { id: string; protocol: string; transport: "virtual" };

interface ServerProvisioningRequest {
  schemaVersion: 1;
  providerId: string;
  serverId?: string; // generated once and stored with the request if omitted
  displayName: string;
  hostId: string; // initially the local configured host only
  storage: StorageIntent;
  runtimeProfileRef: string; // operator-approved artifact/config profile
  world?: WorldIntent;
  endpoints: EndpointRequirement[];
  content: Array<{ contentId: string; sourceSha256: string; worldId?: string }>;
  startup: "remain-stopped" | "start-after-apply";
  extension?: { schemaId: string; version: number; values: { [key: string]: Json } };
  tags?: Record<string, string>;
  ownership?: { familyId: string }; // association only, not access authorization
}

interface ProvisioningIssue {
  code: string;
  severity: "warning" | "blocking";
  message: string;
  field?: string;
}
interface PlanStep {
  id: string;
  kind: "runtime.prepare" | "config.create" | "world.prepare" | "content.apply"
    | "server.attach" | "server.start" | "validate";
  description: string;
  dependsOn: string[];
  resources: string[]; // references to declared resources, not arbitrary shell text
  compensation: "remove-owned" | "detach" | "stop-owned" | "none";
}
interface ServerProvisioningPlan {
  id: string;
  requestId: string;
  schemaVersion: 1;
  revision: number;
  digest: string;
  providerId: string;
  providerVersion: string;
  adapterVersion: string;
  server: { id: string; displayName: string; hostId: string };
  target: { rootId?: string; locationRef?: string; resolvedPath: string; ownership: "managed" | "external" };
  files: Array<{ relativePath: string; action: "create" | "inspect"; templateRef?: string; sha256?: string }>;
  steps: PlanStep[];
  endpoints: ConnectionEndpoint[]; // existing shared type; bind requirements also retained
  contentPlans: Array<{ operationId: string; digest: string; sourceSha256: string }>;
  preconditions: Array<{ id: string; description: string; fingerprint?: string }>;
  issues: ProvisioningIssue[];
  status: "planned" | "blocked" | "expired";
  createdAt: string;
  expiresAt: string;
  requiresApproval: true;
  providerData: { schemaId: string; version: number; values: Json };
}

type ProvisioningState = "REQUESTED" | "PLANNED" | "VALIDATED" | "APPLYING"
  | "PROVISIONED" | "STARTING" | "READY" | "FAILED" | "ROLLING_BACK"
  | "ROLLED_BACK" | "PARTIALLY_ROLLED_BACK";
interface ProvisioningResult {
  requestId: string;
  planId: string;
  operationId?: string;
  serverId: string;
  outcome: "planned" | "applied" | "failed" | "rolled-back" | "partially-rolled-back";
  state: ProvisioningState;
  issues: ProvisioningIssue[];
  lifecycleOperationIds: string[];
  rollback?: {
    completedStepIds: string[];
    residualResources: string[];
    errors: ProvisioningIssue[];
  };
  updatedAt: string;
}
```

Store the normalized request separately and bind it into the plan digest. Defaults
are explicit in the stored request; IDs, timestamps and allocations are assigned
once, then reused. A blocked plan has blocking issues and a planned outcome, not
an applied or ready result. `PROVISIONED` means successfully installed/attached
with startup intentionally skipped; `READY` requires observed runtime readiness.
An applied outcome must include one of those states. Failure after provisioning
can retain a server record and report failed startup; it is not an applied success.

Location references are operator-configured mappings, not raw HTTP filesystem
paths. Runtime profiles identify approved local artifacts, fingerprints, platform
requirements and secret references. Extension validation rejects unknown fields,
raw command strings, unapproved paths and inline credentials. Java seeds/options
or Bedrock settings belong in provider schemas, never core switch statements.

## Minimum provider interface and responsibilities

Use an optional `provisioning` extension on a registry entry, leaving current
GameProvider lifecycle methods intact. Proposed capabilities are
`server.provision.plan`, `server.provision.apply`, and `server.adopt`.
Capability flags and corresponding adapter presence must agree; otherwise fail
with `PROVISIONING_UNSUPPORTED`. Provider runtime readiness is not the same as
ability to plan a new runtime from an approved profile.

The adapter boundary needs these operations, implemented incrementally:

| Operation | Responsibility |
|---|---|
| `plan(request, context)` | Read-only inspection; return provider-specific draft resources, world/config actions, dependencies, requirements and issues. Core seals and stores the final plan. No directory creation, start or download. |
| `validate(plan, stage, context)` | `pre-apply` checks runtime/profile/options and current target facts; `post-apply` verifies installed configuration and declared effects. Return structured issues; do not reuse pack-specific ValidationResult for generic provisioning. |
| `apply(plan, context)` | Apply only approved provider steps through scoped resource access, with durable per-step receipts. No independent operation queue or hidden lifecycle start. |
| `attach(definition)` / `detach(serverId)` | Add/remove a per-server runtime in the already registered provider. Idempotent by server ID and definition fingerprint; detach does not delete files or kill external processes. Used on recovery too. |
| `compensate(plan, receipts, context)` | Reverse only recorded owned changes. Return every retained resource/error; safe on repeated calls. |

`context` supplies scoped paths, approved profile/content references, reserved
endpoints, cancellation and a durable journal callback; it is not the raw SQLite
connection. Providers remain trusted code but receive narrowly scoped resources.
Core validates ownership independently before destructive compensation.

No `destroyProvisionedServer` API in this milestone: failure compensation is not
general deletion. A later decommission plan must distinguish detach, retention,
backup and deletion, with separate authorization. Reuse manager.startServer,
stopServer, getServerStatus, getWorlds and validateWorld for lifecycle/world checks.

Java adapter: resolve approved Paper artifact and Java requirements, explicit EULA
acceptance reference, server directory, server.properties, world binding and
controlled start profile. Declare TCP gameplay plus optional RCON and Geyser UDP
requirements; never hide auxiliary ports from allocation.

Bedrock adapter: resolve approved native BDS source and platform prerequisites,
copy allowed runtime artifacts without altering the source, map world intent to
level-name and managed worlds, generate approved properties/allow-list settings,
and declare all native UDP/IPv6 listeners. Retain existing console/player lifecycle.
Do not copy unrelated source worlds, logs, databases or credentials implicitly.

Synthetic adapter: schema-valid plan with virtual endpoints, deterministic resource
receipts and injected failures. No Minecraft identifiers or real processes required.

## Core responsibilities and lifecycle

Core resolves the provider, validates neutral fields and ownership context, creates
stable IDs, binds content plans, persists approval and reservations, invokes adapter
steps, attaches definitions through the same manager, and coordinates compensation.

```text
REQUESTED -> PLANNED -> VALIDATED -> APPLYING -> PROVISIONED
                                                  |
                                        startup requested
                                                  v
                                              STARTING -> READY

Any failed validation/application/start -> FAILED
FAILED + compensable owned changes -> ROLLING_BACK
ROLLING_BACK -> ROLLED_BACK | PARTIALLY_ROLLED_BACK
```

Blocked plans remain inspectable with issues; validation failure records FAILED
without entering APPLYING. Expired/stale plans require a newly reviewed revision.
VALIDATED is an apply-time checkpoint, not a permanent promise that resources are
available. Approval is bound to digest/revision and checked again before mutation.

Reuse existing `OperationStatus` values. Add a proposed `server.provision` operation
type; store the detailed phase in durable provisioning records/result payloads.
The operation remains running through compensation and ends failed if original
provisioning failed, even when rollback succeeds. Do not label rollback as a
successful provision. Link start/stop child operation IDs to the parent record.
Use existing operation events, history queries and `/ws`; add a typed
`provisioning.state.changed` event only for phase detail. Extend audit action unions
explicitly for plan creation, approval, apply, adoption and compensation.

Apply sequence: claim plan/server/path/endpoints transactionally; persist intent;
revalidate; create operation-owned staging and marker; perform journaled provider
and content steps; validate; publish into the exclusive target; persist definition;
attach provider runtime; optionally start through manager; inspect operation result
and poll bounded status/world validation; commit success. Generated worlds that
require first boot are declared deferred validations when startup is disabled.
No `READY` claim follows a simulated start or merely an open unrelated port.

There is no SQL transaction spanning filesystem or process effects. Each effect
needs an intent record before execution and an idempotent receipt afterward.
After a crash, reconcile actual marker/hash/process facts before resuming or
compensating. Never blindly rerun a half-completed apply or startup command.

## Persistence and audit proposal

Add a focused `ProvisioningRepository` abstraction alongside the existing
PersistenceRepository, implemented by the existing SQLite persistence layer with
versioned migrations. Avoid adding provisioning methods to unrelated Family
repositories or performing SQL in routes/providers.

| Durable record | Required data/constraints |
|---|---|
| Requests | ID, normalized request, canonical hash, trusted actor/scope, idempotency key, timestamps; unique actor scope + key. |
| Plans | ID, immutable revision/digest, request, versions, resolved target, endpoint proposal, steps, content snapshots/hashes, preconditions, issues, expiry. |
| Approvals | Actor, plan digest/revision, explicit approved scope, timestamp; secret values excluded. |
| Server definitions | Globally unique server ID, provider ID, host, display name, ownership, canonical location, profile/config references, endpoint bindings, definition version, tags/family reference and timestamps. Separate from server_state snapshots. |
| Apply journal | Parent operation ID, phase, step intent/receipt, resource ownership, child operations, errors, rollback results and timestamps. |
| Claims | Unique server ID/path claims and endpoint leases/reservations, owner operation, fencing generation, expiry for in-flight leases; successful server reservations persist while stopped. |

Repository methods cover create-or-get request, store/get plan, compare-and-swap
claim, append step, commit definition/result and recover incomplete operations.
Claim acquisition and approval/operation intent must be atomic. Persist events
with transitions using an outbox or equivalent transaction before WebSocket
publication; readers can recover missed events through existing history APIs.

Keep active server definitions, ownership receipts and unresolved rollback records
outside ordinary operation-retention deletion. Store safe summaries in history;
restrict absolute paths and profile details to authorized administrators. Family
association does not create memberships, link identities, grant playtime or bypass
policy. Existing AI access remains read-only and excludes credentials.

## Idempotency and concurrency

Require an `Idempotency-Key` when creating a plan request. The same scoped key and
normalized payload returns the same request/plan/server ID; a different payload
returns 409 `IDEMPOTENCY_CONFLICT`. Plan revision is explicit; applying a stale
revision or adapter/profile/content drift returns 409 `PLAN_STALE`.

Apply references a stored plan and digest, never a caller-edited plan body. One
durable apply claim per approved plan; simultaneous callers receive the same
operation. Completed retries return the recorded result without new directories,
registrations or starts. Failed/rolled-back attempts remain terminal; retry needs
an explicit new reviewed plan referencing the prior attempt. Recovery resumes the
same journal under an exclusive fenced owner rather than creating another apply.

Globally reserve IDs across legacy and provisioned servers. Canonical path claims
include ancestor/descendant overlap, not just string equality. Expired leases do
not authorize takeover until the previous executor is fenced and runtime state
reconciled. A second registration with a different fingerprint is a conflict.

## Path safety

1. Administrators configure managed root IDs, adoption location references and
   read-only artifact sources. Requests cannot supply arbitrary absolute paths.
2. New targets must be strict descendants of an allowed root, outside source
   installations and all legacy/adopted runtime trees. Never use the root itself.
3. Resolve real existing ancestors; reject traversal, drive-relative paths, UNC
   paths unless explicitly supported, Windows device names, alternate data streams,
   case aliases, symlinks/junctions/reparse points and overlapping destinations.
   A lexical `startsWith` check alone is insufficient.
4. Reject any pre-existing new-server target, even an empty unmarked directory.
   The only resume exception requires a matching durable operation and marker.
5. Exclusive staging and final directories contain a versioned ownership marker
   with server/provider/operation IDs. Markers are not sufficient authorization:
   match repository receipts, canonical containment and recorded identity too.
6. Recheck containment and path identity immediately before writes/rename/removal.
   Restrict root ACLs to the service/operator to reduce substitution races. If safe
   no-follow operations cannot be guaranteed, fail closed; do not follow links.
7. Rollback removes only resources created by that operation and still matching
   receipts. Never recursively delete an arbitrary requested path, adoption root,
   source binary installation, content source or shared artifact cache.

## Endpoint allocation

Use generic transport/protocol/address/host requirements. Provider profiles may
suggest familiar defaults, but core has no Java/Bedrock numeric port constants.
Bind address and advertised connection address are distinct facts; the plan records
both and providers generate configuration from the reserved bind requirements.

Planning checks configured pools, persisted/legacy reservations and live TCP/UDP
exclusive bind probes without changing runtime files. Proposals are not permanent
reservations. At apply, atomically claim all endpoints, re-probe before mutation,
and revalidate immediately before start. Fixed conflicts fail; automatic choices
that change an approved plan require a new revision, not a hidden port switch.

Conflicts are keyed by host, transport, address family, address overlap and port.
Wildcard addresses overlap specific addresses; dual-stack listeners may overlap
IPv4. TCP and UDP can share a number when bindings permit. Consider auxiliary
listeners and legacy external installations. Virtual endpoints use namespace
uniqueness and require no socket probe.

Database leases serialize GameHub callers, not other OS processes. Holding probe
sockets until start narrows the gap; providers that cannot inherit sockets require
a release/bind handoff. A competing process can still win. Treat actual bind/start
failure as failure, retain honest diagnostics, and compensate safely. Do not promise
race-free OS port reservation based on a successful preview probe.

## Existing-server adoption

Adoption is a distinct storage mode with an operator-approved location reference.
Inspect runtime identity, configuration, endpoints and worlds read-only. Preserve
all files and live process state; no marker injection, EULA rewrite, content import,
start/stop or migration during adoption. Require `remain-stopped` as an intent of
no startup action (an already running external server is not stopped).

Record ownership as external and default deletion permission to false. Adoption
registers a definition and attaches discovery only. Repeated adoption of the same
identity returns the existing definition; conflicting provider/ID/path claims fail.
Occupied endpoints may belong to the adopted runtime: require provider evidence
of ownership or report unresolved conflict, rather than assuming every busy port
belongs to it. Existing native BDS processes may be discoverable without a managed
console; do not advertise enforcement/control that the provider cannot perform.

Adoption failure compensates only the new registry/definition entry, never the
external installation. Moving an adopted runtime into managed ownership requires
a separate copy/migration plan with approval; it is not a flag flip.

## Content pipeline integration

Reference content IDs, source hashes and target world intent. Resolve an adapter
through the provider entry, obtain the existing JBGH-020 ContentImportPlan, and bind
its exact snapshot/digest into provisioning approval. Core follows dependencies;
it does not infer content format, destination folders or Bedrock pack relationships.

Persist bound child plans before apply because the current HTTP in-memory plan map
does not survive restart. At execution recheck source hashes, compatibility, target
binding and approval; changed/missing dependencies block provisioning. Never reuse
an import plan aimed at another server/root. Existing content routes and standalone
approval behavior stay compatible; provisioning approval explicitly enumerates
child imports and cannot silently approve unrelated plans.

Import into the new isolated runtime before publication/start. Each child result
and rollback receipt is journaled, with audit correlation to the parent. If import
fails or partially compensates, the parent cannot claim READY. Existing/adopted
servers use the independent content workflow after adoption, not hidden adoption
mutations. Adapter world discovery/validation proves installed content placement.

The known Bedrock HTTP/planner gap blocks accepting Bedrock world-import provisioning
end to end. Resolve it in a separately scoped content-dispatch compatibility task;
do not blindly broaden SUPPORTED_TYPES without adapter destination, staging and
validation coverage. It does not block JBGH-022B neutral planning or content-free
synthetic plans. Existing direct Bedrock adapter tests remain valuable evidence,
but are not proof the HTTP integration is fixed.

## Rollback and recovery

Before start, compensate in reverse dependency order: detach newly attached runtime,
remove newly committed definition, undo child content receipts, remove owned files,
then release claims. Keep journal/tombstones so retries cannot recreate resources.
An adapter must write a durable step intent before changing files; a crash between
effect and receipt is resolved by inspecting expected markers/hashes.

After a startup attempt, use manager.stopServer only for a process started by this
operation, then verify offline/process termination before deleting its runtime.
A completed stop command is not proof of termination. Never stop adopted or
otherwise unrelated processes. Preserve runtime files when the process cannot be
proven stopped, ownership changes, content compensation fails or storage is down.
Report PARTIALLY_ROLLED_BACK with explicit residuals and remediation instructions;
quarantine conflicting paths/endpoints rather than releasing them for reuse.

Once a runtime has been exposed to real players, preserve mutable worlds by default
on startup/readiness failure; report FAILED with retained resources. Destructive
compensation is limited to the approved disposable pre-exposure phase. A later
cleanup plan handles retained data. Successful stopped provisioning is not rolled
back merely because startup was not requested.

## REST proposal (not implemented)

| Route | Behavior |
|---|---|
| `POST /api/provisioning/plans` | Validate request, resolve provider, persist preview. Require Idempotency-Key. 201 for new plan, 200 for identical replay, 422 with stored blocked plan/issues for semantic failure. No runtime mutation. |
| `GET /api/provisioning/plans/:id` | Return authorized plan, revision/digest, expiry and issues; 404 when absent. |
| `POST /api/provisioning/plans/:id/apply` | Body `{ approve: true, digest, revision }`; validate trusted authorization and atomically claim. 202 plus existing OperationRef and result URL for accepted/in-flight operation; 200 for completed replay; 409 for conflict/stale plan. |
| `GET /api/operations/:id` | Reuse existing operation retrieval; provisioning detail in result/linked durable projection, including rollback and child operation references. No parallel operations endpoint. |
| Existing server/history/events routes and `/ws` | Discover provisioned/adopted servers and correlate lifecycle/phase events through Provider Manager. |

Malformed schema is 400, unsupported capability is 422, authorization failure is
403, and missing provider/plan is 404. Apply cannot trust a body actor/family ID as
authorization. Local-admin-only deployment may be the first policy, but must be
explicit before exposing mutation routes. No destroy endpoint in this proposal.

## Acceptance criteria and test matrix

JBGH-022A acceptance: this reviewed document defines create/adopt contracts,
state/outcome semantics, manager integration, safety boundaries, durable recovery,
content dependencies and staged work without runtime changes. Future implementation
must meet the matrix below; these are proposed tests, not claims of executed tests.

| Area | Required proof | Earliest stage |
|---|---|---|
| Synthetic planning | Stable normalized plan, virtual endpoints, no Minecraft fields required, no filesystem/process mutation | 022B |
| Java planning | Approved profile, Java/EULA blockers, world/config preview and all ports; no binary execution | 022C |
| Bedrock planning | BDS profile, level-name intent, native UDP/IPv6 requirements; no Geyser substitution | 022C |
| Capability mismatch | Missing adapter or capability refuses plan/apply, preserves existing provider behavior | 022B |
| Request/extension validation | Unknown options, secrets/raw commands, unsupported schema and unauthorized ownership rejected | 022B/C |
| Path safety | Traversal, root equality, case alias, junction/symlink, overlapping roots, pre-existing targets and substitution rejected without mutation | 022C/D |
| Endpoint collisions | Fixed/automatic pools, TCP/UDP distinction, wildcard/dual-stack, legacy reservations, concurrent claims and external bind race | 022C/D |
| Idempotency | Same key/payload replay, changed payload conflict, concurrent apply, stable generated ID, no duplicate attachment | 022B/D |
| Validation failure | Blocked preview inspectable; stale profile/content/path facts prevent all apply effects | 022B/D |
| Rollback | Fault at every step, repeated compensation, stop failure, receipt mismatch and retained resources report truthful outcomes | 022D |
| Adoption | Source bytes/process unchanged, no ownership marker, duplicate identity handling, external cleanup forbidden | 022C/D |
| Persistence/restart | Plans/definitions/claims/steps restored, crashes before/after each effect, no duplicate starts/events, storage failure never reports success | 022D |
| Content integration | Bound approval/hash, wrong target rejection, child failure propagation, source preservation and known Bedrock API regression | 022E |
| Lifecycle compatibility | Existing routes/events, single forwarding of player events, unchanged Family/rewards/analytics behavior, existing server IDs preserved | 022D/E |
| Live readiness | Real isolated Paper and BDS start/world/client/stop evidence; no simulated-start acceptance | 022F |

Use node:test/node:assert, synthetic fixtures and temporary databases under
`tests/tmp/`. Separate planning tests from apply/runtime acceptance; explicitly
opt into live runs only on the authoritative machine. Keep the known unrelated
Content Library failure visible until its own fix is validated. Do not claim a
green full suite from contract-only results.

## Staged implementation plan

1. **JBGH-022B: neutral contracts and synthetic planning only.** Add versioned
   request/plan/result types, neutral schema checks, optional registry adapter
   discovery, and read-only synthetic planner tests. Test stable normalization,
   unsupported capability and adapter option validation. No apply route, real
   runtime writes, process starts, migrations or provider lifecycle changes.
   Use an in-memory test plan store; durable idempotency is not accepted yet.
2. **JBGH-022C: real-provider planning and resource preflight.** Java/Bedrock profile
   schemas, root/adoption inspection, endpoint proposals and content dependency
   previews. Planning remains non-mutating; establish concrete migration and
   authorization policy before apply implementation.
3. **JBGH-022D: durable synthetic apply and registry attachment.** Repository
   migrations, atomic claims, journal/recovery/compensation, existing operation
   integration and per-server provider attachment contracts. Prove synthetic
   concurrency/crash behavior before enabling real filesystem effects.
4. **JBGH-022E: real managed apply and explicit adoption.** Provider-owned runtime
   collections, approved artifacts/config, safe resource handling and content
   integration. Resolve the separately tracked Bedrock import dependency before
   supporting its world-import path. Preserve legacy bootstrap compatibility.
5. **JBGH-022F: REST exposure and authoritative runtime acceptance.** Authorized
   plan/apply APIs, history/WebSocket projections and real isolated Paper/BDS
   evidence including cleanup, restart and player/session compatibility. UI and
   decommissioning remain separately scoped unless explicitly authorized.

## Open decisions and blockers

- Confirm operator-configured managed roots, approved adoption locations and
  local runtime artifact profiles; no safe default should be the repository cwd.
- Confirm runtime distribution/licensing workflow and explicit EULA acceptance
  records; no downloader is assumed.
- Choose the provider-owned multi-runtime wrapper design and prove player event
  forwarding before dynamic attachment. Current single-server implementations
  and replacement-style registration cannot safely support multiple same-type servers.
- Define trusted actor/authorization handling before apply REST exposure; family
  association alone must not authorize provisioning.
- Confirm endpoint pool/address policies and whether IPv6 is supported initially;
  unsupported listeners must block a plan rather than escape reservation.
- Finalize migration/outbox/lease-fencing details before durable apply. Database
  persistence alone cannot make filesystem/process operations atomic.
- Resolve Bedrock content-route/planner integration independently before accepting
  imported-world provisioning. This is a dependency, not a change in 022A.
- Reconcile the stale JBGH-021 overview with the newer 021A closure record in a
  separate documentation change. No new live acceptance is asserted here.

Recommended next task: JBGH-022B as defined above. Approval of this architecture
does not itself authorize JBGH-022B implementation or declare JBGH-022 complete.
