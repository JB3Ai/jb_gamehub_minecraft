# JBGH-013 - Minimal Operational Dashboard

## Overview

JBGH-013 delivers the first functional operator dashboard over proven backend contracts.

The dashboard reads provider/server/world/operation data through REST and consumes live lifecycle updates from `/ws`.

It intentionally avoids Minecraft filesystem access and command execution in frontend code.

## Dashboard Architecture

Dependency direction:

`UI -> frontend service layer -> REST + WebSocket -> backend -> Provider Manager -> Minecraft Provider`

No direct UI dependency on local server files or shell commands.

## Component Hierarchy

- `App` wires the operational dashboard hook
- `useOperationalDashboard` orchestrates data loading, command execution, and live event updates
- `OperationalDashboard` renders five operational areas:
  - `SERVERS`
  - `STATUS`
  - `OPERATIONS`
  - `WORLDS`
  - `LIVE EVENTS`
- Presentational panel components:
  - `ServersPanel`
  - `StatusPanel`
  - `OperationsPanel`
  - `WorldsPanel`
  - `LiveEventsPanel`

## API Dependencies

REST commands and queries used:

- `GET /api/providers`
- `GET /api/providers/:id`
- `GET /api/servers`
- `GET /api/servers/:id/status`
- `POST /api/servers/:id/start`
- `POST /api/servers/:id/stop`
- `POST /api/servers/:id/restart`
- `GET /api/servers/:id/worlds`
- `POST /api/servers/:id/worlds/:worldId/validate`
- `GET /api/operations/:id`

## WebSocket Dependencies

WebSocket endpoint:

- `/ws`

Consumed events:

- `operation.created`
- `operation.started`
- `operation.completed`
- `operation.failed`
- `server.status.changed`
- `world.validation.completed`

Connection states surfaced to UI:

- `CONNECTED`
- `DISCONNECTED`
- `RECONNECTING`

Reconnect strategy:

- automatic reconnect with bounded backoff up to 5 seconds

## State Management

State model tracks:

- provider metadata
- discovered servers and selected server
- operation history
- worlds per selected server
- validation results per world
- live event stream (newest first)
- websocket connection state
- loading and error states

Event handling updates the same store used by rendered panels.

## Responsive Strategy

Breakpoints support:

- desktop (multi-column dashboard)
- tablet (single-column cards with persistent sections)
- mobile (single-column compact cards and horizontal section navigation)

The layout prioritizes status readability and command visibility on tablet first.

## Error Handling

Visible error states include:

- backend unavailable
- websocket disconnected/reconnecting
- operation failures
- server offline/unavailable
- empty worlds list
- empty operations list
- world validation failures

Errors are displayed in panel-level and global banners; failures are never silently ignored.

## Acceptance Test

Target flow:

1. Start GameHub
2. Open dashboard
3. Provider is discovered
4. Server starts from `OFFLINE`
5. Press `START`
6. Operation appears
7. Live events show `operation.created`
8. Live events show `operation.started`
9. Server reaches `ONLINE`
10. Live events show `server.status.changed`
11. Worlds shows `jb3-integration-test-world`
12. Validation result appears
13. Press `STOP`
14. Operation appears
15. Server reaches `OFFLINE`
16. Live events show final status transition

## Known Limitations

- Operational state is currently memory-backed and reset on backend restart.
- Operation history starts from app session time; it is not yet persisted across reloads.
- The dashboard is intentionally operational-first and not yet final visual branding.

## AI Studio Consumption Guide

To reuse this dashboard architecture in AI coding systems:

1. Keep service-layer contracts explicit and independent from component rendering.
2. Preserve event-to-state reducers as pure functions so they can be tested in isolation.
3. Keep operational panel boundaries fixed (`SERVERS`, `STATUS`, `OPERATIONS`, `WORLDS`, `LIVE EVENTS`) for incremental regeneration.
4. Treat WebSocket as the authoritative live state channel and REST as command/query paths.
5. Add provider types by extending API payloads and reducers, not by introducing provider-specific UI file access.
