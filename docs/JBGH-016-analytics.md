# JBGH-016 - Provider-Neutral Analytics and Operational Intelligence

## Scope

JBGH-016 adds two core capabilities on top of persisted lifecycle history:

1. Provider-neutral server connection metadata exposed from providers, not from API branching.
2. Read-only analytics endpoints and operator retention controls built on persisted operations, events, audits, and server state.

## Phase A: Provider Metadata Contract Cleanup

### Contract Additions

- `GameProvider.getServerConnectionEndpoints(serverId)`
- `ConnectionEndpoint` domain type:
  - `id`
  - `protocol`
  - `transport` (`tcp`, `udp`, `virtual`)
  - optional `host`
  - optional `port`
  - `display`
  - optional provider-specific `metadata`

### API Surface Update

`GET /api/servers` now returns provider-neutral endpoint metadata:

- `connectionEndpoints[]` (normalized provider output)
- legacy compatibility fields still present:
  - `endpoints.java`
  - `endpoints.bedrock` (optional)

No provider-specific endpoint shaping remains in the route handler.

## Phase B: Read-Only Analytics

### Analytics Service

`packages/core/analytics-service.ts` provides service-layer calculations only from manager/repository interfaces:

- `summary(window)`
- `provider(providerId, window)`
- `server(providerId, serverId, window)`
- `operations(window)`
- `events(window)`
- `uptime(window)`
- `worldValidation(window)`
- `persistenceOverview(policy)`

Window parsing supports:

- `window=24h|7d|30d`
- optional explicit `from`/`to`
- bounded query limits (max `5000`)

### API Endpoints

- `GET /api/analytics/summary`
- `GET /api/analytics/providers/:providerId`
- `GET /api/analytics/servers/:providerId/:serverId`
- `GET /api/analytics/operations`
- `GET /api/analytics/events`
- `GET /api/analytics/uptime`
- `GET /api/analytics/world-validation`
- `GET /api/history/overview`

All analytics responses use a consistent envelope:

- `generatedAt`
- `from` and `to` where applicable
- optional `providerId`
- optional `serverId`
- `data`

### Cleanup Semantics

`POST /api/history/cleanup` now requires explicit confirmation body:

```json
{
  "confirm": "CLEANUP_HISTORY",
  "actor": "optional-operator-id"
}
```

Response includes:

- deleted row counts (`operations`, `events`, `audit`)
- applied retention policy
- execution timestamp
- exact cutoff timestamps used for deletion

A cleanup audit record is persisted as `history.cleanup.requested`.

## Storage and Query Improvements

`SqlitePersistenceRepository` now includes:

- analytics indexes for operation/event query shapes
- broader bounded history query limits
- `getHistoryStorageStats()` for DB-size and oldest-record visibility

## Dashboard Impact

Operational dashboard adds a minimal "Analytics and Retention" panel with:

- 24h aggregated summary
- history retention and oldest-record visibility
- explicit cleanup action guarded by user confirmation
- cleanup result feedback

## Verification

JBGH-016 validation targets:

- TypeScript/lint passes
- API contract tests include endpoint metadata, analytics routes, and cleanup confirmation behavior
- existing lifecycle and websocket tests remain green
