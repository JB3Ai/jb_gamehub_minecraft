# JBGH-005 - API Specification

Version: 0.1.0

Status: DRAFT

Product: JB3 GameHub

Document ID: JBGH-005

Depends on: JBGH-001 -> JBGH-004

Consumed by: JBGH-006, JBGH-007, frontend/backend implementation, AI Studio

---

## 1. API Objective

The GameHub API is the stable contract between the presentation layer, GameHub Core, AI Studio, and Provider Manager.

The API must ensure that:

- the frontend never needs direct access to game-server internals
- providers can be replaced or extended without changing the frontend
- AI Studio uses the same controlled API surface as other clients
- Minecraft-specific operations remain behind the Minecraft provider
- LAN deployment works without requiring cloud infrastructure

---

# 2. API Architecture

```text
                    +-------------------+
                    |  Web / Mobile UI  |
                    +---------+---------+
                              |
                    REST / WebSocket
                              |
                    +---------v---------+
                    |    GameHub API    |
                    +---------+---------+
                              |
          +-------------------+-------------------+
          v                   v                   v
   Authentication      Provider Manager       AI Studio
          |                   |                   |
          v                   v                   v
      Users/Roles        Game Providers      LLM Adapter
                              |
                    +---------+---------+
                    v                   v
                Minecraft          Future Provider
                Provider
                    |
              +-----+-----+
              v     v     v
            Paper Geyser Floodgate
```

---

# 3. API Versioning

Base path:

```text
/api/v1
```

Example:

```text
GET /api/v1/providers
```

Future breaking changes:

```text
/api/v2
```

Minor compatible changes remain within the same API version.

### Compatibility rule

A provider may evolve internally without breaking the GameHub API provided its public capability contract remains valid.

---

# 4. Authentication

MVP:

```text
Bearer Token
```

Example:

```text
Authorization: Bearer <token>
```

Future authentication providers may include:

- local accounts
- Microsoft authentication
- OAuth/OIDC
- family accounts
- institutional accounts

The authentication mechanism remains behind an abstraction.

---

# 5. Authorization

Roles:

| Role | Primary authority |
| --- | --- |
| player | Personal game access |
| parent | Child accounts, rules, reports |
| educator | Educational environments |
| admin | Server/platform administration |
| developer | Provider/API development |
| system | Internal automation |

Permissions should be capability-oriented.

Example:

```text
server.read
server.start
server.stop
server.restart
world.read
world.import
world.export
player.kick
player.ban
audit.read
provider.manage
```

---

# 6. Provider API

## List providers

```text
GET /api/v1/providers
```

Response:

```json
{
  "providers": [
    {
      "id": "minecraft",
      "name": "Minecraft",
      "version": "1.0.0",
      "status": "ready"
    }
  ]
}
```

---

## Provider details

```text
GET /api/v1/providers/{providerId}
```

Example:

```text
GET /api/v1/providers/minecraft
```

Response:

```json
{
  "id": "minecraft",
  "name": "Minecraft",
  "status": "ready",
  "capabilities": [
    "server.start",
    "server.stop",
    "server.restart",
    "world.import",
    "world.export",
    "world.backup",
    "player.list",
    "player.kick",
    "content.behavior_packs",
    "content.resource_packs"
  ]
}
```

---

# 7. Capability Discovery

```text
GET /api/v1/providers/{providerId}/capabilities
```

Response:

```json
{
  "provider": "minecraft",
  "capabilities": {
    "server.start": true,
    "server.stop": true,
    "server.restart": true,
    "world.import": true,
    "world.backup": true,
    "player.list": true,
    "content.behavior_packs": true,
    "content.resource_packs": true
  }
}
```

The frontend must use this endpoint to determine available controls.

---

# 8. Server API

## List servers

```text
GET /api/v1/servers
```

Optional:

```text
?provider=minecraft
?status=online
```

---

## Get server

```text
GET /api/v1/servers/{serverId}
```

Example:

```json
{
  "id": "srv_001",
  "provider": "minecraft",
  "name": "Family Server",
  "status": "online",
  "players": 3,
  "maxPlayers": 10
}
```

---

# 9. Server Lifecycle

### Start

```text
POST /api/v1/servers/{serverId}/start
```

### Stop

```text
POST /api/v1/servers/{serverId}/stop
```

### Restart

```text
POST /api/v1/servers/{serverId}/restart
```

Response:

```json
{
  "operationId": "op_123",
  "status": "accepted"
}
```

Operations should be asynchronous.

The client should not assume that:

```text
POST /start = server immediately online
```

Instead:

```text
START REQUEST
      v
STARTING
      v
RUNNING
```

---

# 10. Operation Status

```text
GET /api/v1/operations/{operationId}
```

Response:

```json
{
  "id": "op_123",
  "type": "server.start",
  "status": "completed",
  "serverId": "srv_001",
  "startedAt": "...",
  "completedAt": "..."
}
```

Possible states:

```text
queued
running
completed
failed
cancelled
```

---

# 11. Server Status

```text
GET /api/v1/servers/{serverId}/status
```

Response:

```json
{
  "status": "online",
  "uptime": 3821,
  "players": 3,
  "cpu": 17.4,
  "memory": {
    "used": 2048,
    "allocated": 4096
  }
}
```

---

# 12. Real-Time Status

WebSocket:

```text
/ws/v1/servers/{serverId}
```

Example event:

```json
{
  "event": "server.status.changed",
  "serverId": "srv_001",
  "status": "online"
}
```

Player event:

```json
{
  "event": "player.joined",
  "serverId": "srv_001",
  "player": {
    "id": "player_123",
    "name": "Skyler"
  }
}
```

---

# 13. World API

```text
GET /api/v1/servers/{serverId}/worlds
```

Create/import:

```text
POST /api/v1/servers/{serverId}/worlds
```

Example:

```json
{
  "name": "Celestial Castle",
  "source": "upload"
}
```

World export:

```text
POST /api/v1/servers/{serverId}/worlds/{worldId}/export
```

Backup:

```text
POST /api/v1/servers/{serverId}/worlds/{worldId}/backup
```

---

# 14. Minecraft Pack API

This is where the current Bedrock problem becomes an explicit API capability.

```text
GET /api/v1/servers/{serverId}/worlds/{worldId}/packs
```

Response:

```json
{
  "behaviorPacks": [],
  "resourcePacks": [],
  "validation": {
    "valid": false,
    "errors": [
      {
        "type": "missing_pack",
        "uuid": "f3f864e5-0cd1-40e3-aaa5-00d58a983253",
        "version": "1.1.3"
      }
    ]
  }
}
```

---

# 15. Pack Validation

```text
POST /api/v1/servers/{serverId}/worlds/{worldId}/packs/validate
```

The Minecraft provider validates:

```text
world_behavior_packs.json
world_resource_packs.json
       v
UUID
       v
Version
       v
manifest.json
       v
Installed pack
```

This allows GameHub to detect the exact class of failure encountered during the current server setup.

---

# 16. Player API

```text
GET /api/v1/servers/{serverId}/players
```

Player details:

```text
GET /api/v1/players/{playerId}
```

Kick:

```text
POST /api/v1/servers/{serverId}/players/{playerId}/kick
```

Ban:

```text
POST /api/v1/servers/{serverId}/players/{playerId}/ban
```

---

# 17. AI Studio API

AI Studio is an abstraction layer rather than a specific LLM.

```text
POST /api/v1/ai/context
```

Request:

```json
{
  "serverId": "srv_001",
  "include": [
    "server_status",
    "provider",
    "recent_events",
    "configuration",
    "errors"
  ]
}
```

Response:

```json
{
  "contextId": "ctx_001",
  "provider": "minecraft",
  "generatedAt": "...",
  "context": {}
}
```

---

# 18. AI Diagnosis

```text
POST /api/v1/ai/diagnose
```

Request:

```json
{
  "contextId": "ctx_001",
  "problem": "Minecraft server will not start"
}
```

Response:

```json
{
  "diagnosis": {
    "confidence": 0.94,
    "category": "world.invalid_content",
    "findings": [
      "Referenced resource pack is missing"
    ]
  },
  "recommendedActions": [
    {
      "type": "validate_packs",
      "requiresConfirmation": false
    }
  ]
}
```

---

# 19. AI Action Boundary

AI-generated operations must never directly execute arbitrary commands.

```text
AI
 v
Recommendation
 v
Structured Action
 v
Permission Validation
 v
Policy Validation
 v
Optional User Confirmation
 v
Provider API
```

Example:

```json
{
  "action": "server.restart",
  "serverId": "srv_001",
  "requiresConfirmation": true
}
```

---

# 20. LLM Provider Abstraction

GameHub should not depend directly on one AI provider.

```ts
interface LLMProvider {
  id(): string;
  capabilities(): string[];
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}
```

Possible implementations:

```text
OpenAI
Anthropic
Google
Local LLM
Future Provider
```

AI Studio therefore owns orchestration while the LLM adapter owns provider-specific API details.

---

# 21. Rate Limiting

Initial defaults:

| Endpoint category | Limit |
| --- | --- |
| Read API | 120/min |
| Mutating API | 30/min |
| Authentication | 10/min |
| AI generation | 20/min |
| File upload | 10/min |
| WebSocket | Connection controlled |

Limits should be configurable.

---

# 22. Error Model

All API errors use a common structure.

```json
{
  "error": {
    "code": "WORLD_INVALID_CONTENT",
    "message": "World contains unavailable content.",
    "details": {},
    "requestId": "req_123"
  }
}
```

Standard categories:

```text
AUTHENTICATION_REQUIRED
ACCESS_DENIED
NOT_FOUND
VALIDATION_FAILED
PROVIDER_UNAVAILABLE
SERVER_OPERATION_FAILED
WORLD_INVALID_CONTENT
PACK_MISSING
PACK_VERSION_MISMATCH
RATE_LIMITED
INTERNAL_ERROR
```

---

# 23. HTTP Status Strategy

```text
200  Successful request
201  Resource created
202  Async operation accepted
204  Successful request with no body

400  Validation error
401  Authentication failure
403  Authorization failure
404  Resource not found
409  State conflict
422  Provider/content validation failure
429  Rate limited

500  Internal error
502  Provider communication failure
503  Provider unavailable
```

---

# 24. Audit API

```text
GET /api/v1/audit
```

Filters:

```text
user
server
provider
event
date
```

Example:

```json
{
  "actor": "parent_001",
  "action": "server.restart",
  "serverId": "srv_001",
  "timestamp": "...",
  "result": "success"
}
```

This becomes important for parental controls and administrator accountability.

---

# 25. API Security Rules

The API must enforce:

```text
Authentication
    v
Authorization
    v
Resource ownership
    v
Capability check
    v
Provider operation
```

A user cannot simply discover:

```text
POST /servers/another-server/stop
```

and execute it.

---

# 26. OpenAPI Foundation

The canonical API definition will ultimately be stored as:

```text
/docs/api/openapi.yaml
```

Structure:

```yaml
openapi: 3.1.0

info:
  title: JB3 GameHub API
  version: 1.0.0

servers:
  - url: /api/v1

paths:
  /providers:
  /providers/{providerId}:
  /servers:
  /servers/{serverId}:
  /servers/{serverId}/start:
  /servers/{serverId}/stop:
  /servers/{serverId}/restart:
  /servers/{serverId}/worlds:
  /players:
  /ai/context:
  /ai/diagnose:
  /audit:
```

The complete implementation schema becomes the authoritative API contract when development begins.

---

# 27. AI Studio Consumption Guide

AI Studio should treat JBGH-005 as the contract layer.

When generating a feature it should determine:

```text
1. Which endpoint?
2. Which HTTP method?
3. Which request schema?
4. Which response schema?
5. Which permission?
6. Which provider capability?
7. Is operation synchronous or asynchronous?
8. Which events are emitted?
9. Which errors are possible?
10. Which audit record is required?
```

### Example prompt to AI Studio

```text
Implement world import.

Use JBGH-005.

Do not invent a new API endpoint if an existing contract
supports the operation.

The implementation must:
- validate authentication
- validate authorization
- resolve the provider
- verify world capability
- validate world content
- create an asynchronous operation
- emit world.imported or world.import.failed
- create an audit record
- return the operation ID
```

This is precisely the point of the architecture-first approach: AI generates against contracts rather than inventing the application architecture while coding.

---

# 28. Completion Checklist

```yaml
document: JBGH-005
version: 0.1.0
status: DRAFT

api:
  versioning: complete
  authentication: complete
  authorization: complete
  provider_api: complete
  capability_api: complete
  server_api: complete
  world_api: complete
  player_api: complete
  ai_api: complete
  audit_api: complete
  websocket_model: complete
  error_model: complete
  rate_limiting: complete

minecraft:
  paper_operations: defined
  geyser_operations: provider-bound
  floodgate_operations: provider-bound
  world_packs: defined
  manifest_validation: defined

ai:
  context_api: defined
  diagnosis_api: defined
  llm_abstraction: defined
  action_boundary: defined

pending:
  full_openapi_yaml: implementation artifact
  database_mapping: JBGH-006
  ui_mapping: JBGH-007
```

---

## Architecture Gate

JBGH-005 - API Specification: DRAFT complete.

The dependency chain is now:

```text
JBGH-001 Vision
      v
JBGH-002 PRD
      v
JBGH-003 Master Technical Specification
      v
JBGH-004 Architecture
      v
JBGH-005 API Specification
      v
JBGH-006 Database Schema
      v
JBGH-007 Design System
```
