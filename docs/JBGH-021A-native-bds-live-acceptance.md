# JBGH-021A - Native BDS Live Acceptance Harness

Status: CLOSED / PASS
Milestone: JBGH-021A - Native BDS Live Acceptance Harness
Depends on: JBGH-021

## JBGH-021A — CLOSED / PASS

Native Bedrock Dedicated Server live acceptance completed successfully
on 2026-10-01.

Validated:

- native BDS start/stop
- provider discovery
- endpoint/capabilities discovery
- provider-discovered world validation
- world: Bedrock level
- real client join
- Family session start
- client disconnect
- Family session closure
- reconnect usage persistence
- SERVER_ACCESS deny enforcement
- real native BDS kick
- audit/history evidence
- dashboard evidence
- persistence after GameHub restart
- source BDS preservation
- disposable runtime cleanup

All 18 acceptance gates passed.

JBGH-021A is CLOSED.
JBGH-022 may now proceed.

## Purpose

[`run-native-bds-acceptance.ts`](../integration/bedrock/scripts/run-native-bds-acceptance.ts)
is an opt-in harness for the only remaining JBGH-021 gate: a real Bedrock
Dedicated Server and real Bedrock client identity. It does not download BDS,
bundle a client, alter Paper, or run unless the operator supplies all required
inputs.

## Required inputs

| Variable | Meaning |
|---|---|
| `BDS_SERVER_PATH` or `BEDROCK_SERVER_DIR` | Existing native BDS installation directory. Must contain `bedrock_server.exe` on Windows or `bedrock_server` elsewhere. |
| `BDS_EXECUTABLE_PATH` | Optional absolute path to the BDS executable inside `BDS_SERVER_PATH`. |
| `BDS_SERVER_ADDRESS` / `BDS_SERVER_PORT` | Disposable BDS bind address and UDP port; defaults to `127.0.0.1:19132`. |
| `BDS_ACCEPTANCE_CLIENT_COMMAND` | Operator-provided command that joins the disposable BDS as the real Bedrock identity. |
| `BDS_ACCEPTANCE_XUID` | Real client XUID linked to the disposable acceptance child. |

Optional settings: `BDS_ACCEPTANCE_DIR` (must remain inside
`integration/bedrock/`), `BDS_ACCEPTANCE_API_PORT`, `BDS_ACCEPTANCE_EVIDENCE_PATH`,
`MINECRAFT_BEDROCK_PORT`, and `BDS_ACCEPTANCE_DISPLAY_NAME`.

## Invocation

```powershell
$env:BDS_SERVER_PATH = 'D:\approved\bds'
$env:BDS_ACCEPTANCE_XUID = '2533274...'
$env:BDS_ACCEPTANCE_CLIENT_COMMAND = 'your-real-bedrock-client-probe --join'
npm run minecraft-bedrock:test:live
```

The probe receives `JBGH_BDS_HOST`, `JBGH_BDS_PORT`, and `JBGH_BDS_XUID`.
It must use the real client identity, join the server, and make join/leave (and
for the final closure run, reconnect and policy-expiry removal) observable.

## Isolation and evidence

- BDS is copied into a marker-protected disposable directory under
  `integration/minecraft-bedrock/`; the source BDS installation is read-only.
- The harness writes a deterministic local `server.properties` for the
  disposable instance only.
  - Preflight rejects an unsafe acceptance path, an unmarked existing runtime,
    missing BDS executable, invalid/occupied UDP port, unavailable client probe,
    or missing XUID before it starts BDS.
  - A JSON evidence document records only actual observed gates and records an
  explicit failure if any prerequisite or observation is missing.
  - Evidence contains a hashed XUID reference, BDS executable hash, provider and
    endpoint details, lifecycle/session/policy observations, and a truthful
    `BLOCKED`, `FAILED`, or `PASS` outcome. A BDS version is recorded as
    `NOT_CAPTURED` unless an operator supplies a safe version-capture method.
  - Cleanup removes only a directory containing the harness marker.

The harness must not be used against a production BDS installation. Its
existence is not evidence that a live client acceptance passed.
