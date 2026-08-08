# JBGH-012 - Provider Lifecycle Hardening and Real Event Evidence

## Purpose

JBGH-012 captures real lifecycle evidence from the isolated integration server using the existing architecture:

- REST operations through the backend API
- WebSocket events through `/ws`
- Provider Manager orchestration
- Minecraft provider lifecycle execution

No architecture redesign is introduced.

## Scope

This step validates one complete sequence against the managed integration server:

1. establish offline baseline
2. start via `/api/servers/:id/start`
3. observe operation lifecycle events
4. observe `server.status.changed` to `online`
5. validate world/pack visibility
6. stop via `/api/servers/:id/stop`
7. observe `server.status.changed` to `offline`
8. observe operation completion for stop

## Safety Boundaries

The evidence command refuses to run unless:

- server directory is under `integration/minecraft/server`
- integration marker `.jbgamehub-managed` exists

This prevents accidental lifecycle operations against user or production installations.

## Command

Run:

```bash
npm run minecraft:test:evidence
```

By default it targets:

- `MINECRAFT_SERVER_DIR=./integration/minecraft/server`
- `MINECRAFT_HOST=127.0.0.1`
- `MINECRAFT_JAVA_PORT=25565`
- `MINECRAFT_BEDROCK_PORT=19132`
- API evidence port `3330` (override with `MINECRAFT_TEST_API_PORT`)

## Outputs

The command writes two artifacts into `integration/minecraft/evidence`:

- `JBGH-012-lifecycle-<timestamp>.json`
- `JBGH-012-lifecycle-<timestamp>.md`

Each artifact records:

- provider and server identifiers
- paper/geyser detection results
- capability snapshot
- world listing and validation summary
- operation IDs for start and stop
- event timeline including `operation.*` and `server.status.changed`
- before/after status checks

## Evidence Interpretation

A passing baseline should include:

- `operation.created` -> `operation.started` -> `operation.completed` for start
- `server.status.changed` with `online`
- `operation.created` -> `operation.started` -> `operation.completed` for stop
- `server.status.changed` with `offline`
- world listing > 0
- pack validation summary present

## Relationship to JBGH-011A

JBGH-011A proved isolated runtime integration and provider lifecycle viability.
JBGH-012 adds hard evidence artifacts from the same runtime through the API and event channel, creating a durable baseline before dashboard-oriented work.
