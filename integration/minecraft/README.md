# JB³ GameHub Integration Test Environment

This directory holds the isolated Minecraft test environment used for provider validation.

## Layout

```text
integration/minecraft/
├── README.md
├── config/
├── fixtures/
├── scripts/
└── server/
```

## Safety

This environment is read/write only for the managed test server directory under `integration/minecraft/server`.
It must never point at a user or production Minecraft installation.

The environment is intentionally labeled as:

`JB³ GAMEHUB INTEGRATION TEST SERVER`

## Commands

From the repository root:

```bash
npm run minecraft:test:setup -- --accept-eula
npm run minecraft:test:start
npm run minecraft:test:status
npm run minecraft:test:stop
npm run minecraft:test:clean -- --confirm
```

## What it does

- downloads a configurable Paper build
- writes an isolated Paper server config
- writes an isolated Geyser config
- copies the deterministic integration world and pack fixtures
- stores runtime state inside `integration/minecraft/server`
- refuses to touch any unrelated installation directory

## Notes

- `setup` requires Java 21.
- `setup` does not accept the EULA silently.
- `clean` refuses to delete anything unless `--confirm` is passed.
- `start` and `stop` act only on the managed integration server directory.
