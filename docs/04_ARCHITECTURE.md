# JBGH-004 - Architecture Document

Version: 0.1.0

Status: DRAFT

Document ID: JBGH-004

Product: JB3 GameHub

Depends on: JBGH-001, JBGH-002, JBGH-003

Consumed by: JBGH-005, JBGH-006, JBGH-007

---

## 1. Architecture Objective

JB3 GameHub is architected as a provider-agnostic orchestration platform.

Minecraft is the first implementation, not the architectural center.

```text
                         JB3 GAMEHUB
                              |
                 +------------+------------+
                 |                         |
          GameHub Core                AI Studio
                 |                         |
        +--------+--------+                |
        |        |        |                |
     Users    Servers   Events             |
        |        |        |                |
        +--------+--------+                |
                 |                         |
          Provider Manager <---------------+
                 |
       +---------+---------+
       |         |         |
 Minecraft    Provider B  Provider C
       |
 +-----+------+ 
 |     |      |
Paper Geyser Floodgate
```

The architecture therefore separates:

Platform -> Provider -> Runtime -> Game Content

---

# 2. Architecture Principles

| Principle | Requirement |
| --- | --- |
| Provider Agnostic | Core cannot depend on one game |
| API First | Every major capability has an API contract |
| Capability Driven | UI and automation discover provider capabilities |
| AI Consumable | Architecture is machine-readable and traceable |
| Progressive Disclosure | Complexity is hidden until required |
| Local First | LAN deployment works without cloud dependency |
| Secure by Boundary | Providers and user content are treated as separate trust zones |
| Event Aware | Important state changes generate events |
| Extensible | New providers should not require Core rewrites |
| Open Source | Architecture should remain inspectable and replaceable |

---

# 3. Logical Architecture

```text
+-------------------------------------------------------------------+
|                         PRESENTATION                              |
|                                                                   |
|  Admin Dashboard | Parent Dashboard | Player UI | Mobile/Tablet  |
+------------------------------+------------------------------------+
                               |
                         REST / WebSocket
                               |
+------------------------------v------------------------------------+
|                            API LAYER                              |
|                                                                   |
| Authentication | Authorization | Validation | Rate Limiting       |
+------------------------------+------------------------------------+
                               |
          +--------------------+--------------------+
          |                    |                    |
          v                    v                    v
+-----------------+  +------------------+  +---------------------+
| Server Manager  |  | Provider Manager |  | AI Studio           |
|                 |  |                  |  |                     |
| Lifecycle       |  | Registry         |  | Context Builder     |
| Operations      |  | Capabilities     |  | Diagnostics         |
| Status          |  | Adapters         |  | Generation          |
+--------+--------+  +--------+---------+  +----------+----------+
         |                    |                       |
         +--------------------+-----------------------+
                              |
                     +--------v--------+
                     |   Event Layer   |
                     +--------+--------+
                              |
                     +--------v--------+
                     | Persistence     |
                     +-----------------+
                              |
                     +--------v--------+
                     | Provider Runtime|
                     +--------+--------+
                              |
                   +----------+----------+
                   v                     v
             Minecraft               Future
              Provider              Providers
                   |
           +-------+--------+
           v       v        v
         Paper   Geyser   Floodgate
```

---

# 4. Provider Manager

The Provider Manager is the architectural centerpiece.

Its job is to answer:

What game systems exist, what can they do, and how do I communicate with them?

It does not answer:

How does Minecraft internally work?

That belongs to the Minecraft provider.

---

## 4.1 Provider Registry

Every provider registers metadata.

```json
{
  "id": "minecraft",
  "name": "Minecraft",
  "version": "1.0.0",
  "runtime": {
    "supported": [
      "paper",
      "bedrock",
      "geyser"
    ]
  }
}
```

---

## 4.2 Provider Lifecycle

```text
DISCOVER
   v
LOAD
   v
VALIDATE
   v
REGISTER
   v
HEALTH CHECK
   v
AVAILABLE
```

Failure:

```text
VALIDATE
   v
FAILED
   v
DISABLED
```

---

# 5. Provider Capability Model

Capabilities must be discoverable.

Example:

```json
{
  "server.start": true,
  "server.stop": true,
  "server.restart": true,
  "world.import": true,
  "world.export": true,
  "world.backup": true,
  "player.list": true,
  "player.kick": true,
  "content.resource_packs": true,
  "content.behavior_packs": true
}
```

This allows the dashboard to dynamically render appropriate functionality.

For example:

```text
Provider A
 +-- Start
 +-- Stop
 +-- Restart

Provider B
 +-- Start
 +-- Stop
 +-- Restart
 +-- World Import
```

The UI does not need hardcoded knowledge of every provider.

---

# 6. Provider Registration Contract

Conceptually:

```ts
interface ProviderPlugin {
  metadata(): ProviderMetadata;
  capabilities(): CapabilityRegistry;
  initialize(context: ProviderContext): Promise<void>;
  health(): Promise<ProviderHealth>;
  shutdown(): Promise<void>;
}
```

The provider receives a controlled ProviderContext.

It should not receive unrestricted access to GameHub internals.

---

# 7. Operation Translation

GameHub defines canonical operations.

```text
START_SERVER
STOP_SERVER
RESTART_SERVER
GET_STATUS
IMPORT_WORLD
BACKUP_WORLD
RESTORE_WORLD
```

The provider translates them.

```text
GameHub
   |
   | START_SERVER
   v
Provider Manager
   |
   v
Minecraft Provider
   |
   v
Paper / Bedrock Runtime
```

Another provider might translate:

```text
START_SERVER
   v
Different Provider Runtime
```

Core remains unchanged.

---

# 8. Minecraft Provider

The first provider is:

```text
Provider ID: minecraft
```

Architecture:

```text
Minecraft Provider
       |
       +-- Java Runtime
       |      +-- Paper
       |
       +-- Bedrock Bridge
       |      +-- Geyser
       |
       +-- Authentication Bridge
       |      +-- Floodgate
       |
       +-- World Manager
       |
       +-- Pack Manager
       |
       +-- Player Manager
       |
       +-- Diagnostics
```

---

# 9. Minecraft Content Architecture

The Bedrock add-on issue becomes an explicit provider capability.

```text
                  Minecraft World
                         |
             +-----------+-----------+
             |                       |
 world_behavior_packs.json   world_resource_packs.json
             |                       |
             +-----------+-----------+
                         v
                    Pack UUID
                    Pack Version
                         |
                         v
                    Pack Manager
                         |
                         v
                     manifest.json
                         |
                  +------+------+
                  v             v
              UUID Match    Version Match
                  |             |
                  +------+------+
                         v
                     VALIDATED
```

The architecture therefore codifies the lesson from the current server:

A world can contain references to content that is not actually installed in the provider runtime.

GameHub should detect that before server startup, wherever technically possible.

---

# 10. Service Boundaries

## Core Services

```text
Identity Service
Authorization Service
Provider Manager
Server Manager
World Manager
Configuration Service
Event Service
Audit Service
AI Context Service
Persistence Service
```

These are logical boundaries first, not necessarily separate processes.

This distinction is important.

### MVP

They may live inside one backend application.

### Future

They can be separated if scale requires it.

---

# 11. Monolith-First Strategy

The MVP should use a modular monolith rather than prematurely creating microservices.

```text
GameHub Backend
|
+-- auth/
+-- users/
+-- providers/
+-- servers/
+-- worlds/
+-- events/
+-- audit/
+-- ai/
+-- database/
```

This reduces:

- deployment complexity
- debugging difficulty
- network overhead
- operational requirements

The internal module boundaries remain strict so future extraction remains possible.

---

# 12. Communication Model

### Browser -> Backend

```text
HTTPS / REST
WebSocket
```

### Backend -> Provider

Initially:

```text
In-process interface
```

Where provider isolation requires it:

```text
IPC / local process / HTTP
```

### Provider -> Backend

```text
Events
Status
Logs
Health
```

---

# 13. Event Architecture

Canonical events:

```text
PROVIDER_REGISTERED
PROVIDER_READY
PROVIDER_FAILED
SERVER_CREATED
SERVER_STARTING
SERVER_STARTED
SERVER_STOPPING
SERVER_STOPPED
SERVER_ERROR
WORLD_IMPORTED
WORLD_VALIDATION_FAILED
PLAYER_JOINED
PLAYER_LEFT
BACKUP_CREATED
RESTORE_COMPLETED
```

Events should include:

```json
{
  "id": "evt_123",
  "type": "SERVER_STARTED",
  "timestamp": "2026-08-07T20:00:00Z",
  "provider": "minecraft",
  "server": "srv_123"
}
```

---

# 14. Frontend Architecture

The frontend must consume capabilities, not provider-specific assumptions.

Bad:

```python
if minecraft:
    show Minecraft button
```

Preferred:

```python
if capability("world.import"):
    show Import World
```

This is one of the most important architectural rules in GameHub.

---

# 15. Progressive Disclosure

A parent should see:

```text
Minecraft Server

* Online

Players: 3

[ JOIN ]
```

An administrator can see:

```text
Runtime
Provider
Ports
Geyser
Logs
Backups
Configuration
```

A developer can access:

```text
Provider diagnostics
API
Events
Capabilities
Raw configuration
```

Same system.

Different complexity levels.

---

# 16. AI Studio Architecture

AI Studio sits above the platform rather than inside individual providers.

```text
                 AI Studio
                     |
                     v
              Context Builder
                     |
        +------------+------------+
        v            v            v
      Core        Provider       Runtime
      State       Knowledge      State
        |            |            |
        +------------+------------+
                     v
                LLM Adapter
                     |
              +------+------+------+
              v      v      v
             LLM    LLM    LLM
```

AI can therefore reason about Minecraft without GameHub itself becoming an AI-dependent architecture.

---

# 17. AI Action Boundary

AI suggestions:

Install the missing pack.

become:

```text
PROPOSED_ACTION
      v
Policy Check
      v
Permission Check
      v
User Confirmation
      v
Provider Operation
```

Future trusted automation can selectively bypass confirmation for predefined safe operations.

---

# 18. Security Architecture

```text
Internet / LAN Client
        |
        v
Authentication
        |
        v
Authorization
        |
        v
GameHub API
        |
        v
Provider Manager
        |
        v
Provider Sandbox
        |
        v
Game Runtime
```

No client should directly control the underlying server process.

---

# 19. Current LAN Deployment

The architecture explicitly supports the current environment:

```text
                         HOME LAN
                            |
               +------------+------------+
               |                         |
       Windows Server Host          Admin Laptop
               |                         |
        +------+------+                  |
        |      |      |                  |
      GameHub Paper  Geyser              |
        |             |                  |
        +-------------+                  |
               |                         |
          Minecraft                      |
               |                         |
       +-------+--------+                |
       v                v                |
 Android Tablet       iPad               |
       |                |                |
       +--------- LAN --+----------------+
```

The dashboard can be hosted on the Windows machine and accessed from the admin laptop, Android tablet, or iPad browser.

---

# 20. Development Deployment

Current development can remain simple:

```text
Windows
|
+-- VS Code
+-- Java 21
+-- Node/npm
+-- Geyser Standalone
+-- jb_gamehub_minecraft
    +-- localhost:3000
```

The existing working projects therefore become implementation inputs rather than architectural constraints.

---

# 21. Production Deployment Options

### Option A - Home Server

Best for:

- families
- small communities
- LAN gaming

### Option B - Dedicated Server

Best for:

- larger communities
- remote friends
- always-on environments

### Option C - Cloud

Best for:

- multi-tenant hosting
- managed GameHub
- commercial deployment

The same API and provider architecture should operate in all three.

---

# 22. Multi-Map Architecture

GameHub must distinguish:

```text
Provider
   |
   +-- Server
          |
          +-- World A
          +-- World B
          +-- World C
          +-- World D
```

The UI should therefore manage worlds as resources rather than assuming:

one server = one map.

For Minecraft, provider capabilities determine whether worlds can be:

- switched
- loaded
- copied
- backed up
- independently configured

---

# 23. Multi-Server Architecture

```text
GameHub
|
+-- Minecraft Server 01
+-- Minecraft Server 02
+-- Minecraft Server 03
+-- Minecraft Server 04
+-- Future Provider Server
```

The Provider Manager maintains the abstraction.

---

# 24. Architecture Decision Records

## ADR-0001 - Provider Manager

Decision: Use a Provider Manager abstraction.

Reason: Prevent GameHub from becoming a Minecraft-specific application.

## ADR-0006 - Modular Monolith MVP

Decision: Start with a modular monolith.

Reason: The product needs architectural boundaries without premature distributed-system complexity.

## ADR-0007 - Capability Discovery

Decision: Providers advertise capabilities.

Reason: Enables generic UI and automation.

## ADR-0004 - Local-First

Decision: LAN operation must work independently of cloud services.

Reason: Family environments may have unreliable Internet access.

## ADR-0003 - AI as Controlled Assistant

Decision: AI cannot directly bypass authorization.

Reason: AI is an assistant, not an unrestricted administrator.

## ADR-0002 - Minecraft Provider Isolation

Decision: Paper/Geyser/Floodgate/world-pack logic remains inside the Minecraft provider.

Reason: Prevent Minecraft-specific implementation from contaminating GameHub Core.

---

# 25. AI Studio Consumption Guide

AI Studio should use this architecture as a constraint system.

When generating code it should first identify:

```text
Which layer?
Which module?
Which interface?
Which provider?
Which permission?
Which state?
Which event?
Which failure mode?
```

AI Studio should reject generated implementations that violate architectural boundaries.

### Example

Requirement:

```text
Add Minecraft world import.
```

AI Studio should generate:

```text
API endpoint
     v
Server Manager
     v
Provider Manager
     v
Minecraft Provider
     v
World Manager
     v
Validation
     v
Persistence
     v
Event
```

It should not add:

```text
MinecraftWorldImporter
```

to the generic dashboard layer.

---

# 26. Architecture Validation Checklist

```yaml
document: JBGH-004
version: 0.1.0
status: DRAFT

architecture:
  provider_manager: complete
  core_services: complete
  provider_boundary: complete
  communication_model: complete
  event_model: complete
  frontend_boundary: complete
  ai_boundary: complete

minecraft:
  paper: defined
  geyser: defined
  floodgate: defined
  world_management: defined
  behavior_packs: defined
  resource_packs: defined
  manifest_resolution: defined

deployment:
  development: defined
  lan: defined
  dedicated_server: defined
  cloud: defined

principles:
  provider_agnostic: validated
  api_first: validated
  local_first: validated
  ai_safe: validated
  progressive_disclosure: validated

pending:
  openapi_contract
  database_mapping
  component_design_tokens
  implementation_validation
```

---

# Architecture Gate

JBGH-004 - Architecture Document: DRAFT complete.

We now have the chain:

```text
JBGH-001  Vision
     v
JBGH-002  Requirements
     v
JBGH-003  Technical Specification
     v
JBGH-004  Architecture
     v
JBGH-005  API Specification
     v
JBGH-006  Database Schema
     v
JBGH-007  Design System
```

Next: JBGH-005 - API Specification.
