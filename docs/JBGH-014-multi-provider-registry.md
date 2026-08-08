# JBGH-014 - Multi-Server / Provider Registry

## Objective

Prove that GameHub is a true Provider Manager architecture by registering multiple providers and servers without introducing Minecraft assumptions in core or frontend layers.

## Registry Topology

- `minecraft` provider (`Minecraft`)
  - `minecraft-main` server (`Minecraft Server`)
  - Real Paper/Geyser lifecycle and world validation
- `synthetic` provider (`Example Test Provider`)
  - `synthetic-main` server (`Synthetic Test Server`)
  - Simulated lifecycle with independent state and world validation

## Design Notes

- `bootstrapCore` now registers two providers.
- Provider Manager contracts are unchanged; both providers implement the same interface.
- UI consumes the same REST + WebSocket contracts and does not inspect provider-specific files.
- WebSocket events continue to include `providerId` and `serverId`, enabling cross-provider event routing in the dashboard.

## API Surface Impact

No new provider-manager contract was introduced.

`GET /api/servers` now returns provider-aware endpoint metadata:

- Minecraft server endpoint example: `127.0.0.1:25565`
- Synthetic server endpoint example: `synthetic://synthetic-main`

## Validation Coverage

Added tests verify:

1. multi-provider discovery
2. multi-server discovery
3. synthetic start/stop lifecycle operations
4. operation records include synthetic provider identity
5. websocket operation events include synthetic provider/server identity
6. websocket status change event for synthetic server

## Architectural Proof

The system now supports independent provider/server behavior through one control plane:

`UI -> REST/WS -> backend -> Provider Manager -> provider implementation`

No direct coupling from UI or core orchestration to Minecraft internals.

## Relationship To Prior Milestones

- JBGH-011A proved real Paper/Geyser runtime control.
- JBGH-012 + JBGH-012A proved lifecycle evidence capture and assertion.
- JBGH-013 delivered an operational dashboard over those contracts.
- JBGH-014 proves the same dashboard and control-plane abstractions are genuinely multi-provider.
