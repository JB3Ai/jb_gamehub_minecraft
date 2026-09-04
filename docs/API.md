# API.md - API Specifications

## REST Endpoints

### `GET /api/health`
Returns current server health status.

### `GET /api/providers`
Returns registered providers.

### `GET /api/providers/:id`
Returns provider metadata and capabilities.

### `GET /api/servers`
Returns discovered servers with provider-backed operational metadata used by the dashboard.

Response fields include:

- `id`
- `providerId`
- `name`
- `serverType`
- `status`
- `availability`
- `lastStatusUpdate`
- `connectionEndpoints[]`
- `endpoints.java`
- `endpoints.bedrock` (when available)
- `diagnostics.paperDetected`
- `diagnostics.geyserDetected`

### `GET /api/servers/:id`
Returns one server summary and current status.

### `GET /api/servers/:id/status`
Returns current server lifecycle state.

### `POST /api/servers/:id/start`
Starts a server and returns an operation reference.

### `POST /api/servers/:id/stop`
Stops a server and returns an operation reference.

### `POST /api/servers/:id/restart`
Restarts a server and returns an operation reference.

### `GET /api/servers/:id/worlds`
Lists worlds from the provider.

### `POST /api/servers/:id/worlds/:worldId/validate`
Runs provider-owned world/pack validation.

### `GET /api/operations/:id`
Returns operation details by ID.

### `GET /api/operations`
Returns persisted operation history with optional filters.

Supported query params:

- `providerId`
- `serverId`
- `operationId`
- `type`
- `state`
- `from`
- `to`
- `limit`

### `GET /api/events`
Returns persisted durable event history.

Supported query params:

- `providerId`
- `serverId`
- `operationId`
- `type`
- `from`
- `to`
- `limit`

### `GET /api/servers/:providerId/:serverId/history`
Returns provider-scoped and server-scoped historical bundle:

- latest known `server_state`
- recent operations
- recent durable events
- recent audit records

### `POST /api/history/cleanup`
Runs explicit retention cleanup for persisted history.
Requires confirmation body:

```json
{
	"confirm": "CLEANUP_HISTORY",
	"actor": "optional-operator-id"
}
```

Returns deleted row counts, active retention policy, execution timestamp, and applied cutoffs.

### `GET /api/history/overview`
Returns persisted history storage and retention overview:

- configured retention values
- current database size in bytes (when available)
- oldest retained timestamps by domain

### `GET /api/analytics/summary`
Returns cross-provider summary metrics for a time window.

### `GET /api/analytics/providers/:providerId`
Returns provider-scoped metrics for a time window.

### `GET /api/analytics/servers/:providerId/:serverId`
Returns server-scoped operational and uptime metrics for a time window.

### `GET /api/analytics/operations`
Returns aggregated operation metrics for a time window.

### `GET /api/analytics/events`
Returns aggregated event metrics for a time window.

### `GET /api/analytics/uptime`
Returns uptime/offline durations and percentages per server for a time window.

### `GET /api/analytics/world-validation`
Returns world validation outcomes and recent failed validation operations for a time window.

Analytics query params:

- `window` (`24h`, `7d`, `30d`)
- `from`
- `to`
- `providerId`
- `serverId`
- `type` (operations endpoint)
- `state` (operations endpoint)
- `limit`

Analytics response envelope shape:

- `generatedAt`
- `from`
- `to`
- optional `providerId`
- optional `serverId`
- `data`

### `GET /api/families`
Returns all configured family records.

### `POST /api/families`
Creates a family with a timezone and optional metadata.

### `GET /api/families/:familyId`
Returns a single family record.

### `GET /api/families/:familyId/children`
Lists child profiles for a family.

### `POST /api/families/:familyId/children`
Creates a child profile.

### `GET /api/children/:childId`
Returns a child profile.

### `PATCH /api/children/:childId`
Updates child profile metadata, timezone, or active status.

### `GET /api/children/:childId/identities`
Lists provider-linked player identities.

### `POST /api/children/:childId/identities`
Links a child to a provider identity.

### `GET /api/children/:childId/rules`
Lists parental rules for the child.

### `POST /api/children/:childId/rules`
Creates a parental rule.

### `PATCH /api/rules/:ruleId`
Updates a parental rule.

### `GET /api/children/:childId/sessions`
Lists play sessions for a child.

### `GET /api/children/:childId/playtime`
Returns daily/weekly usage totals and remaining allowance.

### `POST /api/children/:childId/evaluate-access`
Evaluates player access against the deterministic rules engine.

### `POST /api/children/:childId/overrides`
Creates a time-bounded parent override.

### `DELETE /api/overrides/:overrideId`
Revokes a parent override.

### `GET /api/ai/providers`
Returns the active AI Studio provider (`gemini`, `openai`, or `fallback`), configured model, and which
provider API keys are configured. Never returns secret values. Response always includes `readOnly: true`.

### `POST /api/ai/ask`
Asks the read-only AI Studio assistant a natural-language question about GameHub operational history.

Request body:

- `question` (required, 3-2000 characters)
- `providerId` (optional scope)
- `serverId` (optional scope)
- `window` (optional, `24h` | `7d` | `30d`, default `24h`)

Response:

- `requestId`
- `question`
- `answer`
- `providerId` (AI provider used)
- `model`
- `contextSources[]`
- `contextWindow.from` / `contextWindow.to`
- `generatedAt`

AI Studio is strictly read-only: it cannot start, stop, restart, delete, or modify any GameHub resource.
It can only observe and explain data already recorded by providers, operations, events, and analytics.

### `GET /api/ai/audit`
Returns the AI Studio query audit trail (`action=ai.query.requested`), bounded by `limit`.
Each entry records requestId, actor, provider/model, context sources used, timestamps, and response
metadata (question/answer lengths only). Raw prompt and response text are never persisted.

### `POST /api/ai/copilot`
Sends natural language admin commands to Gemini for copilot-driven actions.

## WebSocket Endpoint

### `GET /ws` (WebSocket upgrade)
Streams provider events to connected clients.

Current event types:

- `operation.created`
- `operation.started`
- `operation.completed`
- `operation.failed`
- `server.status.changed`
- `world.validation.completed`

Durability notes:

- Durable/persisted: `operation.created`, `operation.started`, `operation.completed`, `operation.failed`, `server.status.changed`, `world.validation.completed`
- Transient only: `connection.ready`
