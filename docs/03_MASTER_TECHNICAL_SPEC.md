# JBGH-003 - Master Technical Specification

Version: 0.1.0

Status: DRAFT

Document ID: JBGH-003

Product: JB3 GameHub

Depends on: JBGH-001, JBGH-002

Consumed by: JBGH-004, JBGH-005, JBGH-006, JBGH-007

---

## 1. Purpose

JBGH-003 translates the product requirements into a technical contract.

It defines:

- system components
- ownership boundaries
- interfaces
- data flows
- state management
- event handling
- security boundaries
- provider isolation
- AI context handling
- deployment responsibilities
- recovery behavior

The fundamental technical rule is:

GameHub Core must never need to understand how a particular game implements its server.

That responsibility belongs to the Provider.

---

# 2. Architecture Model

```text
+----------------------------------------------------------+
|                    PRESENTATION LAYER                    |
|                                                          |
| Dashboard | Admin UI | Child UI | Mobile/Tablet Browser |
+----------------------------+-----------------------------+
                             |
                             | HTTPS / WebSocket
                             v
+----------------------------------------------------------+
|                       API GATEWAY                        |
|                                                          |
| Authentication | Authorization | Rate Limiting | Routing |
+----------------------------+-----------------------------+
                             |
              +--------------+--------------+
              v              v              v
+------------------+ +----------------+ +-----------------+
| Server Manager   | | Provider       | | AI Studio       |
|                  | | Manager        | |                 |
| Lifecycle        | | Registry       | | Context         |
| Status           | | Discovery      | | Diagnostics     |
| Logs             | | Capabilities   | | Generation      |
| Backups          | | Adapters       | | Feedback        |
+--------+---------+ +-------+--------+ +--------+--------+
         |                   |                   |
         |                   v                   |
         |          +------------------+         |
         |          | Provider Runtime |         |
         |          +--------+---------+         |
         |                   |                   |
         |             +-----+-----+             |
         |             v           v             |
         |          Minecraft    Future          |
         |          Provider     Providers       |
         |             |                         |
         |       +-----+-----+                   |
         |       v     v     v                   |
         |     Paper Geyser Floodgate            |
         |                                       |
         +---------------------------------------+
```

---

# 3. Component Inventory

| Component | Responsibility | Must NOT own |
| --- | --- | --- |
| Presentation | User interaction | Business logic |
| API Gateway | External API boundary | Provider implementation |
| Auth Service | Identity/access | Game state |
| Server Manager | Lifecycle orchestration | Game-specific logic |
| Provider Manager | Provider registry/capabilities | UI |
| Provider Adapter | Game-specific translation | Global users |
| Status Service | Aggregate runtime state | Provider configuration |
| Event Bus | Event distribution | Business ownership |
| AI Studio | AI context/analysis | Direct unrestricted infrastructure access |
| Config Service | Configuration lifecycle | UI rendering |
| Audit Service | Security/admin events | Provider internals |
| Persistence Layer | Durable state | Provider-specific runtime state |
| Backup Service | Backup/restore orchestration | Game rules |

---

# 4. Ownership Boundaries

## 4.1 GameHub Core Owns

```text
Users
Authentication
Authorization
Servers
Provider registry
Canonical server state
Audit records
AI sessions
Dashboard state
System configuration
Events
```

## 4.2 Provider Owns

```text
Game-specific configuration
Game runtime
Game lifecycle translation
Game worlds
Game extensions
Game-specific validation
Game-specific diagnostics
Game-specific networking
```

## 4.3 Minecraft Provider Owns

```text
Paper
Geyser
Floodgate
Minecraft worlds
Minecraft resource packs
Minecraft behavior packs
Minecraft manifests
Minecraft server properties
Minecraft-specific lifecycle
Minecraft-specific diagnostics
```

This prevents Minecraft implementation details from leaking into GameHub Core.

---

# 5. Provider Interface Contract

Every provider SHALL implement a standard interface.

Conceptual TypeScript:

```ts
interface GameProvider {
  metadata(): ProviderMetadata;
  capabilities(): ProviderCapabilities;
  health(): Promise<ProviderHealth>;
  servers(): Promise<ServerSummary[]>;
  createServer(input: CreateServerInput): Promise<Server>;
  startServer(serverId: string): Promise<OperationResult>;
  stopServer(serverId: string): Promise<OperationResult>;
  restartServer(serverId: string): Promise<OperationResult>;
  status(serverId: string): Promise<ServerStatus>;
  logs(serverId: string): AsyncIterable<LogEvent>;
  validate(serverId: string): Promise<ValidationResult>;
  worlds(serverId: string): Promise<World[]>;
  importWorld(serverId: string, input: WorldImportInput): Promise<World>;
  exportWorld(serverId: string, worldId: string): Promise<WorldExport>;
  backup(serverId: string): Promise<Backup>;
  restore(serverId: string, backupId: string): Promise<OperationResult>;
}
```

This is a contract, not necessarily the final implementation syntax.

The formal interface will be finalized in JBGH-004 and JBGH-005.

---

# 6. Capability Discovery

Providers SHALL advertise capabilities dynamically.

Example:

```json
{
  "providerId": "minecraft",
  "capabilities": {
    "server": {
      "create": true,
      "start": true,
      "stop": true,
      "restart": true
    },
    "world": {
      "import": true,
      "export": true,
      "backup": true
    },
    "content": {
      "resourcePacks": true,
      "behaviorPacks": true,
      "plugins": true
    },
    "players": {
      "list": true
    }
  }
}
```

The frontend uses capability discovery to determine which controls to display.

This is critical to maintaining provider independence.

---

# 7. Server Lifecycle

Canonical lifecycle:

```text
                 +----------+
                 | CREATED  |
                 +----+-----+
                      |
                      | start
                      v
                 +----------+
                 | STARTING |
                 +----+-----+
                      |
              +-------+--------+
              v                v
         +---------+       +-------+
         | RUNNING |       | ERROR |
         +----+----+       +-------+
              |
              | stop
              v
         +---------+
         |STOPPING |
         +----+----+
              v
         +---------+
         | STOPPED |
         +---------+
```

Providers may expose additional states internally.

GameHub maps them to the canonical state model.

---

# 8. State Management

GameHub uses three conceptual state classes.

## 8.1 Persistent State

Stored durably:

```text
Users
Servers
Providers
Permissions
Configuration
Audit logs
Backups
AI conversations
```

## 8.2 Runtime State

Transient:

```text
CPU
Memory
Player count
Process ID
Network state
Current operation
Server health
```

## 8.3 Event State

Time-dependent events:

```text
SERVER_STARTED
SERVER_STOPPED
PLAYER_JOINED
PLAYER_LEFT
PACK_VALIDATION_FAILED
SERVER_ERROR
PROVIDER_OFFLINE
```

Events should be append-oriented and timestamped.

---

# 9. Data Flow: Server Provisioning

```text
User
 |
 v
Dashboard
 |
 v
API
 |
 v
Authorization
 |
 v
Server Manager
 |
 v
Provider Manager
 |
 v
Minecraft Provider
 |
 +-- Validate runtime
 +-- Prepare directories
 +-- Configure Paper
 +-- Configure Geyser
 +-- Configure Floodgate
 +-- Configure world
 +-- Validate content
 |
 v
Server Runtime
 |
 v
Health Check
 |
 v
RUNNING
```

Every stage should emit structured events.

---

# 10. Data Flow: Real-Time Status

```text
Game Runtime
     |
     v
Provider Adapter
     |
     v
Status Normalizer
     |
     v
Event Bus
     |
 +---+--------+
 v            v
Dashboard   Analytics
```

The dashboard should not repeatedly interrogate every provider unnecessarily.

A hybrid approach is preferred:

- polling for provider health
- events for lifecycle changes
- streaming for logs
- periodic refresh for runtime metrics

---

# 11. Data Flow: AI Context Assembly

AI must receive structured context, not a random dump of the entire system.

```text
User Request
     |
     v
Context Builder
     |
     +-- User permissions
     +-- Provider
     +-- Server state
     +-- Relevant configuration
     +-- Relevant logs
     +-- Recent events
     +-- Provider documentation
     |
     v
Context Policy
     |
     +-- Remove secrets
     +-- Remove unauthorized data
     +-- Reduce irrelevant data
     |
     v
AI Provider
```

Example

If a Minecraft server fails to load a world, AI should receive:

```text
Provider: Minecraft
Runtime: Bedrock
World: Celestial Castle serverV2
Error: invalid content
Referenced pack IDs
Installed pack manifests
Relevant content log
Server version
```

It should not receive unrelated user data.

---

# 12. Data Flow: Parental Rules

```text
Player Action
      |
      v
Authorization / Policy Engine
      |
      +-- User
      +-- Role
      +-- Schedule
      +-- Server
      +-- Rule
      |
 +----+----+
 v         v
ALLOW     DENY
 |         |
 v         v
Provider  Audit Event
```

The policy engine belongs to GameHub Core.

The provider merely executes the permitted operation.

---

# 13. Minecraft Content Validation

This becomes the first major provider-specific implementation.

```text
World Import
     |
     v
Minecraft Provider
     |
     +-- Read world_behavior_packs.json
     +-- Read world_resource_packs.json
     +-- Extract referenced UUID/version
     +-- Locate installed packs
     +-- Read manifest.json
     +-- Compare UUID
     +-- Compare version
     +-- Resolve dependencies
     |
     v
Validation Result
```

Possible results:

```text
VALID
MISSING_PACK
VERSION_MISMATCH
UUID_MISMATCH
MANIFEST_INVALID
DEPENDENCY_MISSING
DUPLICATE_PACK
UNSUPPORTED_CONTENT
```

This is precisely the kind of provider intelligence that the original Bedrock server troubleshooting exposed.

---

# 14. Error Handling

Errors SHALL be structured.

Example:

```json
{
  "code": "PACK_VERSION_MISMATCH",
  "provider": "minecraft",
  "serverId": "srv_123",
  "severity": "error",
  "message": "The world requires a different pack version.",
  "details": {
    "packId": "...",
    "required": "1.1.3",
    "installed": "1.0.8"
  },
  "recoverable": true,
  "recommendedActions": [
    "install_required_version"
  ]
}
```

---

# 15. Error Categories

```text
VALIDATION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
PROVIDER_ERROR
RUNTIME_ERROR
NETWORK_ERROR
CONTENT_ERROR
CONFIGURATION_ERROR
STORAGE_ERROR
AI_ERROR
SYSTEM_ERROR
```

AI can translate these into natural language, but the underlying machine-readable error must remain authoritative.

---

# 16. Recovery Patterns

## Provider Failure

```text
Detect
 v
Mark provider DEGRADED/OFFLINE
 v
Stop new operations
 v
Preserve existing state
 v
Retry health check
 v
Recover
```

## Server Crash

```text
Process exits
 v
Provider detects failure
 v
Server -> ERROR
 v
Capture logs
 v
Generate diagnostic event
 v
Optional restart policy
```

Automatic restart must be configurable.

## Network Failure

The local management plane should remain functional where possible.

External dependencies should fail independently.

Example:

```text
Internet unavailable
       |
       +-- Local dashboard -> WORKS
       +-- Local Minecraft -> WORKS
       +-- Local administration -> WORKS
       +-- External AI -> DEGRADED
```

---

# 17. Security Model

## 17.1 Trust Zones

```text
+-------------------------------+
| Trusted GameHub Core          |
|                               |
| Auth / API / Database         |
+--------------+----------------+
               |
        Provider Boundary
               |
+--------------v----------------+
| Provider Runtime              |
|                               |
| Minecraft / Paper / Geyser    |
+--------------+----------------+
               |
        Untrusted Content
               |
+--------------v----------------+
| Worlds / Packs / Plugins      |
+-------------------------------+
```

---

# 18. Sandboxing

User-generated content must be treated as untrusted.

Potentially dangerous content includes:

- server plugins
- scripts
- custom packs
- imported worlds
- executable files
- configuration files

GameHub must never assume that uploaded content is safe merely because it originated from another GameHub user.

---

# 19. Authentication and Authorization

Recommended hierarchy:

```text
User
 |
 +-- Roles
      |
      +-- PLAYER
      +-- PARENT
      +-- EDUCATOR
      +-- ADMIN
      +-- DEVELOPER
```

Authorization should operate on:

```text
resource
+
action
+
user
+
provider
+
server
```

Example:

```text
PLAYER
  -> view server
  -> join server

PARENT
  -> view child activity
  -> manage access

ADMIN
  -> manage server

DEVELOPER
  -> manage providers
```

---

# 20. AI Security Boundary

AI SHALL NOT directly receive unrestricted access to the operating system.

Instead:

```text
AI
 |
 v
Action Proposal
 |
 v
Policy Engine
 |
 v
Authorization
 |
 v
Validated Operation
 |
 v
Provider
```

An AI response such as:

Delete the broken world and restore the backup.

is a proposal, not permission.

---

# 21. Secrets Management

Secrets SHALL NOT be placed in:

- AI prompts
- client-side JavaScript
- logs
- analytics
- Git repositories

Sensitive configuration should be represented to AI using references or redacted values.

Example:

```text
GEYSER_KEY = [REDACTED]
DATABASE_PASSWORD = [REDACTED]
```

---

# 22. Communication Patterns

## Synchronous

Use for:

- authentication
- configuration retrieval
- capability queries
- lifecycle command acknowledgement
- validation requests

## Event-Driven

Use for:

- server started
- server stopped
- player joined
- player left
- provider health changes
- errors
- audit events

## Streaming

Use for:

- server logs
- AI generation
- live status where necessary

---

# 23. Deployment Topologies

## 23.1 Development

```text
Windows PC
|
+-- GameHub API
+-- Dashboard
+-- Minecraft
+-- Paper
+-- Geyser
```

## 23.2 Current LAN

```text
                 LAN
                  |
        +---------+----------+
        |                    |
 Windows GameHub Host     Admin Laptop
        |
        +-- Paper
        +-- Geyser
        +-- Minecraft
             |
       +-----+-----+
       v           v
   Android        iPad
```

## 23.3 Future Cloud

```text
                    Internet
                       |
                Load Balancer
                       |
                GameHub API
                       |
             +---------+---------+
             v         v         v
         GameHub    GameHub    GameHub
          Node       Node       Node
             |
        Provider Runtime
             |
      +------+------+------+
      v      v      v
   Minecraft Game B Game C
```

Cloud architecture must not become a prerequisite for local deployments.

---

# 24. Observability

Every major component should expose:

```text
Health
Metrics
Structured Logs
Events
Version
Capabilities
```

Minimum health model:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime": 12345,
  "dependencies": {
    "database": "healthy",
    "providerManager": "healthy"
  }
}
```

---

# 25. Audit Model

Administrative operations SHALL generate audit events.

Example:

```json
{
  "event": "SERVER_RESTARTED",
  "userId": "usr_123",
  "serverId": "srv_123",
  "timestamp": "...",
  "source": "dashboard",
  "result": "success"
}
```

AI-generated proposals should also be auditable.

---

# 26. Technical MVP Boundary

The technical MVP consists of:

```text
GameHub Core
    |
    +-- Authentication
    +-- Authorization
    +-- Provider Manager
    +-- Server Manager
    +-- Event System
    +-- Audit
    +-- REST API
    +-- WebSocket/Event Stream
    +-- Persistence
          |
          v
Minecraft Provider
    |
    +-- Paper
    +-- Geyser
    +-- Floodgate
    +-- Worlds
    +-- Content Validation
          |
          v
Dashboard
```

AI Studio initially operates primarily as a diagnostic and assistance layer.

---

# 27. AI Studio Consumption Guide

AI Studio should treat JBGH-003 as the technical contract for implementation generation.

Generation must follow:

```text
Requirement
   v
Component
   v
Interface
   v
Data Flow
   v
Security Boundary
   v
Test
```

### AI Studio must not

- place Minecraft logic inside generic services
- allow AI direct shell access
- expose secrets
- bypass provider capabilities
- assume cloud availability
- couple the dashboard directly to Paper/Geyser

### Generated code validation

Every generated component must answer:

1. Which requirement does this implement?
2. Which architectural component owns it?
3. Which interface does it implement?
4. What state does it modify?
5. What events does it emit?
6. What permissions are required?
7. What happens when it fails?
8. How can it be tested independently?

---

# 28. Cross-Document Dependencies

```text
JBGH-001 Vision
       |
       v
JBGH-002 PRD
       |
       v
JBGH-003 Technical Specification
       |
       +--------------+
       v              v
JBGH-004          JBGH-005
Architecture      API
       |              |
       +------+-------+
              v
          JBGH-006
          Database
              |
              v
          JBGH-007
        Design System
```

---

# 29. Completion Checklist

```yaml
document: JBGH-003
version: 0.1.0
status: DRAFT

completed:
  - component_inventory
  - ownership_boundaries
  - provider_contract
  - capability_model
  - lifecycle_model
  - state_management
  - server_provisioning_flow
  - status_flow
  - ai_context_flow
  - parental_policy_flow
  - minecraft_content_validation
  - error_model
  - recovery_patterns
  - security_model
  - sandboxing
  - authentication
  - authorization
  - ai_security
  - communication_patterns
  - deployment_topologies
  - observability
  - audit_model
  - ai_consumption_guide

pending:
  - formal_architecture_validation
  - formal_openapi_contract
  - formal_database_mapping
  - design_system_mapping
  - dependency_validation

next_document:
  id: JBGH-004
  title: Architecture Document
```

## Architecture Gate

JBGH-003 is now at DRAFT level.

The key technical decision is now explicit:

The Provider Manager is the translation boundary between GameHub and the game ecosystem.
