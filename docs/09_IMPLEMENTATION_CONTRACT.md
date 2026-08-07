# JBGH-009 - Implementation Contract

Version: 0.1.0

Status: DRAFT

Product: JB3 GameHub

Document ID: JBGH-009

Depends on: JBGH-001 -> JBGH-008

Consumed by: implementation phase, backend services, provider modules, API integration tests, AI Studio

---

## 1. Implementation Objective

JBGH-009 converts architecture into an executable build specification for the first real platform slice.

Initial vertical slice:

```text
GameHub Core
     v
Provider Manager
     v
Minecraft Provider
     v
Geyser / Paper
     v
Live server
```

Implementation priority:

- prove real control/observability of existing infrastructure
- preserve provider abstraction boundaries
- avoid polished dashboard-first delivery

---

## 2. Repository Structure Contract

Target structure:

```text
jb_gamehub_minecraft/
+-- apps/
|   +-- api/
|   +-- web/
+-- packages/
|   +-- core/
|   +-- provider-manager/
|   +-- minecraft-provider/
|   +-- api-contracts/
|   +-- ui/
+-- providers/
|   +-- minecraft/
+-- docs/
+-- tests/
```

Notes:

- Modular monolith boundaries are enforced by package contracts.
- Provider-specific implementation code remains under provider packages/modules.

---

## 3. Provider Manager Contract (v0.1)

Provider Manager must expose these capabilities:

- provider registration
- provider discovery
- capability advertisement and lookup
- lifecycle operations delegation
- status retrieval
- world enumeration/operations routing
- content/pack operations routing

Conceptual interface:

```ts
interface ProviderManager {
  register(provider: GameProvider): Promise<void>;
  listProviders(): Promise<ProviderSummary[]>;
  getProvider(providerId: string): Promise<GameProvider>;
  getCapabilities(providerId: string): Promise<CapabilityMap>;

  startServer(providerId: string, serverId: string): Promise<OperationRef>;
  stopServer(providerId: string, serverId: string): Promise<OperationRef>;
  restartServer(providerId: string, serverId: string): Promise<OperationRef>;

  getServerStatus(providerId: string, serverId: string): Promise<ServerStatus>;
  listWorlds(providerId: string, serverId: string): Promise<WorldSummary[]>;
  validateWorldContent(providerId: string, serverId: string, worldId: string): Promise<ValidationResult>;
}
```

---

## 4. Minecraft Provider v0.1 Contract

Minecraft provider v0.1 must implement:

- detect Paper presence/runtime availability
- detect Geyser presence/runtime availability
- connect to existing server deployment
- read server status
- execute start/stop/restart
- enumerate worlds
- validate Bedrock packs against world references

Bedrock validation requirements:

- parse world_behavior_packs.json
- parse world_resource_packs.json
- resolve manifest.json for installed packs
- verify UUID/version consistency
- emit structured validation results

---

## 5. First API Contract Set (v0.1)

Endpoints in scope:

```text
GET  /api/providers
GET  /api/providers/:id
GET  /api/servers
GET  /api/servers/:id
POST /api/servers/:id/start
POST /api/servers/:id/stop
GET  /api/servers/:id/status
GET  /api/servers/:id/worlds
```

Rules:

- endpoints are implemented through Provider Manager abstractions
- no endpoint may call Minecraft internals directly from GameHub core modules
- async operations return operation references where needed

---

## 6. First Real Vertical Slice

Execution path:

```text
Browser
   v
GameHub API
   v
Provider Manager
   v
Minecraft Provider
   v
Geyser/Paper
   v
Existing Minecraft server
```

Slice intent:

- prove real end-to-end control path
- produce live status observable via API
- validate that abstraction boundaries hold under real operations

---

## 7. Definition of Done (JBGH-009)

Implementation is complete for this contract when all are true:

1. GameHub discovers the Minecraft provider.
2. Provider reports its capability set.
3. GameHub detects running Geyser/Paper environment.
4. API reports actual server status from provider runtime.
5. Start/stop operations execute through provider abstraction.
6. No Minecraft-specific logic leaks into GameHub core modules.

---

## 8. Non-Goals for This Slice

Out of scope for JBGH-009 implementation target:

- polished/complete dashboard design
- cross-provider marketplace
- SaaS multi-tenancy
- advanced automation beyond guarded operations

This slice is infrastructure proof, not product polish.

---

## 9. Test Contract

Minimum test set:

- provider registration/discovery tests
- capability contract tests
- API to Provider Manager integration tests
- Minecraft provider runtime detection tests
- lifecycle operation tests (start/stop/status)
- world enumeration tests
- pack validation tests with UUID/version mismatch fixtures

Acceptance checks must run against the existing LAN setup profile.

---

## 10. AI Studio Consumption Guide

AI Studio should treat JBGH-009 as the executable contract for first implementation.

Before generating code, AI must verify:

1. Which module owns this behavior?
2. Does an API endpoint already exist for it?
3. Is provider abstraction preserved?
4. Are operations async where required?
5. Are audit/event side effects defined?
6. Are tests added for boundary behavior?

Generation must reject solutions that bypass Provider Manager.

---

## 11. Validation Checklist

```yaml
document: JBGH-009
version: 0.1.0
status: DRAFT

structure:
  apps_api_web: defined
  core_packages: defined
  provider_packages: defined
  tests_layer: defined

provider_manager:
  registration: required
  discovery: required
  capabilities: required
  lifecycle_routing: required
  world_content_routing: required

minecraft_provider_v0_1:
  paper_detection: required
  geyser_detection: required
  status_read: required
  lifecycle_ops: required
  world_enumeration: required
  pack_validation: required

api_v0_1:
  provider_endpoints: required
  server_endpoints: required
  lifecycle_endpoints: required
  status_world_endpoints: required

definition_of_done:
  provider_discovered: required
  capabilities_reported: required
  live_env_detected: required
  api_live_status: required
  lifecycle_through_abstraction: required
  no_core_minecraft_leak: required
```

---

## Implementation Gate

JBGH-009 defines the first executable platform contract.

Implementation should begin with Provider Manager plus Minecraft provider vertical slice, then layer dashboard behavior on top of working infrastructure APIs.
