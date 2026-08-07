# JBGH-006 - Database Schema Design

Version: 0.1.0

Status: DRAFT

Product: JB3 GameHub

Document ID: JBGH-006

Depends on: JBGH-001 -> JBGH-005

Consumed by: JBGH-007, backend implementation, AI Studio

---

## 1. Database Objective

The GameHub database is the persistent state layer for the platform.

It must represent:

- users and roles
- providers
- servers
- worlds
- provider capabilities
- players
- parental controls
- educational integrations
- AI context
- operations
- events
- audit history
- configuration and deployment state

The database must not contain Minecraft-specific assumptions in the core schema where a provider-neutral model is possible.

---

# 2. Core Entity Model

```text
                         USERS
                           |
                +----------+----------+
                |          |          |
               Roles    Children   Sessions
                |          |
                |      Parental Rules
                |
                v
             SERVERS
                |
        +-------+--------+
        |       |        |
     Provider  Worlds   Players
        |       |
        |       +-- Packs
        |       +-- Backups
        |
        v
    PROVIDERS
        |
    Capabilities

AI Context ---- Servers
AI Context ---- Users

Events -------- Everything

Audit Logs ---- Everything
```

---

# 3. Provider Entity

```text
providers
```

| Field | Type | Purpose |
| --- | --- | --- |
| id | UUID | Internal identifier |
| provider_key | VARCHAR | Stable provider identifier |
| name | VARCHAR | Display name |
| version | VARCHAR | Provider version |
| status | ENUM | lifecycle state |
| configuration | JSONB | Provider configuration |
| capabilities | JSONB | Advertised capabilities |
| created_at | TIMESTAMP | Creation |
| updated_at | TIMESTAMP | Last update |

Example:

```json
{
  "provider_key": "minecraft",
  "name": "Minecraft",
  "version": "1.0.0",
  "status": "ready"
}
```

---

# 4. Server Entity

```text
servers
```

| Field | Type |
| --- | --- |
| id | UUID |
| provider_id | UUID FK |
| name | VARCHAR |
| status | ENUM |
| host | VARCHAR |
| port | INTEGER |
| configuration | JSONB |
| metadata | JSONB |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

Relationship:

```text
providers 1 ------- N servers
```

A server therefore belongs to a provider without the database needing to know whether it is Minecraft, another game, or a future provider.

---

# 5. Worlds

```text
worlds
```

| Field | Type |
| --- | --- |
| id | UUID |
| server_id | UUID FK |
| name | VARCHAR |
| status | ENUM |
| path | VARCHAR |
| metadata | JSONB |
| current | BOOLEAN |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

Relationship:

```text
server 1 ------- N worlds
```

This deliberately supports:

one server -> multiple worlds

rather than assuming one world per server.

---

# 6. Content Packs

Provider-specific content belongs behind a generic content model.

```text
content_packs
```

| Field | Type |
| --- | --- |
| id | UUID |
| provider_id | UUID FK |
| world_id | UUID FK |
| type | VARCHAR |
| name | VARCHAR |
| pack_uuid | VARCHAR |
| version | VARCHAR |
| manifest | JSONB |
| path | VARCHAR |
| status | ENUM |
| validation_result | JSONB |
| created_at | TIMESTAMP |

For Minecraft:

```text
type =
  behavior_pack
  resource_pack
```

---

# 7. Minecraft Pack Validation

The database must preserve enough information to diagnose the current class of problem.

```text
content_packs
      |
      +-- pack_uuid
      +-- version
      +-- manifest
              |
              v
      World Pack Reference
              |
              v
      Validation Result
```

Example:

```json
{
  "pack_uuid": "f3f864e5-0cd1-40e3-aaa5-00d58a983253",
  "version": "1.1.3",
  "validation_result": {
    "manifest_found": true,
    "uuid_match": true,
    "version_match": true,
    "installed": false
  }
}
```

This allows GameHub to explain:

The world requires pack X version Y, but the provider does not currently have it installed.

rather than simply reporting:

Server failed.

---

# 8. Users

```text
users
```

| Field | Type |
| --- | --- |
| id | UUID |
| username | VARCHAR |
| email | VARCHAR |
| display_name | VARCHAR |
| status | ENUM |
| preferences | JSONB |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

Credentials should never be stored in plaintext.

Authentication credentials should be handled through the authentication subsystem.

---

# 9. Roles

```text
roles
```

Initial roles:

```text
player
parent
educator
admin
developer
system
```

Relationship:

```text
users N ------- N roles
```

Through:

```text
user_roles
```

---

# 10. Permissions

```text
permissions
```

Examples:

```text
server.read
server.start
server.stop
server.restart
world.read
world.import
world.export
player.read
player.kick
player.ban
provider.read
provider.manage
audit.read
ai.use
ai.execute
```

Relationship:

```text
roles N ------- N permissions
```

This creates a reusable RBAC system rather than hardcoding permissions into individual screens.

---

# 11. Parent/Child Relationships

```text
family_relationships
```

| Field | Purpose |
| --- | --- |
| parent_user_id | Parent |
| child_user_id | Child |
| relationship_type | Relationship |
| status | Active/inactive |

Example:

```text
Parent Jono
    |
    +-- Child A
    +-- Child B
```

The architecture does not require children to have unrestricted access to parent accounts.

---

# 12. Parental Rules

```text
parental_rules
```

| Field | Purpose |
| --- | --- |
| id | UUID |
| parent_id | Owner |
| child_id | Subject |
| rule_type | Rule category |
| configuration | JSONB |
| enabled | BOOLEAN |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

Possible rule types:

```text
play_time
allowed_hours
server_access
chat_policy
player_interaction
content_access
purchase_permission
```

Example:

```json
{
  "rule_type": "play_time",
  "configuration": {
    "daily_minutes": 120
  }
}
```

---

# 13. Server Access Rules

Parents may control access to specific servers.

```text
server_access_rules
```

Example:

```json
{
  "child_id": "child_001",
  "server_id": "srv_001",
  "allowed": true
}
```

This allows:

```text
Child
 +-- Family Server     yes
 +-- Friends Server    yes
 +-- Public Server     no
```

---

# 14. Educational Data

GameHub should remain education-provider agnostic.

```text
educational_programs
```

```text
curricula
courses
lessons
activities
achievements
```

Relationship:

```text
Program
  |
  +-- Curriculum
         |
         +-- Course
                |
                +-- Lesson
                       |
                       +-- Activity
```

This leaves the eventual IsikoloAi integration outside the GameHub core.

---

# 15. Educational Progress

```text
learning_progress
```

| Field | Purpose |
| --- | --- |
| user_id | Student |
| activity_id | Activity |
| status | Progress |
| score | Result |
| completed_at | Completion |
| metadata | Additional data |

This later enables rules such as:

```text
Lesson completed
      v
Quiz passed
      v
Achievement awarded
      v
GameHub reward eligibility
```

The integration should remain optional.

---

# 16. AI Context

```text
ai_contexts
```

| Field | Purpose |
| --- | --- |
| id | UUID |
| user_id | Requesting user |
| server_id | Relevant server |
| provider_id | Relevant provider |
| context_type | Context classification |
| context_data | JSONB |
| created_at | Timestamp |
| expires_at | Timestamp |

AI context should be assembled, not treated as permanent application state.

---

# 17. AI Conversations

```text
ai_conversations
```

```text
id
user_id
provider
model
title
metadata
created_at
updated_at
```

Messages:

```text
ai_messages
```

```text
id
conversation_id
role
content
context_id
created_at
```

---

# 18. Operations

From JBGH-005:

```text
operations
```

Example:

```text
operation
    |
    +-- server.start
    +-- server.stop
    +-- world.import
    +-- world.backup
    +-- pack.validate
```

Fields:

```text
type
status
user_id
server_id
provider_id
request_data
result_data
error_data
started_at
completed_at
```

---

# 19. Events

```text
events
```

Events are append-oriented.

Example:

```json
{
  "event_type": "SERVER_STARTED",
  "provider_id": "...",
  "server_id": "...",
  "payload": {},
  "timestamp": "..."
}
```

Events should not be rewritten merely because the current state changes.

---

# 20. Audit Logs

```text
audit_logs
```

Every privileged action should generate an audit record.

```json
{
  "actor_id": "user_001",
  "action": "server.restart",
  "resource_type": "server",
  "resource_id": "srv_001",
  "result": "success",
  "timestamp": "..."
}
```

Audit logs should be append-only from the application's perspective.

---

# 21. Backups

```text
backups
```

Supports:

```text
server backups
world backups
configuration backups
```

Fields:

```text
id
server_id
world_id
type
location
size
checksum
created_at
status
```

Checksums allow integrity validation.

---

# 22. Entity Relationship Summary

```text
USERS
 |
 +--< USER_ROLES >-- ROLES --< ROLE_PERMISSIONS >-- PERMISSIONS
 |
 +--< FAMILY_RELATIONSHIPS
 |
 +--< PARENTAL_RULES
 |
 +--< AI_CONTEXTS
 |
 +--< AI_CONVERSATIONS --< AI_MESSAGES
 |
 +--< AUDIT_LOGS

PROVIDERS
 |
 +--< SERVERS
 |      |
 |      +--< WORLDS
 |      |     |
 |      |     +--< CONTENT_PACKS
 |      |     +--< BACKUPS
 |      |
 |      +--< PLAYERS
 |
 +--< CAPABILITIES

SERVERS
 |
 +--< OPERATIONS
 +--< EVENTS
 +--< AUDIT_LOGS

EDUCATIONAL_PROGRAMS
 |
 +--< CURRICULA
        |
        +--< COURSES
               |
               +--< LESSONS
                      |
                      +--< ACTIVITIES
                             |
                             +--< LEARNING_PROGRESS
```

---

# 23. State Management

The database distinguishes desired state from observed state.

Example:

```text
Desired:
server.status = running

Observed:
provider.status = starting
```

This is critical for asynchronous server operations.

Eventually:

```text
desired = running
observed = running
```

If they diverge:

```text
desired = running
observed = stopped
```

GameHub can report:

Server failed to reach desired state.

---

# 24. Real-Time Dashboard Performance

Dashboard queries should not repeatedly calculate expensive provider state.

Use:

```text
Provider Runtime
       v
Status Collector
       v
Cached Server State
       v
Dashboard
```

Recommended strategy:

- indexed server/provider/status columns
- cached current status
- append-only event history
- pagination for historical events
- aggregation tables/materialized views when scale requires them

---

# 25. Indexing Strategy

Initial indexes:

```text
providers(provider_key)

servers(provider_id)
servers(status)

worlds(server_id)
worlds(current)

content_packs(world_id)
content_packs(pack_uuid)

users(username)
users(email)

events(server_id, timestamp)
events(provider_id, timestamp)

audit_logs(actor_id, timestamp)
audit_logs(resource_id, timestamp)

operations(server_id, status)
operations(created_at)
```

---

# 26. JSONB Usage

JSONB is appropriate for genuinely provider-specific or extensible data.

Good:

```text
provider.configuration
provider.capabilities
server.metadata
content_pack.manifest
AI context
provider-specific settings
```

Bad:

```text
user_id
server_id
provider_id
status
created_at
```

Core relational fields should remain strongly typed.

---

# 27. Migration Strategy

Database migrations are version controlled.

```text
001_initial_schema
002_provider_capabilities
003_parental_controls
004_ai_context
005_education
...
```

Each migration must be:

- deterministic
- reversible where practical
- tested
- compatible with the supported previous schema

---

# 28. Backward Compatibility

API version and database version are independent.

```text
API v1
   |
   v
Database v5
```

A future:

```text
API v2
```

may still operate against the same database migration level.

Database migrations must never silently destroy data required by supported API versions.

---

# 29. Data Retention

Different classes require different retention policies.

| Data | Retention |
| --- | --- |
| Current server state | Persistent |
| Configuration | Persistent |
| Audit logs | Long-term |
| Events | Configurable |
| AI context | Configurable |
| AI conversations | User-controlled/configurable |
| Temporary operations | Limited |
| Runtime logs | Configurable |

Exact legal/privacy retention requirements remain a deployment-specific policy.

---

# 30. AI Studio Consumption Guide

AI Studio should treat this document as the data model contract.

Before generating persistence code, AI Studio must determine:

```text
1. What entity is being created?
2. Which existing entity owns it?
3. What is the cardinality?
4. Which fields are relational?
5. Which fields are provider-specific?
6. What indexes are required?
7. What audit/event records are generated?
8. What migration is required?
9. What data must never be deleted?
10. Which API resources map to the entity?
```

### Example

Requirement:

Add server backups.

AI Studio should derive:

```text
API
 v
Backup Service
 v
backups table
 v
server/world relationship
 v
checksum
 v
operation
 v
event
 v
audit
```

It should not simply create a generic backup_data table without understanding the existing model.

---

# 31. Validation Checklist

```yaml
document: JBGH-006
version: 0.1.0
status: DRAFT

entities:
  providers: complete
  capabilities: complete
  servers: complete
  worlds: complete
  content_packs: complete
  users: complete
  roles: complete
  permissions: complete
  parental_rules: complete
  education: complete
  ai_context: complete
  ai_conversations: complete
  operations: complete
  events: complete
  audit_logs: complete
  backups: complete

architecture:
  provider_agnostic: validated
  multi_world: validated
  multi_server: validated
  async_operations: validated
  event_model: validated
  audit_model: validated

minecraft:
  behavior_packs: supported
  resource_packs: supported
  manifest_metadata: supported
  validation_state: supported

performance:
  indexes: defined
  realtime_strategy: defined
  caching_strategy: defined

migration:
  versioning: defined
  compatibility: defined

pending:
  concrete_sql_migrations: implementation artifact
  final_erd: implementation artifact
  production_scaling_parameters: future validation
```

---

# Architecture Gate

JBGH-006 - Database Schema Design: DRAFT complete.

The foundation sequence now stands at:

```text
JBGH-001  Vision
     v
JBGH-002  PRD
     v
JBGH-003  Master Technical Specification
     v
JBGH-004  Architecture
     v
JBGH-005  API Specification
     v
JBGH-006  Database Schema
     v
JBGH-007  Design System
```
