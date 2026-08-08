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
Returns deleted row counts and active retention policy.

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
