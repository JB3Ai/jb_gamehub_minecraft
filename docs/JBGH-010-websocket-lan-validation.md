# JBGH-010 - WebSocket Integration Tests + LAN Diagnostic Harness

## Purpose

This change set adds two things on top of the existing provider boundary:

1. WebSocket integration tests that prove the `/ws` event stream receives provider-manager events.
2. A read-only Minecraft diagnostic command that inspects the currently configured server without starting, stopping, or modifying anything.

The diagnostic is intentionally conservative. It is designed to help validate a local or LAN-connected Minecraft server safely before any destructive automation is introduced.

## WebSocket Event Contract

The WebSocket endpoint lives at `/ws` and streams provider-manager events as JSON objects.

Current event types:

- `operation.created`
- `operation.started`
- `operation.completed`
- `operation.failed`
- `server.status.changed`
- `world.validation.completed`

Common fields:

- `type`
- `timestamp`
- `providerId`
- `serverId` where relevant
- `worldId` where relevant
- `operationId` for operation and validation events
- `status` for lifecycle and server status events
- `payload` for typed event details

Contract tests verify:

- operation lifecycle order and fields
- failure lifecycle order and fields
- server status change publication
- world validation completion publication

## Diagnostic Command

Run the safe diagnostic with:

```bash
npm run diagnose:minecraft
```

The command uses the existing provider abstraction and bootstraps the Minecraft provider through the core layer. It does not call start, stop, or restart.

It reports:

- configuration
- provider detection
- connectivity
- worlds
- pack references and validation
- overall result

## Environment Variables

The diagnostic reads the same runtime variables used by the server:

- `MINECRAFT_SERVER_DIR`
- `MINECRAFT_HOST`
- `MINECRAFT_JAVA_PORT`
- `MINECRAFT_BEDROCK_PORT`
- `MINECRAFT_START_COMMAND`
- `MINECRAFT_STOP_COMMAND`

Safety note:

- The diagnostic does not print secrets.
- Any future sensitive values should be masked before display.
- The current output only surfaces Minecraft provider settings and read-only diagnostics.

## Expected Output

The output is organized into the following sections:

- `GameHub Minecraft Provider Diagnostic`
- `Configuration`
- `Provider`
- `Connectivity`
- `Worlds`
- `Content`
- `Result`

Example shape:

```text
GameHub Minecraft Provider Diagnostic

Configuration
--------------
Server directory:
Host:
Java port:
Bedrock/Geyser port:

Provider
--------------
Minecraft provider:
Paper detected:
Geyser detected:

Connectivity
--------------
Java TCP reachable:
Bedrock UDP configuration:
Server status:

Worlds
--------------
World count:
World names:

Content
--------------
Behavior pack references:
Resource pack references:
Validation result:

Result
--------------
PASS / WARN / FAIL
```

## PASS / WARN / FAIL Interpretation

- `PASS`: provider detection, connectivity, world discovery, and validation all look healthy.
- `WARN`: the server is readable but one or more checks are incomplete, offline, missing, or mismatched.
- `FAIL`: the diagnostic could not run the read-only checks or the provider configuration is unusable.

Practical guidance:

- Use `PASS` as the best signal that the configured Minecraft server is ready for safe follow-up automation.
- Use `WARN` as a useful state when the server is intentionally offline, partially configured, or missing pack references.
- Use `FAIL` when the diagnostic itself cannot connect to the configured provider or load the configured server directory.

## Connecting the Diagnostic to an Existing LAN Server

Point the runtime variables at the server you already run on your LAN host:

```bash
MINECRAFT_SERVER_DIR="D:/path/to/your/server"
MINECRAFT_HOST="192.168.1.50"
MINECRAFT_JAVA_PORT="25565"
MINECRAFT_BEDROCK_PORT="19132"
```

Then run:

```bash
npm run diagnose:minecraft
```

The diagnostic will:

- inspect the configured provider
- probe the Java TCP port
- list discovered worlds
- evaluate pack references for the first discovered world
- report a safe PASS/WARN/FAIL summary

It will not launch or stop the server.
