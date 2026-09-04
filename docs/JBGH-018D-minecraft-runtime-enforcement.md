# JBGH-018D — Minecraft Runtime Enforcement Adapter

Status: PASS

## Scope

JBGH-018D closes the provider runtime gap for Minecraft player enforcement without moving Minecraft control logic into core.

```text
core policy decision
        |
        v
Minecraft provider
        |
        v
Paper RCON adapter
        |
        v
Paper kick/list commands
```

## Runtime configuration

The managed Paper harness accepts `MINECRAFT_JAVA_PATH` and persists the resolved executable in `.jbgamehub-state.json`. The acceptance runtime uses Java 21 explicitly while the machine-wide Java 25 installation remains unchanged.

Paper RCON is enabled only when `MINECRAFT_RCON_PASSWORD` is supplied. The password is passed to the provider through runtime configuration and is never returned by an API.

## Control adapter

`PaperRconAdapter` implements the Minecraft RCON packet protocol locally and exposes:

- `execute(command)`
- `listPlayers()`
- `kickPlayer(player, reason)`

`kickPlayer` issues the Paper `kick` command and confirms removal with `list`. The Minecraft provider refuses enforcement when RCON is not configured instead of silently falling back to shell execution.

## Player lifecycle

The Minecraft provider reads Paper join/leave log events, resolves the generic `PlayerIdentity` representation, and forwards lifecycle events to the provider manager. FamilyService evaluates the deterministic policy, starts or ends durable sessions, and invokes provider enforcement for denied access.

The acceptance client uses `minecraft-protocol` in offline mode against the managed Paper server. This is a real Java protocol connection, not a synthetic provider event.

## Live acceptance evidence

Command:

```text
npm run minecraft:test:player
```

Passed sequence:

1. Java client joined Paper as `GameHubTest`.
2. Minecraft identity resolved to the linked child identity.
3. Durable session opened.
4. Client disconnected and session ended.
5. Client reconnected and accumulated usage remained persisted.
6. A one-minute session policy expired during the active session.
7. Policy evaluation returned `DENY / DAILY_LIMIT_REACHED`.
8. Paper RCON issued `kick GameHubTest`.
9. RCON `list` confirmed the player was removed.
10. `policy.denied` audit recorded provider, server, family, child, player, and reason.

Observed acceptance result:

```json
{
  "decision": "DENY",
  "reason": "DAILY_LIMIT_REACHED",
  "kickConfirmed": true,
  "providerId": "minecraft",
  "serverId": "minecraft-main"
}
```

## Validation

- TypeScript lint: PASS
- Real Java protocol player lifecycle: PASS
- Paper RCON kick confirmation: PASS
- Audit verification: PASS
- Synthetic provider remains provider-neutral: PASS

## Known limitations

- The managed acceptance server uses Paper offline mode and an offline protocol client; authenticated Mojang/Microsoft identity verification is outside this local acceptance.
- RCON credentials are supplied through environment configuration and should be secret-managed in deployed environments.
