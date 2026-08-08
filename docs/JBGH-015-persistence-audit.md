# JBGH-015 - Persistent Operations, Events, and Audit Trail

## Objective

Add durable operational history for provider-managed actions while keeping persistence as a core service boundary, not a provider concern.

## Architecture

```text
Provider
   ↓
Provider Manager
   ↓
Operation/Event Service
   ↓
Persistence Repository Interface
   ↓
SQLite Repository (JBGH-015)
```

Key rule: provider implementations do not access SQLite directly.

## Implementation Summary

- `InMemoryProviderManager` now composes a persistence-backed `OperationEventService`.
- Operation lifecycle writes (`queued`, `running`, `completed`, `failed`) are persisted before events are broadcast.
- Durable event records and audit records are written through a repository interface.
- Server state snapshots are persisted on lifecycle status transitions.
- Startup loads persisted state, marks prior snapshots as stale, then reconciles against live provider status probes.

## Repository Interfaces

Defined in provider-manager domain layer:

- `PersistenceRepository`
  - operations: create/update/get/list
  - events: append/list
  - server_state: upsert/list
  - audit_log: append/list
  - retention cleanup: explicit `cleanupExpired`
- `OperationQuery` / `EventQuery`
- `RetentionPolicy` / `RetentionCleanupResult`

This keeps Provider Manager and API contracts stable when swapping storage implementation.

## SQLite Schema

`schema version: 1` via `PRAGMA user_version`

Tables:

- `operations`
  - `id`, `provider_id`, `server_id`, `type`, `state`, `created_at`, `started_at`, `completed_at`, `error`, `metadata`
- `events`
  - `id`, `provider_id`, `server_id`, `operation_id`, `type`, `timestamp`, `payload`
- `server_state`
  - `provider_id`, `server_id`, `status`, `availability`, `last_seen_at`, `metadata`
  - composite primary key: `(provider_id, server_id)`
- `audit_log`
  - `id`, `timestamp`, `actor`, `action`, `provider_id`, `server_id`, `operation_id`, `result`, `metadata`

All timestamps are UTC ISO strings.

## Migration Strategy

- Migrations run at startup in `SqlitePersistenceRepository.initialize()`.
- Current schema version is validated against `SCHEMA_VERSION`.
- Forward migrations execute in transactions (`BEGIN/COMMIT`), and rollback on failure.
- Startup fails fast on migration errors or incompatible newer schema versions.

## Event Durability Policy

Durable events persisted to SQLite:

- `operation.created`
- `operation.started`
- `operation.completed`
- `operation.failed`
- `server.status.changed`
- `world.validation.completed`

Transient transport-only example:

- `connection.ready` (WebSocket session event) is not persisted.

## Failure Handling Policy

- Persistence write failures are not treated as success.
- If durable write fails during operation lifecycle handling, command execution does not return a false success state.
- Operation failure is explicit (`operation.failed` and error metadata) when failure occurs after operation creation.
- Migration failures prevent startup.

## Server State and Reconciliation

On status change:

1. update in-memory last-known status
2. persist `server_state` snapshot
3. persist and publish `server.status.changed`

On startup:

1. load persisted snapshots
2. mark snapshots stale (`metadata.stale = true`)
3. discover registered provider servers
4. probe live provider status and reconcile differences
5. emit durable status-change events when state transitions are detected

Persisted state is last-known historical state, not a guarantee of current runtime liveness.

## Audit Semantics

Recorded management actions:

- `server.start.requested`
- `server.stop.requested`
- `server.restart.requested`
- `world.validation.requested`

Fields include actor (`local-admin` for this milestone), provider, server, operation, result, metadata.

## Retention

Configurable via environment variables:

- `EVENT_RETENTION_DAYS` (default `30`)
- `AUDIT_RETENTION_DAYS` (default `365`)
- `OPERATION_RETENTION_DAYS` (default `90`)

Cleanup is explicit and operator-invoked through `POST /api/history/cleanup`.

JBGH-015 does not run automatic background deletion.

## REST Additions

Read-only history endpoints:

- `GET /api/operations`
- `GET /api/operations/:id`
- `GET /api/events`
- `GET /api/servers/:providerId/:serverId/history`

Supported filters:

- `providerId`
- `serverId`
- `operationId`
- `type`
- `state` (operations)
- `from`
- `to`
- `limit`

Retention action endpoint:

- `POST /api/history/cleanup`

## Dashboard Changes

Minimal changes only:

- Operations now hydrate from persisted `GET /api/operations` on refresh/reload.
- Event table hydrates from persisted `GET /api/events` and labels each row as `HISTORY` or `LIVE`.
- Live event flow from WebSocket remains unchanged.

## Provider Isolation Evidence

Records remain explicitly scoped by `providerId + serverId`:

- `minecraft` + `minecraft-main`
- `synthetic` + `synthetic-main`

History endpoints and DB queries confirm no cross-provider blending.

## AI Studio Consumption Guide

How to consume persisted context in AI Studio-style assistants:

1. Query recent operations for target provider/server (`GET /api/operations?...`).
2. Query durable events for temporal context (`GET /api/events?...`).
3. Query scoped server history (`GET /api/servers/:providerId/:serverId/history`).
4. Build assistant prompts from provider-scoped timelines only.
5. Avoid inferring current liveness exclusively from persisted snapshots; validate with live status endpoint.

## Completion Checklist

- [x] Durable operations persistence
- [x] Durable event persistence
- [x] Audit trail persistence
- [x] Server state snapshots persistence
- [x] Provider/server identity preserved on every record
- [x] Explicit retention cleanup path
- [x] Migration versioning and startup execution
- [x] Restart persistence verification
- [x] API history coverage
- [x] WebSocket behavior preserved
