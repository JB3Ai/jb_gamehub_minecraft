# JBGH-022A - Unified Server Provisioning Architecture

Status: JBGH-022A architecture, JBGH-022B/C planning/preflight, JBGH-022D synthetic apply and JBGH-022E existing-runtime attachment implemented.
Updated: 2026-10-05. JBGH-022E baseline: `a0c2d1c` on `dev/laptop-continuation`.
JBGH-022 remains OPEN. Fresh-runtime provisioning and JBGH-022F remain unimplemented.

## JBGH-022B implementation boundary

This section records the 022B boundary; the 022C additions are documented below.

`packages/core/provisioning.ts` defines request/plan/result/state, storage and
endpoint descriptors, structured validation errors and the optional
`ProvisioningPlanner.plan(request)` contract. Provider Manager exposes
`planProvisioning(input)` and dispatches only when both the optional provider
planner and `server.provision.plan` capability exist. Only synthetic advertises
planning; no provider advertises apply/adoption execution through this change.
Existing registration and lifecycle methods are unchanged.

The implemented request is deliberately smaller than the future sketches below:
schemaVersion, providerId, optional serverId/displayName, hostId, explicit
create/adopt storage, endpoints and optional opaque `providerOptions`. World,
content, startup, ownership, profiles and versioned extension schemas are deferred;
unknown fields are rejected rather than silently ignored. Options are validated
only as bounded JSON data (no functions, cycles, accessors, undefined, non-finite
numbers or runtime objects). Their keys/meaning are not interpreted by core.
Callers must not include credentials; synthetic does not inspect or redact option
values. Real adapters must supply their own schema/secret-reference policy later.

The synthetic adapter describes CREATE_MANAGED_DIRECTORY, WRITE_CONFIGURATION,
RESERVE_ENDPOINT and REGISTER_SERVER. Adoption replaces directory/config creation
with INSPECT_EXISTING_RUNTIME and labels ownership external. None of these steps
executes. Paths remain unresolved root/location references and endpoints explicitly
remain `unreserved`; structural validation does not prove filesystem containment,
port availability, existence of an adoption target or exclusive server identity.
No plan store migration, registration mutation, lifecycle operation, audit write,
REST route, file write, socket bind or process start is introduced.

Identity uses SHA-256 over the validated request with sorted object keys; array
order remains significant. `requestId` identifies that request and `planId` also
includes the synthetic adapter version. Missing server IDs use a hash-derived ID;
missing directory names use a safe hash-derived leaf and display names default to
the server ID. Explicit blank IDs/names are invalid, not treated as omissions.
Distinct request payloads produce distinct plan IDs even if an explicit server ID
matches: this slice does not claim/reserve IDs. Future apply must enforce uniqueness.

Plans are detached, deeply frozen JSON snapshots at creation. The adapter's
in-memory cache returns the same snapshot and createdAt for identical requests
during its lifetime. Across adapters/restarts IDs and descriptive content are
stable, but createdAt may differ; tests inject a clock for full equality. This is
not durable idempotency, approval, plan expiry or resource reservation. Those
require the later repository/claims work. The 022B plan uses explicit `planId`,
flat serverId, descriptive operations and unresolved resource descriptors rather
than pretending the future resolved-path/file/approval contract already exists.

`tests/provisioning.test.ts` covers create/adopt plans, structural validation,
opaque options, deterministic identities/replay, deep immutability/JSON, optional
capabilities and guarded resource APIs proving planning does not mutate resources
or provider lifecycle/history. The known Bedrock Content Library gap is unchanged.

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

The JBGH-022C implementation boundary and recommended next task are recorded
below. This document does not declare JBGH-022 complete.

## JBGH-022C implementation: profiles and read-only preflight

This section records the 022C boundary; the 022D additions are documented below.

JBGH-022C adds profile discovery and resource inspection. JBGH-022 remains open;
there is no apply route or runtime mutation in this slice.

`ProvisioningProfileAdapter` provides immutable, JSON-safe metadata and translates
provider options into neutral artifact requirements and structured issues. The
shared descriptive planner preserves the 022B plan shape, canonical identity and
synthetic serialization. Java and Bedrock expose planning independently of their
configured runtime readiness. Existing lifecycle capability flags and behavior
are unchanged. `ProviderManager.getProvisioningProfile()` discovers profiles;
`preflightProvisioning(plan, context)` returns a separate immutable PASS/WARN/FAIL
result. It checks planning/preflight capabilities and compares the supplied plan
with the current adapter's canonical plan, ignoring only its creation timestamp.
No plan is enriched or rewritten by preflight.

### Provider profiles

| Profile | Endpoint hint | Provider options and artifact inspection |
|---|---|---|
| Java/Paper | `game`, protocol `java-paper`, TCP 25565, wildcard IPv4 | CREATE requires approved `artifactRef`; both modes require `javaRuntimeRef`. ADOPT inspects `artifactFile` (default `paper.jar`) and `server.properties`. Profile describes Java 21 and license acceptance requirements. |
| Native Bedrock | `game`, protocol `native-bds`, UDP 19132, wildcard IPv4 | CREATE requires approved `artifactRef`. ADOPT inspects `artifactFile` (default Windows `bedrock_server.exe`; explicitly choose `bedrock_server` for Linux) and `server.properties`. |
| Synthetic | Virtual `control` endpoint | No executable requirements; retains arbitrary JSON options as the reference planner. |

Defaults are discovery hints, not implicit endpoint insertion or reservations.
Real profiles require their named game endpoint with the matching protocol and
transport; callers can choose ports and add explicitly described endpoints.
`worldName` is an optional generic provider intent; no specific world name is
assumed and no world/configuration is created. Unknown or unsafe provider options
are rejected. `artifactRef` is create-only and `artifactFile` is adopt-only.
Lifecycle compatibility describes existing start/stop/restart support, not a new
multi-runtime attachment implementation.

Artifact checks establish regular-file presence only. They do not execute binaries,
verify Java versions, authenticate distributions, validate configuration contents,
prove native dependencies, infer license consent or claim runtime readiness.
License acceptance, artifact integrity, configuration rendering, imported worlds,
allow-list rendering and platform compatibility remain prerequisites for future
real apply, not guarantees of a preflight PASS.

### Trusted path policy and ownership

The caller supplies trusted, host-scoped maps of managed roots, adoption locations
and runtime artifact references. Do not populate these maps from untrusted request
paths. No default root points at the repository or an existing production install.
CREATE requires an existing approved root and a new child target. Any existing
target, including an empty directory or one containing an ownership marker, fails:
this slice has no durable receipt authorizing resume or destructive reuse. ADOPT
requires an explicitly approved existing directory and required provider artifacts;
its plan retains external ownership. No marker is created and adoption confers no
cleanup authority.

Paths must be absolute in operator policy. Traversal is rejected by request parsing
and containment checks. Every existing ancestor is inspected; symlink/junction
paths fail conservatively. Targets overlapping operator-configured protected paths
fail. Unknown references, inaccessible paths and missing artifacts fail with
machine-readable issues. Inspections cannot eliminate filesystem substitution
races; future apply must revalidate under its own resource claim immediately before
any effect. Preflight never creates, deletes, moves or changes a file.

### Endpoint inventory and result semantics

The optional injected inventory returns host-scoped TCP/UDP bindings and an explicit
completeness flag. No sockets are bound, no DNS lookup is performed, and no port is
reserved. The default absent/incomplete inventory yields WARN for concrete network
endpoints. A PASS requires a complete trusted inventory and successful applicable
path/artifact checks; it is a point-in-time observation, not a reservation.

TCP and UDP with the same numeric port are independent. Overlapping requests and
existing bindings fail. Wildcards (including IPv6 wildcard and mapped IPv4 forms)
are treated conservatively; distinct hosts are independent. Requests require literal
IP addresses for deterministic inspection. Allocation requests remain unresolved
and produce WARN; there is no pool allocator. Inventory errors or invalid entries
fail honestly rather than being interpreted as free ports. An occupied adoption
endpoint is not silently exempted without authoritative ownership evidence.

Results contain deterministic issue codes, fields and warning/blocking severity;
no timestamp is added. Identical plans, policy and inventory produce identical JSON.
Tests cover provider defaults, neutral core, create/adopt differences, artifact
presence, collisions, path containment/junctions, unsupported capabilities, malformed
requests, immutable plans, serialization and absence of filesystem/network/process
mutation. These fixture checks are not live Paper/BDS acceptance.

### Next scope

Recommended JBGH-022D scope remains durable **synthetic** apply: repository-backed
plans and resource claims, operation journal, crash recovery/compensation, concurrency
proof and provider attachment contracts. Real runtime writes/launches, REST exposure
and imported-world support remain separate later slices. The known Content Library
Bedrock import 422 failure is unchanged. No JBGH-022D work is implemented here.

## JBGH-022D implementation: durable synthetic apply

This section records the 022D boundary; the 022E additions are documented below.

JBGH-022D implements internal, simulation-only apply. `server.provision.apply` is
advertised by the synthetic provider only; Java/Paper and native Bedrock still
have no apply capability. A manager backed only by the in-memory history repository
rejects apply: a durable provisioning repository is required. No public REST route,
real runtime attachment, binary/configuration write, process launch, socket bind,
OS reservation or world import is implemented. FamilyService and Bedrock lifecycle
behavior are unchanged. JBGH-022 remains OPEN.

### Approval and execution model

`ProvisioningApplyRequest` carries an immutable plan, `approved: true` and the
`provisioningDigest(plan)` value. The digest includes the canonical plan except its
creation timestamp, allowing the same adapter to reconstruct a plan after restart.
The service regenerates the plan with the current adapter and rejects tampering or
adapter drift. Actor identity comes from trusted manager configuration, not request
options. The approved plan, digest, actor and steps are persisted before effects.
This is an internal authorization boundary, not a public authentication mechanism.

`ProvisioningApplyService` coordinates the optional repository extension and
`SyntheticProvisioningExecutor`. The executor returns JSON descriptions; only the
repository creates or removes simulated effects. Its injectable before/after step
and compensation hooks support deterministic failures, barriers and crash tests.
An interrupted worker leaves its durable state for recovery, rather than pretending
to have completed cleanup.

Only CREATE is executable in this slice. ADOPT, allocation requests and non-literal
IP endpoint proposals fail explicitly. Synthetic apply validates the canonical plan
and logical resource conflicts; it does not reuse filesystem preflight as proof of
runtime safety. In particular, a logical root ID is not a resolved OS directory,
and a logical endpoint claim is not evidence that an OS port is free. Physical
preflight, trusted path resolution and mutation-time revalidation remain required
before any future real apply.

### Schema and repository boundary

SQLite migration **v5** adds:

- `provisioning_applies`: unique plan/apply identity, approved plan, actor, steps,
  result, timestamps, recovery lease and fencing token.
- `provisioning_claims`: owner operation/plan, resource key, kind, timestamps and
  active/released state. A partial unique index permits only one active owner per
  resource key. Released claim history remains queryable.
- `provisioning_journal`: append-only, ordered step/status/timestamp/error records.
- `provisioning_effects`: simulated directory, configuration, registration and
  claim receipts, keyed by operation and step.

`SqliteProvisioningRepository` owns all SQL and transaction boundaries. Service and
provider code use repository methods. WAL remains enabled; synchronous mode is FULL
for durable commits, with a bounded SQLite busy timeout. `BEGIN IMMEDIATE` serializes
writers across repository connections. Simulation effects, claims and their completion
journal entries commit atomically, eliminating an unjournaled external effect window
for this synthetic implementation only.

State projections reuse the existing `operations` table (`server.provision.apply`),
`events` table and `audit_log`. These projections commit in the same transaction as
state transitions. Journal entries also produce `provisioning.step` history events.
There is no second audit store. Apply details remain available through manager
operation/claim/journal/effect query methods after restart. Existing history retention
continues to govern general events/audits; the provisioning journal is not pruned by
that policy. Live WebSocket delivery/outbox semantics are not added in this slice.

### Claims, concurrency and idempotency

Claims use deterministic logical keys:

| Resource | Exclusive key |
|---|---|
| Server | Server ID, across providers |
| Managed path | Host ID + case-folded logical root ID + case-folded child directory |
| TCP/UDP endpoint | Host ID + transport + numeric port |
| Virtual endpoint | Host ID + server ID + endpoint ID |

Endpoint claims conservatively cover the entire host/transport/port bucket, so
wildcard/specific-address aliases cannot evade exclusion. TCP and UDP are independent.
No OS socket is bound. Paths are logical names only: physical aliases between
different root references must be resolved by future real-resource policy.

Claims are acquired in stable step order. Competing requests receive structured
`RESOURCE_CONFLICT` data including the resource and owning operation. A failed
claimant rolls back only its own effects and claims. The successful owner retains
its claims. Concurrent duplicate application of a live operation returns
`APPLY_IN_PROGRESS`; completed replay returns the persisted result without new
claims, resources, journals or audits. Failed/rolled-back plans likewise replay their
recorded result; a new plan is needed for a new attempt.

### Journal, rollback and recovery

The implementation reuses `ProvisioningState`: PLANNED -> APPLYING -> PROVISIONED,
or FAILED -> ROLLING_BACK -> ROLLED_BACK / PARTIALLY_ROLLED_BACK. Detailed results
retain the original apply error and separate rollback errors. Every step records
start and completion or failure. Compensation records start, completion or failure;
original journal history is never overwritten.

Rollback walks completed simulated resources in reverse order. If a compensation
fails, remaining prerequisites and all claims are retained, and the result is
PARTIALLY_ROLLED_BACK. A fully successful rollback atomically releases claims and
records ROLLED_BACK. No unrelated operation's state is removed. Partial rollback is
a terminal, inspectable outcome requiring a future explicit repair workflow; recovery
does not silently release its claims or retry its failed compensation.

Each operation has a worker lease (30 seconds by default) and monotonically increasing
fencing token. Steps renew the lease before execution. A step that outlives its lease
cannot commit; the worker must stop and permit recovery. There is no timer-based test
synchronization or automatic takeover of an unexpired worker. After lease expiry,
`recoverProvisioning(operationId)` atomically takes a new token. Old workers are
fenced from both writes and rollback, even if they finish later.

Recovery is explicit: callers enumerate `listIncompleteProvisioning()` after providers
are registered, then recover eligible operations. A rebuilt service verifies the
persisted plan against the current adapter, skips committed receipts and resumes
unfinished steps. FAILED/ROLLING_BACK operations resume compensation. Successful or
rolled-back operations return their persisted terminal result. SQLite rolls back an
interrupted transaction; already committed receipts survive connection/process restart.
These tests prove application/process-restart behavior, not physical power-loss testing.

### Validation and next boundary

The apply tests cover success, restart/replay, concurrent server/path/endpoint claims,
TCP/UDP separation, active duplicate rejection, injected step failures, claim release,
journal preservation, partial rollback, crashes after claims/configuration/registration,
interrupted compensation, stale-worker fencing, approval/plan validation, manager gates,
no runtime mutation, atomic effect/journal storage failure and v4 migration preservation.
Concurrency uses latches and database transactions; lease tests advance an injected
clock rather than sleeping.

Recommended JBGH-022E scope is explicitly approved real managed apply/adoption:
provider-owned multi-runtime attachment, approved artifact and license records,
physical path/endpoint ownership, mutation-time checks, durable external-effect
receipts and safe compensation. Synthetic transaction atomicity must not be assumed
for filesystem or process effects. Resolve the separately tracked ContentImportPlanner
Bedrock world gap before enabling that import path. Public API/authentication and
live authoritative Paper/BDS acceptance remain later boundaries. No JBGH-022E work
is implemented by this milestone.

## JBGH-022E implementation: existing-runtime attachment

JBGH-022E adds internal attachment of approved existing Java/Paper and native BDS
runtimes. It does not create fresh runtimes, download binaries, rewrite configuration,
launch processes, or grant destructive ownership. JBGH-022 remains OPEN.

### Contracts and provider ownership

`RuntimeAttachmentPreview` combines the existing adoption plan with an immutable
`RuntimeAttachmentDescriptor` and approval digest. `RuntimeAttachmentRequest` adds
explicit approval. The digest covers the canonical plan and observed descriptor,
including artifact hashes, canonical root and filesystem identity; observation time
and diagnostic warnings do not change identity. Attach re-verifies this evidence
before claiming resources and again immediately before publishing the reference.

Each Java/Bedrock provider owns a `runtimeAttachments` collection. Its adapter
interprets provider configuration and adds/removes only attachment metadata. It does
not register another provider or modify the existing single-runtime lifecycle path.
Attached references are inspectable through `listRuntimeAttachments()` and the
provider collection; they are not silently added to the legacy `listServers()`
lifecycle dispatch. Starting/stopping newly attached runtimes requires a later,
explicit provider-owned lifecycle routing implementation.

Both providers now advertise `server.provision.attach`. They still do not advertise
`server.provision.apply` or full create support. Synthetic apply remains unchanged.
The manager exposes preview, attach, recovery, attachment listing and external-intent
inspection as internal methods; no new REST routes are introduced.

### Approved roots and physical verification

`RuntimeAttachmentPolicy` extends the read-only preflight context with explicit
`adoptionRoots` and optional expected SHA-256 values keyed by artifact name. Policy
is trusted operator configuration, never derived from an untrusted attachment body.
The plan uses an approved adoption-location reference rather than an arbitrary path.

Canonicalization rejects traversal and symlink/junction components. The existing
runtime must be readable, lie within an approved adoption root, and not overlap any
managed or protected root. Managed-root approval does not imply adoption permission.
World/artifact paths must remain inside the runtime; external runtime references
(such as Java) must resolve through the approved artifact-reference map. Physical
claims use canonical paths and reject both equal and nested active runtime roots.
Windows claim keys are case-folded. Operators must include legacy installations and
other externally managed storage in protected-root policy where appropriate.

Ownership is always `ADOPTED`, with `destructiveOwnership: false`. No ownership marker
is written. Existing MANAGED roots retain their separate policy; this slice neither
promotes adopted storage to managed nor authorizes overwriting/deleting it.

The immutable artifact manifest records logical name, relative path or approved
reference, file/directory type, required/optional status, size, observed SHA-256 and
optional expected hash. Required files are opened read-only and streamed for hashing.
Configuration interpretation is checked against the hashed bytes, followed by another
artifact/root check to detect substitutions during verification. Missing optional world
directories are explicitly recorded. Directory verification establishes readable
structure; it does not hash an entire world or attest its contents.

These are point-in-time checks, not a filesystem lock or proof of an active process's
loaded configuration. Hashes prove observed bytes, not distribution authenticity,
binary compatibility or executable behavior. No binary is executed to determine its
version. The Java runtime reference and Java 21 requirement are represented and its
file presence/readability/hash are checked; a Java version execution probe is deferred.

### Java and Bedrock interpretation

Java attachment checks the approved Paper/server artifact, Java executable reference
and `server.properties`. Its TCP endpoint must match `server-port` and `server-ip`.
Enabled RCON/query listeners are explicitly unsupported in this slice. Bedrock checks
the approved native executable and `server.properties`; both IPv4 and IPv6 UDP
endpoints must be declared and match configured values (provider defaults 19132 and
19133 when absent). Port hints remain provider-owned, not global core constants.

Both adapters require an explicit `level-name`; Java inspects that relative directory,
and Bedrock inspects `worlds/<level-name>`. No specific world name is assumed or changed.
Configuration parsing accepts explicit, unescaped `key=value` lines and rejects
unsupported syntax rather than silently overlooking listener settings. A runtime with
unsupported configuration needs a future parser/capability extension, not a rewrite.

JBGH-022C preflight is reused for plan/profile/artifact and endpoint structure checks.
The attachment verifier adds canonical containment, hashes and provider interpretation.
Absent socket inventory remains a warning, not a claim that ports are free. Transactional
GameHub endpoint claims reject incompatible attachments at attach time and retain the
existing host/transport/port namespace, including conflicts with synthetic logical
claims. No sockets are bound or persistently reserved at the OS level.

### Durable intent, effect and receipt

SQLite migration **v6** adds two tables:

- `runtime_attachments`: unique effect/server identity and durable reference containing
  provider/server/host, canonical root, manifest, endpoints, ownership, timestamps and
  fencing token.
- `provisioning_external_intents`: stable effect identity, approved digest/descriptor,
  current fencing token, reconciliation state and optional completion receipt.

The existing provisioning applies, claims, journal, general operations/events/audit
infrastructure are reused. Attachment operations project as `server.provision.attach`.
Service/provider code does not execute SQL.

The protocol is:

1. Persist the approved operation and effect intent under the current lease/token.
2. Acquire server, canonical physical-path and endpoint claims.
3. Reverify the runtime, then commit the durable attachment reference.
4. Populate the provider-owned collection using a synchronous fencing check.
5. Commit the external receipt and journal completion in a separate transaction.
6. Mark the operation PROVISIONED.

The reference publication and receipt intentionally do not share one transaction.
This creates a tested recovery boundary for an effect whose durable evidence exists
before its journal completion. The first external effect is metadata attachment,
not modification of the runtime. Provider collection insertion is idempotent by
stable effect identity/digest; this protocol does not claim exactly-once arbitrary
filesystem or process effects.

### Reconciliation and rollback

Recovery is explicit after the provider is registered and trusted policy is available.
`recoverRuntimeAttachment()` revalidates approved evidence and acquires an expired
operation lease with an increased fencing token. It inspects the durable attachment
record before acting:

- Claims with no record: publish the missing approved reference.
- Record/provider attachment with no receipt: reuse the compatible record, hydrate the
  provider collection, and record reconciliation rather than creating another server.
- Receipt with incomplete final status: reconcile existing evidence and finalize.
- Completed operation after restart: verify the record and rehydrate the provider-owned
  collection without adding claims, journal entries or another attachment.
- Changed artifacts during an incomplete operation: fail and roll back references,
  preserving the externally changed runtime bytes.
- Changed evidence for a completed identity: require reapproval/explicit future repair;
  do not silently replace the approved manifest.

Unexpired workers are not taken over. Stale tokens cannot publish references, change
the provider collection, commit receipts or remove attachments. Repeated identical
requests reuse the completed result; incompatible identity reuse fails explicitly.
Physical root overlap checks and claims run in SQLite write transactions, including
across independent repository connections.

Rollback removes only this operation's provider reference, durable attachment record
and safe claims. Intent and journal history remain inspectable. Runtime files and
configuration are never deleted, overwritten or moved. Rollback failure retains claims
and reports PARTIALLY_ROLLED_BACK through the existing result model. No destructive
cleanup of adopted content is implemented.

### Acceptance and next scope

Fixture tests cover both providers, approved/protected roots, traversal/junctions,
missing/unreadable/wrong-type artifacts, immutable/hash manifests, endpoint/configuration
mismatch, duplicate/conflicting attachment, nested roots, concurrent claims, rollback
byte preservation, crashes after claims/record/provider attachment/receipt, stale workers,
restart rehydration, artifact drift, capability boundaries and absence of runtime
writes, process launches and socket binding. Fixtures are disposable under `tests/tmp`;
no authoritative Java or BDS runtime is used.

Recommended JBGH-022F scope: authenticated API exposure, operational provider routing
for attached runtimes, single-forwarded lifecycle events and explicitly authorized
runtime acceptance. Fresh-runtime creation, download/licensing workflows and real
external-file mutation need separately reviewed execution/compensation boundaries.
The known ContentImportPlanner Bedrock world gap remains separately tracked and
unchanged. No JBGH-022F implementation or live runtime acceptance is included here.
