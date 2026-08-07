# JBGH-002 - Product Requirements Document

Version: 0.1.0

Status: DRAFT

Document ID: JBGH-002

Owner: JB3Ai / JB3 GameHub

Depends on: JBGH-001 Vision Document

Consumed by: JBGH-003, JBGH-004, JBGH-005, JBGH-006, JBGH-007

---

## 1. Document Control

| Field | Value |
| --- | --- |
| Product | JB3 GameHub |
| Document | Product Requirements Document |
| ID | JBGH-002 |
| Version | 0.1.0 |
| Status | DRAFT |
| Architecture | Provider Manager |
| Initial Provider | Minecraft |
| Initial Runtime | Paper / Bedrock / Geyser |
| Current Deployment | Windows LAN |
| Clients | Windows / Android / iPad |
| IsikoloAi | Future integration, not MVP dependency |

### Dependencies

```text
JBGH-001 Vision
      |
      v
JBGH-002 PRD
      |
      +--> JBGH-003 Master Technical Specification
      +--> JBGH-004 Architecture
      +--> JBGH-005 API Specification
      +--> JBGH-006 Database Schema
      +--> JBGH-007 Design System
```

---

# 2. Table of Contents

| Section | Status |
| --- | --- |
| 1. Document Control | COMPLETE |
| 2. Table of Contents | COMPLETE |
| 3. Product Definition | DRAFT |
| 4. Functional Requirements | DRAFT |
| 5. Non-Functional Requirements | DRAFT |
| 6. Personas | DRAFT |
| 7. User Stories | DRAFT |
| 8. MVP Scope | DRAFT |
| 9. Explicitly OUT of MVP | DRAFT |
| 10. Phase 2 | DRAFT |
| 11. Phase 3 | DRAFT |
| 12. Integration Requirements | DRAFT |
| 13. Security Requirements | DRAFT |
| 14. LAN Requirements | DRAFT |
| 15. Acceptance Criteria | DRAFT |
| 16. AI Studio Consumption Guide | DRAFT |
| 17. Completion Checklist | DRAFT |

---

# 3. Product Definition

## 3.1 Product Statement

JB3 GameHub is an open-source game-server management platform that provides a unified management layer over multiple game-server providers.

Minecraft is the first provider.

The platform separates:

```text
GameHub Core
      |
      v
Provider Manager
      |
      v
Game Provider
      |
      +-- Runtime
      +-- Worlds
      +-- Players
      +-- Extensions
      +-- Networking
      +-- Diagnostics
```

This separation is a fundamental product requirement.

---

# 4. Functional Requirements

## 4.1 Provider Manager

### FR-PM-001

The system SHALL maintain a registry of installed providers.

Each provider SHALL expose:

- unique provider ID
- name
- version
- supported runtime versions
- capabilities
- operating-system requirements
- lifecycle operations
- health checks

### FR-PM-002

The system SHALL allow discovery of provider capabilities.

Example:

```json
{
  "provider": "minecraft",
  "capabilities": [
    "server.start",
    "server.stop",
    "server.restart",
    "world.import",
    "world.export",
    "packs.install",
    "players.list"
  ]
}
```

### FR-PM-003

The GameHub core SHALL communicate with providers through defined interfaces rather than provider-specific implementation details.

### FR-PM-004

A provider SHALL be able to reject an operation it does not support.

---

## 4.2 Server Orchestration

The system SHALL support:

- create server
- start server
- stop server
- restart server
- inspect server status
- inspect server health
- view logs
- configure server
- import worlds
- export worlds
- backup worlds
- restore worlds
- manage supported extensions

### FR-SO-001

Server lifecycle state SHALL be represented consistently across providers.

Canonical states:

```text
CREATED
STARTING
RUNNING
STOPPING
STOPPED
RESTARTING
ERROR
UNKNOWN
```

A provider may have additional internal states, but GameHub must translate them into the canonical model.

---

## 4.3 Minecraft Provider

The Minecraft provider SHALL initially support the project's current environment.

### Java

```text
Paper
```

### Cross-platform connectivity

```text
Geyser
Floodgate
```

### Bedrock

Bedrock clients SHALL be treated as first-class clients of the Minecraft provider.

---

## 4.4 World Management

The Minecraft provider SHALL support world import and validation.

The provider must understand the distinction between:

```text
World
Pack
Manifest
World Pack Configuration
```

For Bedrock content, the provider SHALL understand the relationship between:

```text
manifest.json
world_behavior_packs.json
world_resource_packs.json
```

### FR-MC-WORLD-001

When a world references a pack:

```text
Pack UUID
Pack Version
```

the provider SHALL verify that the corresponding installed pack contains a matching manifest.

### FR-MC-WORLD-002

Missing packs SHALL produce a structured validation error.

Example:

```json
{
  "code": "PACK_NOT_FOUND",
  "pack_id": "...",
  "required_version": "1.1.3",
  "source": "world_behavior_packs.json"
}
```

### FR-MC-WORLD-003

The system SHALL provide actionable remediation information rather than simply reporting:

Invalid content.

This requirement is directly informed by the current Minecraft server deployment problem.

---

## 4.5 AI Studio

AI Studio SHALL provide an abstraction over LLM providers.

The GameHub architecture must not directly depend on a single model vendor.

Conceptually:

```text
                 AI Studio
                     |
             LLM Provider Adapter
          +----------+----------+
          |          |          |
        Model A    Model B    Model C
```

### Required capabilities

- context injection
- specification retrieval
- diagnostic analysis
- structured generation
- generation feedback
- validation
- optional action proposals

AI must be able to consume:

```text
server state
provider capabilities
logs
configuration
documentation
errors
user permissions
```

---

## 4.6 Parental Controls

Parental controls are part of the product architecture but have limited MVP scope.

MVP:

- parent/admin account
- player identification
- basic access control
- server access visibility
- basic play-session information

Not MVP:

- sophisticated behavioral profiling
- automated child reward economies
- AI behavioral scoring
- commercial voucher systems

These remain future capabilities.

---

## 4.7 Educational Tools

Educational functionality SHALL be architecturally supported but SHALL NOT be required for the GameHub MVP.

The architecture should permit:

```text
GameHub
   |
   +-- Educational Provider / Integration
             |
             +-- IsikoloAi
```

This preserves the decision to complete IsikoloAi independently before integration.

---

## 4.8 Dashboard and Analytics

The dashboard SHALL provide:

### Server

- status
- uptime
- player count
- health
- CPU/memory where available
- recent events

### Provider

- provider status
- version
- capabilities
- health

### Operations

- recent starts/stops
- errors
- warnings
- administrative actions

---

# 5. Non-Functional Requirements

## 5.1 Management Latency

For local LAN operations:

| Operation | Target |
| --- | --- |
| Dashboard initial load | <= 2 sec |
| Server status request | <= 500 ms |
| Provider capability query | <= 500 ms |
| Configuration retrieval | <= 1 sec |
| Command acknowledgement | <= 1 sec |
| Event propagation | <= 500 ms target |

These are management-plane targets, not gameplay latency requirements.

---

## 5.2 Concurrent Servers

### MVP target

A single GameHub instance SHALL support at least 5 managed server instances subject to available host resources.

### Architecture target

The design SHALL not impose an artificial five-server limit.

The system should be capable of scaling beyond the MVP target.

---

## 5.3 Offline Capability

The dashboard SHALL remain usable for local management when Internet connectivity is unavailable.

The LAN environment must support:

```text
Internet unavailable
        v
GameHub still works
        v
LAN clients can manage local servers
```

External AI services may naturally become unavailable.

The core management platform must not collapse because an LLM provider is unreachable.

---

## 5.4 Recovery

The system SHALL detect:

- failed server startup
- unexpected shutdown
- provider failure
- network failure
- invalid configuration
- missing content
- incompatible provider version

Operations must produce machine-readable errors.

---

# 6. Personas

## Persona A - Child Player

Needs:

- simple login
- easy server access
- minimal configuration
- safe multiplayer
- clear game status

The child should not need to understand:

```text
ports
IP addresses
Geyser
Paper
DNS
firewalls
server.properties
```

---

## Persona B - Parent Administrator

Needs:

- simple setup
- visibility
- control
- safety
- understandable reports
- minimal technical knowledge

Primary experience:

Tell me what is happening and what I need to do.

---

## Persona C - Educator

Needs:

- controlled environments
- player management
- activity visibility
- future curriculum integration
- repeatable deployments

---

## Persona D - Developer

Needs:

- APIs
- provider interfaces
- documentation
- local development environment
- test harnesses
- extension points

The developer should be able to create a provider without modifying GameHub Core unnecessarily.

---

# 7. User Stories

### Child

As a child, I want to click one server and join it without understanding networking.

### Parent

As a parent, I want to see which servers my children can access without configuring Minecraft networking manually.

### Parent

As a parent, I want GameHub to explain a server problem in ordinary language.

### Educator

As an educator, I want to deploy a controlled multiplayer environment without becoming a server administrator.

### Developer

As a developer, I want to register a new provider using a documented interface.

### Developer

As a developer, I want GameHub to expose provider capabilities through an API.

---

# 8. MVP Scope

The MVP is deliberately narrow.

## INCLUDED

### Core

- Provider Manager
- provider registry
- provider capability discovery
- server lifecycle
- server status
- logs
- configuration
- authentication
- authorization
- audit events

### Minecraft

- Minecraft provider
- Paper integration
- Geyser integration
- Bedrock connectivity
- world management
- basic pack validation
- world import/export
- backup/restore

### Dashboard

- server list
- server detail
- status
- lifecycle controls
- logs
- basic provider information

### AI

- AI context assembly
- read-only diagnostics
- provider-aware explanations

---

# 9. Explicitly OUT of MVP

The following are deliberately excluded:

```text
IsikoloAi integration
Robux marketplace
Voucher purchasing
Subscription economy
Reward economy
Advanced parental behavioral analytics
Multi-tenant SaaS
Public hosting marketplace
Large-scale cloud orchestration
Complex social network
AI autonomous server administration
```

This is important.

The MVP should prove:

GameHub can make managing a Minecraft server dramatically easier.

---

# 10. Phase 2

Potential Phase 2 functionality:

- advanced parental controls
- richer analytics
- automated backups
- plugin/pack marketplace
- multiple worlds
- one-click world deployment
- richer AI diagnostics
- scheduled server operations
- remote administration
- additional providers

---

# 11. Phase 3

Potential Phase 3 functionality:

- multi-tenant cloud
- hosted GameHub infrastructure
- provider marketplace
- educational integrations
- IsikoloAi
- reward systems
- commercial voucher integrations
- advanced AI automation
- community/server discovery

These remain architectural possibilities rather than current implementation commitments.

---

# 12. Integration Requirements

## 12.1 Paper

The Minecraft provider SHALL isolate Paper-specific functionality behind the Minecraft provider boundary.

GameHub Core must not directly depend on Paper APIs.

---

## 12.2 Geyser

Geyser SHALL be treated as a Minecraft interoperability component.

The provider should expose its presence and capabilities through the provider status model.

Example:

```text
Minecraft Provider
       |
       +-- Paper
       +-- Geyser
       +-- Floodgate
```

---

## 12.3 LLM Providers

GameHub SHALL use an adapter abstraction.

```text
ILLMProvider
|
+-- generate()
+-- stream()
+-- embed()
+-- health()
+-- capabilities()
```

Actual implementations remain outside the core interface.

---

# 13. Security Requirements

### Authentication

Every administrative API SHALL require authentication.

### Authorization

Operations SHALL be permission-aware.

Example:

```text
PLAYER
PARENT
EDUCATOR
ADMIN
DEVELOPER
SYSTEM
```

### AI Security

AI-generated actions SHALL NOT automatically receive administrator privileges.

### Content Security

User-provided:

- worlds
- packs
- plugins
- scripts
- configuration

must be treated as untrusted input.

---

# 14. LAN Requirements

The initial deployment must support:

```text
Windows host
     |
     +-- GameHub
     +-- Paper
     +-- Geyser
          |
          +-- Android
          +-- iPad
```

The dashboard should be reachable through the local network.

The architecture must not assume:

```text
localhost == only valid deployment
```

LAN host discovery and explicit host addressing should be supported by the architecture.

---

# 15. Acceptance Criteria

The MVP will be considered functionally successful when a non-technical parent can:

1. Open GameHub.
2. See the Minecraft server.
3. Determine whether it is running.
4. Start/stop/restart it.
5. See connected players.
6. View basic server health.
7. Import a supported world.
8. Receive meaningful errors when content is invalid.
9. Connect Android and iPad Bedrock clients through Geyser.
10. Perform these tasks without manually editing multiple Minecraft configuration files.

### Developer acceptance test

A developer must also be able to:

1. Register a provider.
2. Advertise capabilities.
3. Start/stop a server through the provider interface.
4. Report provider health.
5. Receive events through the standard event model.

---

# 16. AI Studio Consumption Guide

This document converts the vision into testable product constraints.

AI Studio should use:

```text
JBGH-001
    v
JBGH-002
    v
Generate Technical Specification
```

AI Studio must derive:

- functional requirements
- non-functional requirements
- user permissions
- MVP boundaries
- provider interfaces
- acceptance tests

### AI generation rule

AI Studio SHALL NOT generate implementation merely because a feature appears in the long-term vision.

It must first determine:

```text
Is it MVP?
Is the dependency implemented?
Does the architecture support it?
Does the API specify it?
Does the security model permit it?
```

### Validation

Generated code must be traceable to requirement IDs.

Example:

```text
FR-PM-003
      v
Provider interface
      v
Architecture component
      v
API endpoint
      v
Automated test
```

This gives requirements traceability, which will become critical once AI Studio starts generating substantial portions of the codebase.

---

# 17. Completion Checklist

```yaml
document: JBGH-002
version: 0.1.0
status: DRAFT

requirements:
  provider_manager: defined
  orchestration: defined
  ai_studio: defined
  parental_controls: defined
  educational_tools: defined
  dashboard: defined

non_functional:
  latency: defined
  concurrency: defined
  offline_operation: defined
  recovery: defined

personas:
  child: defined
  parent: defined
  educator: defined
  developer: defined

scope:
  mvp: defined
  phase_2: defined
  phase_3: defined

integrations:
  paper: defined
  geyser: defined
  llm_abstraction: defined

security:
  authentication: defined
  authorization: defined
  ai_permissions: defined
  untrusted_content: defined

lan:
  windows: defined
  android: defined
  ipad: defined

pending:
  cross_reference_validation
  technical_interface_definition
  api_schema_validation
  database_mapping
  design_system_mapping

next:
  JBGH-003
  Master Technical Specification
```

### Architecture gate

JBGH-002 is now at DRAFT level.

The important boundary is now established:

GameHub Core manages the platform. Providers understand games. AI assists the platform. IsikoloAi comes later.
