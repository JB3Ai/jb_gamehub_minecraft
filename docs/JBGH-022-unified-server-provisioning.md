# JBGH-022A - Unified Server Provisioning Architecture

Status: JBGH-022A-E foundations implemented; JBGH-022F, JBGH-022G-A and JBGH-022G-B: CLOSED / PASS.
Updated: 2026-10-15. JBGH-022G-B managed Java first-boot acceptance completed successfully.
JBGH-022 remains OPEN. Managed synthetic/Java CREATE is implemented, Java first-boot
and clean-stop acceptance passed, and Java/Bedrock existing-runtime attachment
acceptance passed. Player acceptance and Bedrock managed CREATE remain deferred.

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

This section records the 022E boundary; the 022F additions are documented below.

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

## JBGH-022F implementation: authenticated API and scoped lifecycle

JBGH-022F adds authenticated internal-admin REST surfaces, provider-scoped attached
runtime lifecycle routing and opt-in acceptance harnesses. Fresh-runtime CREATE,
downloads, installation, destructive ownership and JBGH-022G are not implemented.
Live Java/BDS acceptance has **not** been performed as part of fixture validation.
JBGH-022 remains OPEN.

### Authorization and trusted configuration

There was no complete authentication system in this checkout. The new
`ProvisioningApiOptions.authorize(request)` abstraction returns a trusted actor and
admin decision; applications/tests may inject it. The minimal default uses an exact
Bearer token comparison via constant-time SHA-256 comparison. Configure
`GAMEHUB_ADMIN_TOKEN` with at least 32 characters. Missing/short configuration disables
access, missing/invalid credentials return 401, and authenticated non-admin principals
return 403. No account subsystem or frontend-visibility authorization is introduced.
Use a TLS-terminated/private deployment; this slice does not implement HTTPS itself.

`GAMEHUB_PROVISIONING_POLICY_FILE` points to a trusted JSON file mapping provider IDs
to JBGH-022E policies (hostId, managedRoots, adoptionRoots, adoptionLocations,
artifactLocations and optional protectedPaths/expectedHashes). There are no default
adoption paths. Alternatively inject options as the third argument to `startServer`.
Clients cannot submit root policy, executables, shell commands, actor identities or
arbitrary attachment descriptors through the attachment endpoint.

Authorization outcomes use the existing audit trail with trusted actor, method or
transport, and outcome. Tokens/authorization headers are never written to audit.
All provisioning reads and writes require admin authorization. Scoped lifecycle routes
also require it. Legacy `/api/servers/:id/...` routes require it for attached IDs,
preventing an alternate-URL bypass. When policies or durable attachments exist,
operation/event/history routes and WebSocket upgrades require admin authorization
because operation errors can contain runtime details. WebSocket clients supply an
Authorization header; URL query tokens are not supported. General provider/server
list discovery remains read-only. This is not authentication of every unrelated
legacy API; those surfaces retain their existing behavior.

### REST contract

| Route | Request | Response |
|---|---|---|
| POST `/api/provisioning/plans` | Existing `ServerProvisioningRequest` | 201: `{plan, digest, profile}`; digest is the existing provisioning digest |
| GET `/api/provisioning/plans/:id` | Plan ID | `{plan, digest, attachment?}` |
| POST `/api/provisioning/preflight` | `{planId}` | `{status, issues, attachment?}`; adoption attachment preview includes manifest and approval digest |
| POST `/api/provisioning/attachments` | `{planId, digest, approved:true}` | 200: safe attachment metadata; identical replay reuses identity/result |
| GET `/api/provisioning/attachments` | None | `{attachments:[...]}` |
| GET `/api/provisioning/attachments/:id` | Attachment ID | Safe attachment metadata |
| POST `/api/provisioning/attachments/:id/reconcile` | Empty object | `{operationId,state}`; an incomplete operation ID is also accepted when no record exists yet |

The initial plan digest and the verified attachment digest are distinct. Approval
must use the attachment digest returned by preflight. It binds the observed root,
manifest and plan even though the absolute root is not returned publicly. The service
reruns verification immediately before attachment. Preflight changes no runtime
resources; its preview is persisted for later approval.

Responses omit canonical filesystem roots, inode/device data, raw errors and launch
configuration. They deliberately expose approved reference names, relative artifact
paths, hashes, endpoint/world metadata and ownership. Invalid requests return 400,
missing records 404, incompatible/conflicting state 409, and unsupported provider or
verification failures 422. Errors use `{error:{code,message}}` without raw filesystem
exception text. No destructive DELETE or public fresh-runtime apply endpoint exists.

SQLite migration **v7** adds `provisioning_plans` behind the repository abstraction,
including the last verified preview. Plans and previews survive restart. HTTP handlers
use ProviderManager and existing services, not duplicated planning/attachment logic.

### Runtime routing and ownership

`scopeRuntimeProvider` keeps one registry provider identity and one independent
provider instance for each attached server. Provider-owned Java and Bedrock factories
construct those instances using durable attachment metadata and trusted artifact
references; they do not copy the default runtime's commands/configuration. The default
configured server remains supported.

The existing `GameProvider` lifecycle methods, ProviderManager operation tracking,
events, audit and persistence are reused. Scoped runtime factories are injectable for
fixture tests. Attachment activation is idempotent, player events are subscribed and
forwarded once, and per-server lifecycle queues serialize concurrent start/stop/restart.
Different servers retain separate process handles, state, roots and listeners.

Normal server discovery now includes activated attachment IDs, `ownership: ADOPTED`
and attachment ID. Scoped REST routes are:

- GET `/api/providers/:providerId/servers/:serverId/status`
- GET `/api/providers/:providerId/servers/:serverId/endpoints`
- GET `/api/providers/:providerId/servers/:serverId/worlds`
- POST `/api/providers/:providerId/servers/:serverId/start`, `/stop`, `/restart`

Lifecycle mutations return the existing operation reference (202); inspect its status
and normal operation retrieval for failures. The authenticated actor is recorded.
Provider ID plus server ID selects the runtime. Legacy unscoped lookup rejects
ambiguous IDs. World validation rejects traversal rather than passing it to a provider.

Java attachments use an argument-array Java process launch with the approved Java
reference and server artifact, without a shell. Pre-existing `eula=true` is required;
GameHub never writes acceptance. Stop uses the console of the process this instance
started. Existing world/log/player behavior is delegated to MinecraftProvider.
Bedrock attachments instantiate the existing BedrockProvider with an approved absolute
executable and scoped root/endpoint. Log parsing, numeric XUID handling and display-name
kick targeting are unchanged. Spawn errors now reject start and reset process state,
so failed launches are recorded instead of becoming unhandled child-process errors.
Bedrock restart waits for stop to become observable before starting again.

Start/restart reverify the approved attachment manifest. Metadata/configuration drift
fails closed and is recorded as a failed lifecycle operation. GameHub does not rewrite
configuration, replace binaries, delete worlds or elevate adopted ownership. Running
the game server itself can update worlds/logs/configuration; start is therefore an
explicit administrative action, not a read-only operation.

### Restart and recovery limits

At startup, completed attachments with available trusted policy are reverified and
activated without starting external processes. Failed verification leaves the attachment
durable but unroutable and records a recovery-required audit outcome. Incomplete
operations remain recoverable through the reconcile route and existing lease/fencing
rules. Newly registered child runtimes need not be online for metadata recovery.

Process-console ownership is not reconstructed after a GameHub process restart. An
externally running Java process cannot be stopped through a lost console handle, and
native Bedrock's managed-process status is not external-process discovery. Do not treat
metadata restoration as proof that an external process was found or can be controlled.
The acceptance harnesses require initially stopped test runtimes and probe their
explicit ports before launching. General process adoption requires additional design.

### Controlled acceptance harnesses (not run by `npm test`)

Commands:

- `npm run provisioning:test:java-attachment`
- `npm run provisioning:test:bedrock-attachment`

Both fail closed unless these variables are explicitly supplied:

- `JBGH_ATTACHMENT_ACCEPTANCE_CONFIRM=START_STOP_EXISTING_TEST_RUNTIME`
- `JBGH_ATTACHMENT_RUNTIME_ROOT`: absolute existing test-runtime root
- `JBGH_ATTACHMENT_EVIDENCE_DIR`: separate absolute evidence directory with an existing parent
- `JBGH_ATTACHMENT_SERVER_ID`: explicit safe server identity
- `JBGH_ATTACHMENT_ARTIFACT`: existing executable/artifact filename
- `JBGH_ATTACHMENT_GAME_PORT`: explicit configured game port
- Java only: `JBGH_ATTACHMENT_JAVA_EXECUTABLE`: approved absolute Java executable
- Bedrock only: `JBGH_ATTACHMENT_IPV6_PORT`: explicit configured IPv6 port

The operator must separately place `.jbgh-022f-acceptance.json` in the test runtime:

```json
{"purpose":"JBGH-022F","runtimeRoot":"<absolute test runtime root>","allowStartStop":true,"allowWorldWrites":true}
```

The harness never creates this approval marker or chooses a production runtime by
default. It rejects overlapping evidence/source paths, uses short-lived port probes,
attaches through ProviderManager, checks status, starts, waits for readiness, discovers
provider endpoints/world IDs, stops, verifies source integrity and world existence,
and records operation/event evidence separately. Ordinary artifacts and all Bedrock
configuration remain SHA-256 exact. Java `server.properties` uses a manifest-hash-verified
pre-start snapshot and a post-stop active-property map comparison: comments and blank
lines may change; literal active values must match, with added/removed keys, changed
values, malformed active lines and duplicate keys rejected. Cleanup attempts
a graceful stop only for a process started by the harness; it never deletes the source
or force-restores changed files. Evidence explicitly records `playerAcceptance:false`.
A changed active Java configuration or byte-changed Bedrock configuration causes
acceptance failure rather than silently repairing it. Production attachment verification
remains unchanged. World writes are acknowledged in the marker and are not claimed byte-identical.

### JBGH-022F: CLOSED / PASS

Authorized existing-runtime live attachment acceptance passed for both providers:
Java on 2026-10-12 and Bedrock on 2026-10-14. Both runs attached the runtime,
started it, reached online, discovered endpoints and worlds, stopped cleanly,
and verified source integrity. These results cover runtime attachment/lifecycle;
player acceptance was not performed.

Java live acceptance:

- provider: `minecraft`
- server: `java-022f-live`
- endpoint: `127.0.0.1:25565`
- world: `jb3-integration-test-world`
- sourceArtifactsIntact: `true`
- playerAcceptance: `false`

Bedrock live acceptance:

- provider: `minecraft-bedrock`
- server: `bedrock-022f-live`
- IPv4: `0.0.0.0:19132`
- IPv6: `:::19133`
- world: `Bedrock level`
- sourceArtifactsIntact: `true`
- playerAcceptance: `false`

Acceptance-driven fixes:

- `c3297bd` — accept unrelated escaped Java properties
- `12ceb25` — honor Java attachment bind address
- `355b572` — tolerate Java config comment rewrites

### Validation and remaining closure work

Fixture/API coverage includes authorization outcomes, safe responses, digest approval,
duplicate/conflicting attachment, unsupported providers, durable retrieval, legacy URL
and WebSocket authorization, restart activation, separate synthetic/Java/Bedrock routing,
world/root isolation, single event forwarding, unknown IDs, artifact drift, EULA and
spawn failures, ownership preservation and fail-closed harness configuration. No real
Java/BDS runtime or human client is used by these tests.

JBGH-022F live attached-runtime evidence is complete. Before JBGH-022 can close,
complete any remaining documented API/auth deployment acceptance and separately scope
fresh-runtime creation/artifact/licensing/external-effect recovery. The known Bedrock
ContentImportPlanner 422 failure remains separate and unchanged. JBGH-022G implementation has not begun.

## JBGH-022G — Managed Fresh-Runtime Provisioning

Status: ARCHITECTURE PROPOSED / NOT IMPLEMENTED. Reviewed against the checkout at
`ae7f3b2` on 2026-10-14. The sections above retain their historical implementation
boundaries. This section specifies the narrower first fresh-CREATE implementation;
it does not enable a capability, apply endpoint, migration or acceptance harness.
JBGH-022F remains CLOSED / PASS and overall JBGH-022 remains OPEN.

### Scope and recommendation

Recommend **A: synthetic contract coverage plus Java/Paper fresh creation first**.
Use an approved local profile, create a new directory beneath an approved managed
root, copy its explicitly enumerated artifacts, generate provider configuration,
persist a managed definition, and activate it in the existing scoped collection.
Finish **PROVISIONED, initially stopped**, with no process launch or first boot.

Synthetic exercises the neutral creation service, repository and effect gateway
with deterministic fixtures; it does not substitute simulated effects for proof
that Java filesystem creation works. Keep the existing 022D simulation executor
and its tests unchanged. Add fixture-backed real filesystem tests for the new
gateway and Java adapter before enabling Java's managed-create capability.

| Choice | Benefit | Additional cost / decision |
|---|---|---|
| A: synthetic + Java | One local-file manifest, one configuration renderer, one TCP listener and explicit Java/EULA references; materially advances CREATE while reusing the 022F routing path. | Java first boot/readiness and Bedrock fresh-create remain separate gates. |
| B: synthetic + Java + Bedrock | Both production providers could create managed storage together. | Requires a complete approved BDS runtime-tree manifest, executable/platform dependencies, permissions and dual UDP endpoint handling, increasing copy/recovery cases before the first filesystem executor is proven. |

Choose A. Native BDS CREATE must remain unavailable, even though its existing
planner describes create and attached-runtime acceptance passed. Bedrock planning,
attachment, source verification and lifecycle behavior remain unchanged.

The exact first implementation boundary is:

1. Local host only; `storage.mode="create"`; approved existing local managed root.
2. Stable generated or explicitly validated single directory leaf and server ID.
3. A versioned, operator-approved local Java profile, artifact hashes, trusted Java
   executable reference and a scoped prior EULA-acceptance record.
4. Exactly one fixed literal-IPv4 TCP game endpoint. No allocation, RCON, query,
   Geyser or additional listeners. Provider-owned configuration represents exactly
   the approved endpoint and safe level name.
5. All-or-nothing transactional server/path/endpoint claims, explicit approved
   create preview, journaled filesystem effects, managed definition persistence,
   guarded activation, recovery and ownership-limited compensation.
6. No start during apply or recovery. Explicit subsequent lifecycle commands use
   the existing authenticated routes/queues; their success is a separate operation.
7. The distinct approved-create API below and safe operation/discovery projections.
   No installer UI, batch creation or deletion API.

A missing generated world is a declared deferred validation, not a provisioning
failure. Do not require `level.dat`, claim a discovered world or mark READY before
first boot. Approved artifact bytes and configuration can be verified while stopped;
runtime compatibility, boot-time resource requirements and world readiness cannot.

### Strict non-goals

No internet downloads, Paper acquisition API, Mojang/BDS acquisition automation,
automatic license/EULA acceptance, upgrades, general destructive deletion,
firewall/NAT changes, containers, remote agents/hosts, arbitrary shell commands,
content import expansion, or changes to FamilyService, AI, rewards or analytics.
The known Bedrock ContentImportPlanner 422 gap remains separate. No existing Java
or BDS installation is copied as an implicit template or used as a destination.

GameHub-managed ownership authorizes narrowly recorded provisioning compensation,
not a DELETE endpoint. This slice does not reclaim running processes after restart,
install Java, execute a binary to infer acceptance/compatibility, start a server to
discover defaults, or silently reapprove changed artifacts/configuration.

### Repository fit and required additions

The inspected contracts impose these concrete constraints:

- `ProvisioningApplyService` requires `executionMode="simulation"`. Do not remove
  that guard or place real effects in the 022D executor. Introduce a focused
  managed-creation service and optional provider adapter behind ProviderManager.
- Existing create preflight checks file presence and point-in-time inventory;
  it does not pin artifact bytes, generate config or attest EULA acceptance.
  Managed-create preflight must produce a separate verified preview.
- Existing claims are acquired one step at a time. Managed CREATE needs a new
  repository method to acquire its complete claim set in one write transaction.
- Existing attachment descriptors require `ADOPTED`, and scoped discovery currently
  hard-codes that label. Do not fabricate an adopted record or call the adoption
  verifier against a fresh-created directory.
- Existing schema is v7. Completed attachment recovery and legacy bootstrap must
  continue to work without converting their rows, roots or verification policies.
- Existing activation contains awaits before publishing a child. Managed activation
  needs a final current-definition/fence check at publication and a lifecycle
  admission check, not just a check before constructing a runtime.

These are proposed implementation changes, not changes made by this document.

### Ownership and provider/core responsibilities

A managed definition records `ownership="MANAGED"`, `mode="create"`, origin operation,
approved create digest, canonical private runtime identity, definition version and
an explicit per-effect ownership ledger. Public `destructiveOwnership=false` remains
the default: compensation is an internal, operation-specific permission, never a
general storage-deletion grant. ADOPTED definitions retain their existing semantics.

| Owner | Responsibility |
|---|---|
| Core / creation service | Approval, state transitions, claims, dependency order, effect intents/receipts, fencing and recovery, ownership checks, compensation coordination, safe result projections. |
| Repository | SQL transactions, operation/definition identity, claim exclusion, lease CAS, effect records, transition/audit/history persistence and retention protection. |
| Neutral filesystem gateway | Constrained create/open/copy/publish/remove primitives, containment/identity checks, exclusive creation, durability checks, access to the host mutation guard; no provider configuration interpretation. |
| Java adapter | Profile/options schema, Paper and Java artifact requirements, safe file layout, configuration/EULA rendering, launch metadata and managed-start verification. It supplies declarative entries, not arbitrary filesystem callbacks or shell text. |
| Bedrock adapter, later | Approved expanded runtime-tree requirements, platform/layout/permissions, native configuration and UDP endpoints; no acquisition or license automation. |
| Scoped provider collection | One provider registry identity, per-server children, queues, one event subscription per child, definition-aware activation/deactivation and restart rehydration. |
| Operator | Approved roots/profiles/source hashes, service access policy, host identity, explicit license acceptance and supported filesystem environment. |

A provider creation manifest is bounded data: safe relative file destinations,
`copy-approved-reference` or `write-rendered-bytes` entries, required hashes/sizes,
dependency ordering and immutable versus generated configuration roles. Core
rejects unknown entry kinds, paths escaping the new root, duplicate/case-aliased
destinations and entries targeting reserved ownership metadata. Providers cannot
choose another operation's root or remove resources directly.

### Artifact/profile and EULA model

Keep the existing schema-v1 create storage/endpoints fields. For executable Java
CREATE, introduce provider-owned, validated `providerOptions.profileRef` and
`providerOptions.eulaAcceptanceRef`; they are opaque safe references. A trusted
profile resolves the local artifact and Java references. Do not require a broad
top-level request-schema rewrite or expose absolute artifact locations.

Existing `artifactRef` / `javaRuntimeRef` create descriptions remain valid planning
data, but do not become executable through the new endpoint without an approved
profile. Reject mixed conflicting profile/direct-ref options; no fallback from an
unknown profile to a caller-supplied path. Adopt options and behavior stay compatible.

The trusted profile is versioned and binds provider/adapter/config-template versions,
OS/filesystem support, approved artifact reference names, byte sizes and SHA-256,
destination filenames, Java reference, endpoint policy and level-name policy.
Only the operator policy maps references to absolute locations. The approved Java
executable is verified as a read-only external reference, not copied/modified.
The first profile normally copies one approved Paper JAR; any other required local
files must be explicitly enumerated. No recursive cache/install-tree copy or archive
extraction is implied. A hash proves approved bytes, not executable safety or offline
first-boot readiness; the operator must attest compatibility of the chosen profile.

Preflight hashes source handles and verifies regular-file type, identity, size and
stable content. Reopen/reverify under apply guard before copying; compare copied
bytes with the approved hash. Refuse changed sources, symbolic links/junctions,
unsupported file types and files with unapproved hard-link aliases. Sources and Java
references are protected from destination overlap and compensation.

Prior Java EULA acceptance is a durable trusted record, not an HTTP `eula:true`
flag. Record acceptance ID, trusted operator actor/time, provider, pinned profile
revision, operator-supplied terms reference/revision, and allowed scope (specific
server ID or explicit profile/host scope). Bind its ID and revision into approval.
The creation adapter may render `eula.txt` with `eula=true` **only** when that
pre-existing record explicitly authorizes writing acceptance for this fresh runtime.
Ordinary provisioning approval cannot create or widen that record. Missing,
revoked, stale or out-of-scope acceptance blocks apply before filesystem mutation.
No acquisition/consent UI or legal interpretation is implemented in 022G.

Recommended first policy: require valid prior acceptance even for stopped creation.
This keeps PROVISIONED meaningful as launch-eligible subject to a later lifecycle
action. Rendering `eula=true` records explicit prior acceptance; it is not silent
acceptance. Existing adopted EULA files are never rewritten. First boot retains the
Java factory's acceptance check and adds managed policy/reference verification.

Deferred BDS model: an operator-pre-expanded, approved read-only runtime bundle,
with a bounded manifest of every copied file, relative directory, hash, platform and
required executable permission. Exclude existing worlds/logs/identity/config from
implicit copying; generate new configuration. Handle auxiliary files and empty
directories explicitly. A single executable reference is insufficient to attest a
complete native runtime. No downloader or automatic license decision is designed.

### Managed-create preview, paths and approval

Retain read-only planning and existing adoption preflight. For supported CREATE,
persist a `ManagedCreatePreview` in a separate tagged plan-preview slot. Its private
snapshot includes plan, stable server ID/leaf, provider/profile/template revisions,
policy revision, canonical root/parent identities, proposed final path, source
manifest hashes, rendered config/file hashes, endpoint claims, EULA record revision
and `startup="remain-stopped"`. Times and diagnostic warnings are excluded from its
stable approval digest; all executable decisions and preconditions are included.

The public projection exposes reference IDs, ownership, safe leaf, relative files,
hashes, endpoint proposals, EULA acceptance reference and deferred world validation.
It never exposes absolute roots, inode/device identities, executable paths, command
arguments, policy secrets or raw filesystem errors. Persisting a plan/preview is
allowed; planning/preflight must not mutate runtime/artifact files, claim resources,
bind probes, publish definitions, start processes or accept licensing.

Resolve the trusted managed root through every existing ancestor. Require an
existing local directory and reject symlinks, junctions, unsupported reparse/mount
aliases, UNC/device/drive-relative paths and unsupported filesystem behavior.
The destination is a strict direct child, with a safe single leaf: no separators,
traversal, alternate streams, reserved Windows devices, trailing dots/spaces or
case-equivalent reserved metadata names. Derive omitted ID/leaf once using the
existing deterministic plan identity and persist them; retries never pick new names.

Protected paths must include all legacy/adopted runtime trees, artifact sources,
approved Java installations, evidence locations and other operator-protected roots.
Reject either-direction overlap, including nested/aliased managed roots, and pin
root/parent identity. Managed-root references that alias the same directory share
physical claims. No destination may already exist, even empty; a matching marker
alone is not resume permission. Recovery uses the original operation/effect journal,
not a new plan that adopts a leftover directory.

Revalidate profile, EULA record, root identity, sources, claims and final absence
under apply guard. Drift invalidates approval; return PLAN_STALE / ARTIFACT_DRIFT
and require new preflight/review. Do not substitute a newer source/version, port,
directory name, Java reference or acceptance record behind an old digest.

### Claims and endpoint safety

Before the first directory/file effect, one repository transaction records the
approved operation/actor and acquires the entire resource set or none:

- Global server ID, shared with legacy servers and adopted/managed definitions.
- Canonical physical path: host + normalized root identity/path + direct child;
  equal and ancestor/descendant overlap exclusion with existing attachment claims.
- Existing conservative endpoint bucket: host + transport + numeric port.
  Bind address is still recorded in the approved manifest/configuration, but
  different IPv4 addresses cannot bypass the shared port claim.
- Any reserved operation-local temporary names beneath the new runtime.

Inventory legacy identities/roots/endpoints before enabling mutation and prevent
registry changes from bypassing the shared admission policy. Keep compatibility
with existing synthetic/attachment claim namespaces; do not introduce a separate
CREATE namespace that permits the same server or port twice. Claims persist after
successful stopped provisioning and through partial/uncertain rollback.

Network endpoints require complete trusted inventory during verified preflight.
Apply rechecks persisted reservations and uses a bounded exclusive bind probe under
the claimed endpoint before the first filesystem effect. Synthetic virtual endpoints
need no socket. Probe success is point-in-time, not an OS reservation. Stop/release
the probe without launching a runtime. An external process may later occupy the
port; a subsequent explicit start must revalidate availability and report an honest
lifecycle failure without deleting an already provisioned runtime. No auto allocation
or hidden bind-address rewrite is permitted.

### Create/apply state machine and visibility

Use existing operation states for the new service; keep new per-effect recovery
detail separate rather than pretending it is an existing exported state.

```text
stored PLANNED -> verified preview -> explicit approval
  -> atomic operation + all claims -> APPLYING
  -> owned directory + files -> verified creation manifest
  -> durable PENDING_ACTIVATION definition -> guarded provider activation
  -> atomic definition ACTIVE + PROVISIONED result
failure -> FAILED -> ROLLING_BACK -> ROLLED_BACK
                                -> PARTIALLY_ROLLED_BACK (retained resources/claims)
```

The operation type remains `server.provision.apply` with a new internal
`executionKind="managed-create"`, distinct from simulation and attachment.
No STARTING or READY transition occurs in 022G. Approval includes remain-stopped;
a request for start-after-apply is rejected, not ignored.

Create directly into an exclusively created final runtime directory under the
private managed root; whole-directory staging/rename is not required in this first
slice. The directory is incomplete until journal verification and definition
completion. Individual files use intent-owned temporary siblings and non-overwriting
publication. No provider discovery or lifecycle operation exposes an incomplete
server, even if its directory already exists.

Persist a PENDING_ACTIVATION definition only after all required creation receipts and
read-only validation pass. Instantiate/register the provider child without starting it,
then perform a current-token/current-definition check at final collection publication.
A published-but-unfinalized child is quarantined from lifecycle admission/discovery.
Commit ACTIVE definition, successful result and durable audit/event projection in
one transaction. Only then expose normal discovery and authenticated lifecycle.
Failed final commits leave a recoverable pending definition, never a reported success.

Share the existing provider collection, queues, endpoint projection and event forwarding,
but generalize its internal runtime record as a discriminated ADOPTED / MANAGED
definition. Do not turn CREATE into an ADOPTED descriptor or repeatedly register a
second `minecraft` provider. Preserve existing attachment IDs and adopted projections;
managed discovery reports MANAGED with its managed definition/operation identity.
The Java factory can reuse its launch/console implementation behind a managed
descriptor resolver; it must not inherit legacy shell commands.

Managed verification distinguishes immutable executable/profile/ownership facts
from provider-generated mutable runtime data. Before first exposure, generated
configuration must match its approved bytes. Later explicit start/restart checks
the managed provider's safe config schema, approved endpoint/level name, disabled
auxiliary listeners, current EULA record and immutable runtime/Java artifacts.
It must not silently approve effective configuration changes. Comment-only Paper
rewrites are not a reason to weaken the adopted-runtime verifier. Worlds/logs
created by a separately approved lifecycle action are not provisioning rollback
resources. The Java-start contract and its drift tests must be documented before
enabling lifecycle for MANAGED children.

### Filesystem effect journal

There is no transaction atomically committing SQLite and the filesystem and no
claim of exactly-once filesystem mutation. Every mutating primitive has durable
intent before execution and a separately committed observed receipt afterward.

An intent includes operation/effect/attempt IDs, phase/direction, approval digest,
fencing token, parent/root identity, safe relative target, expected prior state,
source reference/hash or generated byte hash/size, dependencies and allowed
compensation. A receipt records observed object identity, type/hash/size, completion
time and evidence used to reconcile. Internal ownership metadata is not publicly
returned. Attempts use token-specific temporary names; recovery cannot replace
another attempt's file merely because it has the same desired hash.

| Effect | Preconditions and exact mutation | Receipt and recovery | Compensation |
|---|---|---|---|
| Create runtime directory | Directory intent committed; claims/current token/host guard; verified parent, final leaf absent. Exclusive non-recursive mkdir of that one child. | Record returned directory identity. If a crash occurs before identity/ownership evidence is durable, do not infer ownership from existence: retain path/claims for review. If still absent, recovery may execute the same intent. | Only empty removal of the recorded same object after all proven children are removed. Never recursively remove the managed root. |
| Write ownership marker | Separate marker intent; owned directory identity; reserved marker path absent. Exclusive create of fixed schema bytes binding operation, create digest, root and definition identity; flush before receipt. | Marker hash and identity plus directory receipt. Match SQLite intent/receipts and root identity; marker alone grants no authority. Truncated/missing ambiguous marker requires safe reconciliation or quarantine. | Remove only the proven marker after all other owned files; retain it if a dependent effect cannot be removed. |
| Create temporary file | Intent for one approved file/attempt; owned marked parent, temp/final names absent, no links. Exclusive open of token-specific temp, record object identity before streaming bytes. | Durable open/identity observation distinguishes a known partial file from an unknown object. Crash before that observation is an ownership ambiguity, not permission to delete. | Remove a known partial temp only if its identity/type/parent still match. |
| Copy approved artifact | Copy intent references source identity/hash and owned temp receipt; source read-only, regular, stable and disjoint. Bounded streaming copy into that handle, hash copied bytes, flush/close. | Record copied size/hash; recheck source identity/content. Recovery accepts a fully matching temp or removes a proven partial temp and starts a new journaled attempt. It never edits the source. | Remove only owned destination/temp objects matching receipts; preserve sources/shared caches. |
| Render/write configuration or EULA | Write intent specifies exact provider-rendered bytes/hash and scoped acceptance record; owned temp handle, current profile/EULA revision. Write, verify, flush/close. | File hash/identity plus renderer/acceptance revisions. Recovery cannot regenerate different bytes or widen acceptance without reapproval. | Remove only the operation's unchanged generated file; changed active content is retained for review. |
| Publish file | Publish intent; complete temp receipt; owned parent; final absent. A supported same-filesystem no-clobber publication primitive, followed by identity/hash verification. | Reconcile temp/final observed identities. Matching final + intent can be receipted if provenance is proven. A same-hash foreign file is still a collision. | Remove only proven final/temp objects. Never overwrite an existing destination with ordinary rename. |
| Remove owned file/temp/marker | Compensation intent references exact creation receipt, current identity/type, parent and dependents; runtime not exposed/running. Identity-guarded unlink; marker last. | Record absence and compensate receipt. If already absent, reconcile under original ownership evidence; substitutions or unknown children remain retained. | No restoration of foreign or adopted bytes; interruption resumes compensation, not creation. |
| Remove owned runtime directory | All child removals receipted; recorded identity still matches; directory empty and inactive. Non-recursive rmdir. | Absence receipt allows final rollback/claim release. Unknown files, aliases or changed identity block removal. | No parent-root removal or recursive force cleanup. |

All file flush/publication/directory-durability assumptions must be established for
the supported local filesystem/platform. If safe exclusive/no-follow/no-clobber
primitives or identity checks cannot be provided, CREATE stays disabled there.
Ordinary rename is not a portable no-overwrite primitive. Do not claim power-loss
atomicity from process-crash tests or SQL durability alone.

### Fencing, restart recovery and crash boundaries

A monotonic SQLite lease token fences repository updates but cannot cancel an
already issued filesystem call. Require a **host-wide exclusive mutation guard**
shared by all GameHub CREATE/compensation/recovery workers using this database and
its approved roots. The guard must have OS-backed interprocess exclusivity and
release on proven owner exit; a timestamp lockfile is insufficient. Hold it across
an operation's mutation/compensation session, including outstanding async I/O.

Takeover requires both expired lease eligibility and acquisition of the guard after
the old executor has exited or acknowledged cancellation and drained all I/O.
A suspended holder blocks recovery rather than allowing two writers. Do not force
unlock because a heartbeat expired. Check current token/policy before each mutation,
after each await and at receipt/definition/collection publication. Loss of lease
stops new work; a late effect is reconciled, not blindly compensated by the stale
worker. Fenced workers cannot begin an unlink or publish an in-memory child.

The implementation must choose and test a Windows-capable guard/no-follow gateway
before enabling production CREATE. In-process queues alone do not satisfy this
contract. Trusted-root ACLs exclude uncoordinated writers, with read/write identity
checks covering accidental operator interference. This is not protection against
a malicious administrator replacing service-owned files or a second independent
GameHub database claiming the same root: prohibit that policy arrangement.

Recovery loads trusted policy and current provider adapters before admitting lifecycle
traffic. It verifies durable operation, all claims and effect evidence; rehashing and
reconciliation do not create a new approval. Resumption is allowed only with the
same executable decisions and still-valid acceptance/profile. Changed/revoked policy
blocks forward work; only explicitly authorized ownership-safe compensation may
proceed. An unavailable root or ambiguous effect remains recovery-required with
claims retained, not falsely completed or erased.

| Crash boundary | Required outcome after guard acquisition |
|---|---|
| Before directory creation | No object means execute the original durable intent; existing unproven object means collision/quarantine. |
| After mkdir, before ownership receipt/marker | Missing durable provenance means retain orphan/path claim and surface ownership ambiguity; do not guess or recursively clean up. |
| After directory/marker receipts | Revalidate root, object identities and matching journal; continue missing approved file intents. |
| During artifact copy | Known partial temp may be compensated and copied under a new attempt; unknown identity is retained; complete matching bytes can receive a reconciled receipt. |
| After configuration write, before receipt/publication | Inspect known temp/final identity/hash and current acceptance revision; reconcile the same bytes or compensate proven partial work. Never substitute a new template. |
| After definition persistence | PENDING_ACTIVATION is durable but not routable; verify receipts and hydrate the missing scoped child without starting it. |
| After provider activation | Reuse compatible definition/digest; one child/subscription. Old-process in-memory state is not a durable receipt; reconstruct after restart. |
| Before final operation completion | Complete ACTIVE + PROVISIONED once the pending definition, activation and claims agree; do not repeat filesystem work. |
| During compensation | Remain ROLLING_BACK, replay removal intents by receipt/identity, and stop if ownership changed. |
| After PROVISIONED / GameHub restart | Reverify managed definition/launch-critical facts and hydrate through the scoped collection without a process start. Incompatible/missing policy leaves a durable unavailable server and safe diagnosis. |

No process was started by CREATE, so recovery need not stop one. If external process
use or later lifecycle exposure is detected during incomplete compensation, retain
storage and require operator review. Existing 022F limits on lost process-console
handles and external-process adoption remain in force.

### Rollback, retry and compensation rules

Reverse dependencies: quarantine/detach only this operation's unpublished child,
remove/tombstone its pending definition, compensate owned published files and temps,
remove marker, remove empty owned directory, then atomically release claims and
record ROLLED_BACK. Write compensation intents/receipts with the current token.
Do not remove prerequisites while a dependent compensation is unresolved.

Any unknown ownership, substituted path, modified file, unexpected child, active
runtime, unavailable storage or failed cleanup produces PARTIALLY_ROLLED_BACK with
safe residual summaries and **all claims retained**. Unknown objects without a
completed effect receipt must also be recorded as residuals; rollback must not
inspect only the completed-effects table and mistakenly release their claims.
Store private remediation detail in the journal; return safe references/codes publicly.

PROVISIONED is a durable success boundary. No later start failure or client use
automatically deletes its runtime. Compensation permission ends at successful
publication; cleanup thereafter requires separately reviewed scope. Managed world
data is never disposable by implication.

Identical apply retries bind stored plan/create digest to one operation and return
that operation, in-flight or terminal, without a second directory, activation or
EULA write. Deterministic plan IDs survive restart. Changed approval is a conflict.
ROLLED_BACK and PARTIALLY_ROLLED_BACK are terminal recorded results, not implicit
permission to re-execute. A fresh attempt needs a new reviewed plan identity
(for example a different explicit server ID/leaf); a retained leaf is blocked.
No general repair/delete endpoint is introduced. Recovery of incomplete operations
continues the existing operation and original approved decisions.

### SQLite and repository proposal

Propose the next versioned migration after v7 (v8 if still available at implementation).
Leave adopted rows and 022D simulation effects unchanged; do not repurpose
`provisioning_external_intents`' one-row-per-attachment contract as a filesystem journal.

| Addition / extension | Required durable data and constraint |
|---|---|
| Tagged create-preview storage alongside `provisioning_plans` | Immutable executable snapshot, create digest, policy/profile/EULA revisions, source/config hashes and private path identities; distinguish from attachment preview. |
| `managed_runtime_definitions` | Unique server ID and origin operation; provider/host/profile, canonical private runtime identity, manifest, MANAGED ownership, version and PENDING_ACTIVATION / ACTIVE / RECOVERY_REQUIRED status. Shared claims enforce exclusion with adopted/legacy IDs. |
| `provisioning_file_intents` | Operation/effect/attempt/direction keys, current token, precondition, target/reference, approval hash, observed object evidence, mutation/reconciliation/compensation phase. Unique stable effect plus attempt identity; append history retained. |
| `provisioning_file_receipts` | Creation/open/copy/publication/removal evidence, identity/hash/size and current reconciliation token; no receipt without matching durable intent. |
| Trusted EULA acceptance records | Acceptance ID/revision, actor/time, terms reference, profile/host/server scope and revocation state; supplied through trusted operator policy/repository administration, never self-asserted by the HTTP body. |
| Existing applies/claims/journal projections | Discriminated managed-create execution, atomic multi-claim acquisition, definition publication CAS and finalization/release; reuse operations/events/audit, without SQL in routes/providers. |

Focused repository methods should persist preview, approve-and-claim-all, begin/observe/
receipt an effect, update leases/fences, persist pending definition, finalize active
definition plus result, and finish complete/partial rollback. Preserve the current
synchronous SQL transaction abstraction: no SQL transaction is held across artifact
streaming or a provider await. The host guard supplies external-effect serialization;
SQL commits separately protect intent, approval, claims and public transition facts.

Protect active definitions, acceptance provenance, ownership ledger and unresolved
effects/claims from ordinary operation/event retention. A display-only server_state
snapshot is not a reconstructable definition. DB failure after an effect retains a
recoverable intent; DB failure before an intent prohibits that effect. Persist safe
event/audit projections transactionally; WebSocket delivery is notification, not a
completion guarantee. Avoid promising a general exactly-once outbox subsystem here.

### API proposal

Reuse the authenticated internal-admin policy and existing plan/read routes.
Extend CREATE preflight with a safe `creation` projection while keeping `attachment`
and existing adopted responses unchanged. Do not overload `/attachments` to copy or
create files: its reference-only ownership contract remains ADOPTED.

| Route | Proposed managed-create behavior |
|---|---|
| POST `/api/provisioning/plans` | Existing schema-v1 create request, provider-validated profile/acceptance references; durable descriptive plan. No raw paths, profile bodies, commands or acceptance booleans. |
| POST `/api/provisioning/preflight` | Existing `{planId}`; persist/return safe `creation:{digest,ownership,profileRef,files,endpoints,deferredValidations}` for executable CREATE, never a fabricated attachment preview. Initial plan digest is insufficient for approval. |
| GET `/api/provisioning/plans/:id` | Stored plan and safe creation preview/revision, preserving existing adoption projection. |
| POST `/api/provisioning/plans/:id/apply` | Distinct new route; `{approved:true,digest}` approves the stored managed-create preview. Trusted principal supplies actor. Reject ADOPT or absent/unsupported create capability. |
| GET `/api/operations/:id` | Existing operation API with sanitized managed-create result/phase/residual summaries; no parallel operations store. |
| Existing discovery/scoped lifecycle/history/WebSocket routes | Expose completed managed definitions and keep 022F authorization, per-server queues and provider identity. Pending/quarantined children cannot bypass admission through legacy URLs. |

Return 202 plus the existing operation reference for queued/in-flight accepted apply,
200 for terminal replay with its truthful state, 400 for schema/approval syntax errors,
401/403 for existing auth outcomes, 404 for absent plan, 409 for stale/conflicting
approval or claims, and 422 for unsupported provider/profile/license/creation policy.
Once accepted, effect failure is an operation result, not a fabricated HTTP success
claim; poll the operation state. Duplicate in-flight callers receive the same ID.

Add an explicit supported-mode/policy gate (for example `server.provision.create`)
alongside apply capability. Existing Java plan/preflight/adopt capability does not
authorize CREATE. Native Bedrock returns unsupported here; synthetic simulation
cannot masquerade as real Java creation. Missing policies/root access/guard support
disable mutation. Authentication is checked before resolving trusted references.

All HTTP/body/plan/profile/error/event projections require allow-listed fields.
Never serialize private definitions, raw exceptions, host-lock metadata, absolute
artifact/root/Java paths, tokens or launch arguments. Keep operation/history/WebSocket
authorization and add tests for managed IDs through both scoped and legacy routes.
A reference string that happens to contain a filesystem path must fail schema
validation, not be looked up or passed to the gateway.

### Deterministic implementation test gates

Use node:test fixtures, temporary databases and injected clocks/barriers; no live
Paper/BDS runtime or network download is part of these tests. These gates are
proposed coverage, not tests executed in this architecture task.

| Gate | Required proof |
|---|---|
| Plan/preflight isolation | Stable generated ID/leaf and hashes; no runtime/artifact writes, claims, bind probes, process starts, EULA changes or provider activation; persisted previews allowed. |
| Paths and collisions | Root equality, traversal, separator/device/ADS names, case aliases, symlinks/junctions/reparse points, protected/source/adopted overlap, pre-existing empty targets and substitution all fail safely. |
| Atomic claims | Two DB connections compete for server/path/port; exactly one full claim set wins, loser has none; legacy/adopted/synthetic aliases conflict; disjoint TCP/UDP namespaces remain compatible. |
| Artifact/config correctness | Exact approved source/copy hash and size, source drift/short copy/unreadable file/hard-link alias rejection, no source mutation; generated endpoint/level/EULA bytes match the provider manifest. |
| Licensing | Missing/revoked/out-of-scope record and forged body booleans fail before effects; accepted record is audited/pinned; adopted EULA bytes stay untouched. |
| Ownership | MANAGED discovery versus ADOPTED, marker + DB identity required, same-hash foreign objects never imply ownership, no delete capability granted. |
| Effect crashes | Interrupt before and after every intent/open/mkdir/marker/copy/config/publication/receipt/definition/activation/finalization boundary; reconcile known effects, quarantine unknown provenance. |
| Fencing | Suspended old worker with outstanding I/O retains host guard; lease expiry alone cannot authorize another writer; stale token cannot mutate/receipt/activate/remove; termination releases guard for reconciliation. |
| Compensation | Reverse-order owned cleanup, repeated removal reconciliation, altered files/unknown children/permission or DB failure produce honest partial rollback retaining all claims and prerequisites. |
| Retry/restart | Same approval returns one operation/definition; completed replay never writes files; incomplete restart resumes/reconciles safely; partial rollback stays terminal and blocks reuse. |
| Provider collection | Multiple Java managed children and adopted/legacy servers coexist, one subscription/event, guarded pending activation, correct ownership, unknown/wrong provider ID refused. |
| Remain stopped | Mock every spawn/start/shell function to fail during create/recovery; fresh success is offline/PROVISIONED, worlds deferred, never READY. |
| Later lifecycle boundary | Managed start verification rejects artifact/endpoint/EULA drift; restart hydration starts no process; a failed explicit start retains successful created storage. |
| API security | Admin auth, unknown fields/path/profile/actor injection, stale digest and unsupported Bedrock CREATE; all public error/history/WebSocket/discovery responses omit paths/secrets/launch details. |
| Backward compatibility | Run existing attachment, config/parser/integrity, routing/API, contracts and simulation suites unchanged; adopted verification stays exact and the known Bedrock content failure remains isolated. |
| Storage/platform | Supported exclusive/no-clobber/no-follow/durability primitives verified on Windows; fault injection plus real second-process guard test, beyond an in-process mock. |

The implementation validation baseline is lint, focused creation and existing
attachment/provisioning/routing tests, contracts, full suite with the known unrelated
failure explicitly reported, build and diff checks. This design adds no tests and
does not assert any fresh-create validation is already green.

### Later opt-in live acceptance

Define a new managed-CREATE acceptance harness later; do not implement or run it
during this task. Use an operator-approved **disposable managed root**, separate
from the authoritative Java/BDS installs, their worlds and the 022F adopted roots.
Approved artifact inputs are read-only; evidence lives outside the managed root.
Require explicit admin/profile/EULA approval and a disposable-root marker/policy,
never pick the repository cwd as an implicit destination.

First Java managed-CREATE acceptance must record:

1. Real CREATE plan/preflight/approval through the API, pinned local profile and
   explicit prior EULA-acceptance reference; no downloads or arbitrary shell input.
2. New directory, exact copied hashes, provider-generated config/EULA, durable
   intent/effect/receipt history and retained claims; source artifacts unchanged.
3. MANAGED provider-scoped discovery, correct endpoint/level intent, operation
   PROVISIONED and offline, with no process launch, `playerAcceptance=false`,
   `firstBootPerformed=false` and world readiness explicitly deferred.
4. GameHub restart restores that definition, claims and scoped child without starting;
   identical apply replay creates no additional files/servers.
5. A second distinct managed runtime is isolated; ID/path/endpoint collisions refuse
   mutation. Existing adopted/legacy runtimes and source installation hashes remain
   unchanged.
6. Controlled incomplete-operation fault/restart proves ownership-limited compensation
   and truthful residual claims, using only disposable resources.
7. Cleanup evidence names only operation-owned disposable resources. Completed-server
   teardown is a separate explicit test cleanup authorization, not a new DELETE API
   or an automatic rollback of successful provisioning.

Any later opt-in first boot is a separate lifecycle acceptance, requiring explicit
start/world-write permission and declared boot-time resources. Only that run may
claim real startup/readiness/world discovery; human/player acceptance remains separate.
Failure of a later start does not rewrite the successful CREATE result or silently
remove the managed runtime. Bedrock fresh-create gets its own later bundle/dual-stack
acceptance once that adapter is implemented, without rerunning or relabeling adopted
BDS acceptance as proof of CREATE.

### Remaining work and operator decisions

Before 022G implementation can begin safely, the operator must choose:

- The local service-owned managed root(s), disjoint protected installations/sources,
  access controls and supported filesystem; no default production path is inferred.
- The Java profile, pinned local files/hashes, approved Java reference and compatibility
  attestation; whether any additional local boot resources must be enumerated.
- The prior EULA-acceptance record, terms reference/revision and its server/profile
  scope. Recommended stopped-create policy requires acceptance before apply.
- The allowed fixed IPv4 bind/port and safe world-name defaults, plus trusted endpoint
  inventory; no address/port migration or pool allocation is inferred.
- The evidence/disposable acceptance root and separate cleanup/start permission when
  the later live harness is authorized.

Implementation must select/prove the host mutation guard and safe filesystem gateway;
this is a technical release blocker, not a new request to authorize this document.
Missing operator inputs keep CREATE disabled. The recommended Java-first/Bedrock-later
boundary is a design decision; expand it only through a separately reviewed scope.

Overall JBGH-022 still needs implementation/migration/API/auth/guard/compensation tests
and authorized stopped-CREATE acceptance. Java-first completion alone does not close
the whole two-provider provisioning goal. Native BDS managed creation, its approved
runtime-bundle/license model and live acceptance remain explicit follow-up work.
Any claims of first-boot readiness, content import integration, general process adoption
or player lifecycle acceptance need their own scoped evidence. The Bedrock
ContentImportPlanner 422 gap is neither fixed nor a hidden prerequisite for
content-free Java CREATE; it remains separately tracked. Downloads, upgrades and
deletion are not silently added to the closure criteria.

## JBGH-022G-A implementation — Synthetic and Java managed CREATE

Status: CLOSED / PASS — disposable Java CREATE acceptance completed on 2026-10-15.
Implementation validation: 2026-10-14. Overall JBGH-022 remains OPEN.
This record specifies the implemented boundary; earlier 022G text remains the
broader architecture proposal. The stopped Java live CREATE acceptance is recorded below.

### Implemented boundary and provider responsibilities

The new `ManagedCreationService` creates a stopped, durable MANAGED runtime for
supported scoped synthetic and Java providers. It does not replace the 022D
simulation executor or change the adopted-runtime verifier. Native Bedrock has
no managed-create adapter/capability and no CREATE filesystem path.

Core resolves trusted root/profile references, verifies preview approval, acquires
all server/canonical-path/endpoint claims transactionally, coordinates intents,
filesystem receipts, definition activation, recovery and compensation. The narrow
`ManagedFilesystem` gateway accepts only the resolved operation target and
declarative file intents; providers receive no arbitrary mutation callback.

`JavaManagedCreation` owns the Paper destination, exact minimal configuration,
safe level name, Java-21 compatibility metadata and license rendering. It supports
one fixed IPv4 TCP `java-paper` game endpoint whose bind address matches the trusted
profile. RCON/query are false; Geyser, extra listeners, allocation, installation
and downloads are unsupported. It copies only the explicitly approved local Paper
file, never the Java executable or a source installation tree.

Generated files are `paper.jar`, `server.properties` and `eula.txt`, plus neutral
GameHub operation-ownership metadata. Deterministic properties contain exactly
server-port, server-ip, level-name, enable-rcon=false and enable-query=false.
EULA bytes are exactly `eula=true\n`. A world directory is not created by apply:
world readiness and first boot are explicitly deferred.

Synthetic uses the same new creation/journal/recovery/compensation mechanism with
virtual endpoints and a neutral deterministic `runtime.json` manifest. Existing
synthetic simulation and its SQLite-only effects remain unchanged.

Success is `state=PROVISIONED`, `outcome=applied`, with no lifecycle start operation.
It never reports READY. Scoped provider construction/registration starts no process.
Pending definitions/children cannot be discovered or addressed through lifecycle
routes until finalization. Existing queues, provider identity and single-forwarded
player-event subscriptions are reused, with MANAGED discovery distinct from ADOPTED.

### Trusted policy and explicit prior license authorization

Operator policy extends `RuntimeAttachmentPolicy` with optional `managedCreate`.
CREATE is disabled unless it selects `filesystem="local-exclusive"`: the operator
must provide local, service-exclusive managed roots belonging to this SQLite
database, disjoint from protected installations and artifact sources. Network/UNC
storage and separate databases sharing a managed root are outside this contract.

Clients submit only a safe `profileRef`, optional safe `worldName`, a managed
`rootId`/leaf and the approved endpoint request. Direct launch/artifact/hash/EULA
options cannot be combined with a profile-based Java CREATE. The old descriptive
artifact-reference plans remain planning data, not a bypass to the new apply route.

A trusted profile pins provider/revision, one artifact reference/hash, Java
reference/hash with `compatibility="java-21"`, acceptance reference and
configuration bind/world policy. Artifact locations remain private operator maps.
Hashing checks regular-file identity/type, single-link sources, stable size/content,
and a bounded maximum (default/cap 256 MiB); generated files are bounded to 64 KiB.
Copied bytes are verified before atomic no-overwrite publication.

Example trusted configuration fragment (operator-supplied references/paths/hashes,
never a request body):

```json
{
  "managedCreate": {
    "filesystem": "local-exclusive",
    "profiles": {
      "java-local-v1": {
        "providerId": "minecraft",
        "revision": "1",
        "artifacts": [{"reference": "approved-paper", "sha256": "<approved SHA-256>"}],
        "runtime": {
          "reference": "approved-java",
          "sha256": "<approved SHA-256>",
          "compatibility": "java-21"
        },
        "acceptanceRef": "prior-operator-acceptance",
        "configuration": {"bindAddress": "127.0.0.1", "worldName": "managed-world"}
      }
    },
    "acceptances": {
      "prior-operator-acceptance": {
        "revision": "1",
        "actor": "<trusted accepting operator>",
        "acceptedAt": "<explicit acceptance timestamp>",
        "termsRef": "<operator-reviewed terms reference>",
        "hostId": "<configured local host>",
        "profileId": "java-local-v1",
        "profileRevision": "1",
        "authorizeGeneratedAcceptance": true
      }
    },
    "endpointInventory": {"complete": true, "bindings": []}
  }
}
```

The surrounding trusted policy supplies `managedRoots`, `artifactLocations`,
protected paths and host identity. The policy-file loader converts the optional
JSON inventory into a read-only inventory callback; injected policies may supply
their own callback. A complete inventory is required for concrete CREATE endpoints,
and apply also performs a short-lived TCP availability probe. Inventory is not an
OS reservation; claims conservatively retain the shared host/transport/port bucket.

Prior acceptance requires a nonblank trusted actor, valid timestamp, terms reference,
record revision, matching host/profile revision and optional exact server scope.
Missing/revoked/out-of-scope acceptance blocks preflight. Profile/acceptance fingerprints
are rechecked before effects, receipts and finalization. A request-body boolean
cannot grant acceptance. Policy records are not created or widened by provisioning;
the approved fingerprint is durable in the preview/operation. Java compatibility is
operator-attested/pinned metadata, not a binary version probe or first-boot proof.

Java configured roots, adopted runtime roots and bootstrap Java/BDS installations
are protected automatically for CREATE. Explicit protected-root and artifact-source
overlap also fail. This additional bootstrap protection is held in CREATE policy,
so the existing ADOPT preflight/acceptance behavior remains unchanged.

### API and ownership

POST `/api/provisioning/plans` remains descriptive and requires existing admin auth.
Profile-based CREATE preflight persists a separate verified preview and returns a
safe `creation` projection with its own digest. No directories, claims, bind probes
or runtime activation occur during planning/preflight.

The new distinct route is:

```text
POST /api/provisioning/applies
{ "planId": "<stored plan>", "digest": "<verified creation digest>", "approved": true }
```

It rejects ADOPT, missing approval, digest/profile/policy drift, unknown fields,
untrusted paths, unavailable CREATE capability and conflicts. Actor identity comes
from the existing authorization principal. The first slice awaits completion and
returns HTTP 200 with the truthful terminal operation/result metadata, including
failed/partial outcomes; it does not claim asynchronous 202 queuing is implemented.
Identical terminal replay returns the same result without another effect or journal.

Responses expose operation/provider/server IDs, state/outcome, MANAGED ownership,
safe relative file/leaf/hash/endpoint previews, and safe residual directory/claim
summaries. They omit absolute root/source/Java paths, generated license contents,
terms data, raw filesystem exceptions, tokens and launch arguments.
`/attachments` retains ADOPTED semantics. Existing operation/history/WebSocket
authorization and legacy lifecycle URL checks also cover managed servers.

Managed ownership keeps `destructiveOwnership=false`. Successful definitions
retain their claims while stopped. No DELETE, decommissioning or automatic cleanup
of successful runtimes is introduced. A later start is a separate explicit lifecycle
operation and must verify managed files/profile/license; effective drift fails
closed. Completed managed Java runtimes use the provider-owned semantic configuration
policy recorded under JBGH-022G-B below; original CREATE receipts remain byte-exact.
Paper first boot and its dependencies are outside the stopped-CREATE acceptance.

### Schema v8 and the implemented external-effect protocol

Migration v8 adds:

- `provisioning_create_previews`: separately tagged, hash-pinned executable previews.
- `managed_runtime_definitions`: unique server/origin operation, MANAGED descriptor,
  private canonical identity/manifest and PENDING_ACTIVATION / ACTIVE status.
- `provisioning_file_intents`: stable operation/effect identity, safe relative target,
  effect kind, expected hash, original fence and compensation direction.
- `provisioning_file_receipts`: observed device/inode/hash/size, current fence and
  compensation outcome.

Existing plans/applies/claims/journal/operation/event/audit tables are reused.
The new operation kind is `executionKind="managed-create"`, projected through
`server.provision.apply`. Existing attachment tables and simulation effects are
not repurposed. The approved private snapshot binds profile/acceptance fingerprint,
canonical root identity, sources, config hashes, fixed endpoints and generated leaf.

Intent commits precede mkdir, temp creation, artifact/config write, file publication
and temp removal. Definition, activation and finalization have journaled intent
boundaries; pending definition persistence and final ACTIVE/result publication use
repository transactions. Each file has an operation-owned temp, a checked write
receipt, atomic same-filesystem hard-link publication without overwriting, and a
journaled temp removal. Files are flushed before completed receipts.

Device/inode identities are read with bigint filesystem stats and persisted as
exact decimal strings. Unsafe numeric identities fail closed; this avoids rounding
large NTFS file IDs when proving ownership during recovery and compensation.

**Implemented fencing refinement:** `managedGuard` holds SQLite BEGIN IMMEDIATE
around a current lease/token check, synchronous constrained primitive and receipt
observation/commit. A second database process cannot acquire the writer lock or
advance the fence during that primitive. There is no filesystem await beneath the
lock and async callbacks are forbidden. This substitutes a per-primitive SQLite
writer-lock protocol for the proposed long-lived OS host mutex. SQL does not make
the filesystem effect transactional: a crash can still leave an effect without
its committed observation. Large artifact copies use bounded chunks synchronously
under the guard and can temporarily block writes; the profile size cap is enforced.

Provider construction may await, but final child insertion is synchronously guarded
again. Pending children are quarantined; final ACTIVE definition and PROVISIONED
result commit together. Completed restart hydration checks current durable definition
identity before publication and never starts a process.

### Recovery and compensation limits

Recovery supports crashes after claims/directory intent, receipted directory creation,
artifact write/publication/temp removal, config/EULA write, pending definition,
provider activation and immediately before finalization. It also handles an
interrupted copy and a lost publication receipt by checking the previously recorded
temp inode/hash. It never adopts a same-hash foreign file or overwrites a destination.

A directory created before its identity/ownership receipt committed is ambiguous:
retain that path and all claims, return PARTIALLY_ROLLED_BACK and require operator
review. Do not infer cleanup authority from an existing path or marker. An active
unexpired worker cannot be taken over; expired recovery increments the token.
Stale workers cannot mutate files, commit receipts, publish a child or compensate.

Rollback removes only the operation's activation/definition, identity/hash-proven
created files and an empty owned directory. Removal intents are durable before
unlink/rmdir, and removal receipts permit interrupted rollback to resume safely.
Unknown directory contents are retained; modified files, changed identities or
failed cleanup preserve prerequisites and claims with explicit residual summaries.
No recursive deletion, source mutation, adopted-file cleanup or general repair API
is implemented. Partial rollback is terminal and requires explicit future review.

Once PROVISIONED, later lifecycle failure does not roll back created storage.
Restart restoration is metadata/runtime rehydration, not running-process recovery.
File/SQLite durability and cross-process exclusion were fixture-tested on this host;
power-loss atomicity, network filesystems and uncoordinated/malicious root writers
are not claimed.

### Implementation validation

Added 77 focused CREATE tests across managed apply, preflight/security and API suites,
plus a disposable fixture helper. They cover deterministic Java/synthetic output,
offline/no-start behavior, ownership, source preservation, path/profile/license
failures, atomic cross-connection claims, the real second-process SQLite lock,
stale async activation, every supported crash boundary, compensation interruption,
foreign/modified data preservation, API authorization/redaction, completed hydration,
exact large-file identity handling, private managed world-path redaction,
and real v7-to-v8 adopted-row preservation. The existing v4 migration fixture now
removes every post-v4 table before testing forward migration.

Validation results:

- Lint: PASS.
- Contracts: 5/5 PASS.
- Focused provisioning/apply/attachment/API/provider tests: 226/226 PASS.
- Full suite, twice: 311/312 PASS in each run. The sole failure remains
  "Content Library API maps Bedrock plans to the configured native provider root",
  expected 201, received 422. No new failure is excluded.
- Build: PASS with the existing CJS `import.meta` warning.
- Diff checks: PASS.

The implementation validation above preceded the disposable live CREATE acceptance
recorded below. Native Bedrock CREATE and its expanded-runtime bundle model remain
deferred. Overall JBGH-022 remains OPEN.

### JBGH-022G-A: CLOSED / PASS

Date: 2026-10-15

Disposable Java managed CREATE acceptance completed successfully against the
PROVISIONED/offline boundary using the approved local Paper profile and explicit
prior EULA authorization.

| Field | Verified result |
| --- | --- |
| Provider | minecraft |
| Server | java-022g-live |
| Mode | CREATE |
| Ownership | MANAGED |
| Profile | approved |
| Endpoint | 127.0.0.1:27051 |
| World | managed-world |
| Preflight | PASS |
| State | PROVISIONED |
| Outcome | applied |
| Runtime status | offline |
| Residuals | none |
| First boot | not performed |
| Player acceptance | not performed |

Created:

- `.jbgh-owner.json`
- `paper.jar`
- `server.properties`
- `eula.txt`

Paper SHA-256:

```text
05209AC5A423BF98136DD775A87D4324955D2C865F887B20EDD6B43A59CB36C4
```

Preflight digest:

```text
17220ec68ea8c6ad205efeddabf9a3a9d1c7d1d66b346c019b64933524360fce
```

Operation:

```text
create_plan_b144d3acd3c8bfc467bb4957d6f864f9e3539e280fccbf33dc520584b46a9025
```

All four created files matched the preflight manifest. The copied Paper artifact
matched the approved source hash. Generated `server.properties` matched the intended
stopped profile, including `enable-rcon=false` and `enable-query=false`; generated
`eula.txt` contained `eula=true`. Source Paper, configuration, EULA and Java executable
hashes remained unchanged. The runtime stayed offline and port 27051 had no Java
listener. GameHub is stopped following acceptance; neither port 3000 nor port 27051
has a listener.

**JBGH-022 remains OPEN.**

Deferred:

- Java first-boot / READY acceptance
- Java player acceptance
- Bedrock managed CREATE
- Power-loss / hostile host-mutation live recovery
- Download/licensing acquisition workflows

JBGH-022G-B extends this stopped-CREATE boundary through Java first-boot → READY acceptance.

### JBGH-022G-B initial live run: BLOCKED / LIVE DEFECT FOUND

Date: 2026-10-15. This is the initial live result, before the blocker fix below.

| Gate | Initial live result |
| --- | --- |
| First boot | PASS; Paper reached its normal `Done` message |
| World creation/readiness | PASS; `managed-world` discovered and validated |
| Provisioning-owned semantic configuration | PASS; all five protected values unchanged |
| Immutable artifact integrity | PASS; ownership metadata, Paper and EULA hashes unchanged |
| Online API observation | NOT CAPTURED |
| Live socket observation | NOT CAPTURED |
| Restartability after first boot | FAIL; `SERVER_START_FAILED` / `ARTIFACT_DRIFT` |

The acceptance log probe encountered a Windows file-sharing violation and initiated
cleanup before the online API/socket observations were captured. The retained Paper
log proves that startup reached `127.0.0.1:27051`, prepared `managed-world`, reached
`Done`, then saved all dimensions and stopped. The GameHub stop operation completed,
and the final runtime was offline with port 27051 closed. No player joined.

The actual production blocker is that completed-runtime verification treated
Paper-normalized `server.properties` as byte-exact creation artifact drift. Paper
added defaults/comments while preserving the managed configuration. The existing
runtime and its rewritten configuration are retained for the rerun.

### JBGH-022G-B blocker fix: managed Java configuration verification

Only completed (`PROVISIONED`) managed runtime lifecycle/restoration verification
may use an optional provider-owned file-content validator. The Java provider selects
only `server.properties` and compares these required active properties with the
original approved generated content:

- `server-port`
- `server-ip`
- `level-name`
- `enable-rcon`
- `enable-query`

Active entries must use explicit `key=value` syntax. Comments, blank lines, ordering,
Java formatting whitespace around keys/separators and additional Paper defaults are
permitted. Trailing value whitespace remains meaningful and is not stripped. Unrelated
escaped values such as `level-type=minecraft\:normal` are ignored. Missing/changed
protected values, protected-value escaping, duplicate keys, malformed entries,
unsupported continuation lines and invalid UTF-8 fail with `ARTIFACT_DRIFT`.

The filesystem gateway still verifies the managed parent/root, exact owned file
identity, a single-link regular configuration file and bounded/stable reads (64 KiB
maximum). Ownership metadata, Paper and EULA bytes remain hash-verified; profile,
Java executable and prior EULA authorization verification are unchanged. Original
creation manifests, approval digests, durable receipts, unfinished CREATE recovery
and compensation remain byte-exact. This change neither rewrites the live runtime
nor changes ADOPTED attachment, Bedrock or synthetic runtime verification.

The exact real Paper first-boot configuration is retained as a deterministic test
fixture. Regression tests exercise normalization, protected-key drift, malformed
syntax, lifecycle/restoration, immutable files, EULA revocation, filesystem guards,
unfinished CREATE recovery and the synthetic default verification path.

### JBGH-022G-B: CLOSED / PASS

Date: 2026-10-15. Managed Java first boot was validated against the existing
`java-022g-live` runtime. The same managed definition and acceptance database were
retained. Before rerun, `server.properties` still had the exact first-boot rewritten
hash `DA88378573AAE9CC2C2D8DA414581A71A54F5F907855D43448AB275AF23CB639`.
No runtime configuration was manually rewritten, and no runtime was recreated.

| Gate | Verified rerun result |
| --- | --- |
| Provider / server | minecraft / java-022g-live |
| Recovery after GameHub restart | MANAGED / offline |
| GameHub start operation | completed; non-simulated |
| Live API observation | online / MANAGED |
| Actual Java listener | 127.0.0.1:27051; java.exe PID 10668 |
| Paper readiness | normal `Done (14.897s)` message from this boot |
| World | managed-world discovered; validation valid=true |
| Ownership metadata / Paper / EULA hashes | unchanged |
| Protected active properties | all five unchanged |
| Raw server.properties hash | changed; permitted normalization |
| GameHub stop operation | completed; non-simulated |
| Final state | MANAGED / offline; port 27051 closed |
| Player acceptance | not performed |

Start operation: `op_1792085034455_cbd6e63f`.
Stop operation: `op_1792085053648_3d57c20d`.
The CREATE result remains PROVISIONED / applied; READY is runtime acceptance
evidence, not a rewrite of the provisioning result. The acceptance log reader used
shared reads with bounded retries to avoid the earlier Windows sharing violation.

Blocker-fix validation:

- Lint: PASS.
- New semantic/runtime-integrity regressions: 35/35 PASS, including the exact real
  first-boot configuration fixture.
- Focused provisioning/attachment/provider tests: 261/261 PASS.
- Contracts: 5/5 PASS.
- Full suite: 346/347 PASS. The sole failure remains the unrelated Content Library
  Bedrock native-provider-root case, expected 201 and received 422.
- Build: PASS with the existing CJS `import.meta` warning.
- Working/new-file diff checks: PASS.

JBGH-022G-B is CLOSED / PASS. Player acceptance remains deferred.
GameHub was stopped following acceptance; the Java runtime remains offline and
port 27051 is closed. Overall JBGH-022 remains OPEN.

The next slice is Bedrock managed CREATE.
