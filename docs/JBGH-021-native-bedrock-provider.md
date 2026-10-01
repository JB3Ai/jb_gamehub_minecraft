# JBGH-021 - Native Bedrock Server Provider

Status: IMPLEMENTED / LIVE CLIENT ACCEPTANCE PENDING
Milestone: JBGH-021 - Native Bedrock Server Provider
Dependencies: JBGH-018, JBGH-019, JBGH-020D
Requirement IDs: JBGH-021-REQ-001 through JBGH-021-REQ-010

## Objective

Add a separately registered `minecraft-bedrock` provider for a genuine
Bedrock Dedicated Server (BDS). It sits beside the existing Java/Paper
provider; it does not reinterpret Paper plus Geyser as a native Bedrock
runtime.

```text
Provider Manager
  |- minecraft          -> Paper + optional Geyser
  |- minecraft-bedrock  -> Bedrock Dedicated Server
  `- synthetic          -> test provider
```

## Runtime configuration and safety boundary

The provider is registered for discovery at all times, but it is `degraded`
and does not claim native-runtime capabilities until `BEDROCK_SERVER_DIR`
contains the platform BDS executable:

- Windows: `bedrock_server.exe`
- non-Windows: `bedrock_server`

Optional lifecycle overrides are `BEDROCK_START_COMMAND` and
`BEDROCK_STOP_COMMAND`. When `BEDROCK_SERVER_DIR` is configured, JBGH-020D
plans use that same provider-owned BDS root for worlds and packs. Otherwise,
`BEDROCK_CONTENT_DIR` remains the content-only JBGH-020D root; it does not
enable or simulate a native BDS runtime.

No provider process is started automatically. There is no bundled server
binary, download, marketplace integration, or client emulation.

## Implemented contract

| ID | Requirement | Implemented behavior |
|---|---|---|
| JBGH-021-REQ-001 | Native provider registration | `minecraft-bedrock` is listed independently from `minecraft` and `synthetic`. |
| JBGH-021-REQ-002 | Honest capability declaration | Runtime/lifecycle/player capabilities are false until a BDS executable is detected. |
| JBGH-021-REQ-003 | BDS lifecycle control | Starts a configured BDS command as a managed child process; stops through an explicit command or BDS console `stop`. |
| JBGH-021-REQ-004 | Native endpoint/status | Publishes a UDP Bedrock endpoint and reports process-backed server status. |
| JBGH-021-REQ-005 | World discovery | Discovers managed BDS worlds under `<BDS>/worlds` by `level.dat`. |
| JBGH-021-REQ-006 | Pack activation verification | Validates BDS world linkage JSON against installed managed Bedrock pack manifests. |
| JBGH-021-REQ-007 | Player lifecycle | Parses BDS connected/disconnected log lines and emits provider-neutral player events using XUID identities. |
| JBGH-021-REQ-008 | Family sessions/policy | Reuses existing provider-manager and Family Service lifecycle, session, policy, reward, and audit paths. |
| JBGH-021-REQ-009 | Enforcement | Writes a sanitized `kick` command only to a running managed BDS console. No core shell invocation is introduced. |
| JBGH-021-REQ-010 | Dashboard/API | Existing provider/server/status, world, operation, event, family, and audit API surfaces receive the provider through Provider Manager discovery. |

## Acceptance evidence

Automated disposable BDS-shaped fixture acceptance proves:

1. An unconfigured provider is degraded and rejects a start without a BDS root.
2. A detected BDS root exposes native capabilities.
3. Managed world discovery and linked-pack validation succeed.
4. BDS stdout join/leave records map to provider-neutral lifecycle events.
5. A linked XUID identity creates a provider-neutral Family Service session.
6. BDS stdin receives controlled kick/stop commands and cleanup completes.
7. A missing linked pack is reported as invalid rather than accepted.

This is process-adapter acceptance, not a claim that a licensed BDS binary or a
real Bedrock client was run in this repository.

## Required live acceptance before closure

JBGH-021 remains open until an operator supplies a real BDS installation and
captures evidence for:

```text
Bedrock world scan -> plan -> approval -> safe install
-> BDS start -> world and linked packs valid
-> real Bedrock client joins by XUID
-> GameHub session starts -> policy expires
-> BDS console kick -> player removal
-> session/audit/dashboard reconciliation
```

Until then, **LIVE NATIVE BEDROCK RUNTIME / CLIENT ACCEPTANCE: NOT EXECUTED**.

## JBGH-021A harness

The opt-in live acceptance procedure is documented in
[JBGH-021A Native BDS Live Acceptance Harness](./JBGH-021A-native-bds-live-acceptance.md).
It requires a real BDS installation, a real-client probe command, and a real
XUID; missing prerequisites fail explicitly and do not mutate a server.
