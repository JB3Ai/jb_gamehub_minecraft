# JBGH-011A - Local Paper + Geyser Integration Test Environment

## Purpose

JBGH-011A creates a completely isolated local Minecraft environment for real end-to-end provider validation. It is a test-only setup for proving that GameHub can discover and understand a Paper server, a Geyser bridge, and a deterministic world without touching a user's production installation.

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- Java 21
- Network access for downloading Paper and Geyser artifacts
- A Minecraft installation directory reserved for testing only

## Directory Structure

The test environment lives under:

```text
integration/minecraft/
├── README.md
├── config/
├── fixtures/
├── scripts/
└── server/
```

The managed runtime state is stored only in `integration/minecraft/server`.

## Paper Setup

The setup script downloads a configurable Paper build and prepares an isolated Paper server directory.

Defaults:

- Paper version: `1.21.4`
- Java port: `25565`
- Host: `127.0.0.1`

The setup is explicit about the EULA. It will not silently accept Minecraft's EULA. Use:

```bash
npm run minecraft:test:setup -- --accept-eula
```

If you do not pass `--accept-eula`, the setup writes `eula=false` and the start command will refuse to launch the server.

## Geyser Setup

The environment writes an isolated Geyser config at:

- `integration/minecraft/server/plugins/Geyser-Spigot/config.yml`

The default Bedrock port is `19132` and the bridge points Bedrock to the local Java server at `25565`.

The integration script can optionally download the Geyser Spigot plugin so the Bedrock endpoint is actually available when the server starts.

## Lifecycle Commands

```bash
npm run minecraft:test:setup -- --accept-eula
npm run minecraft:test:start
npm run minecraft:test:status
npm run minecraft:test:stop
npm run minecraft:test:clean -- --confirm
```

Command behavior:

- `setup` creates the isolated test server and fixture copies.
- `start` launches Paper only for the managed integration server.
- `status` is read-only and reports provider, connectivity, worlds, and validation.
- `stop` shuts down only the managed integration server process.
- `clean` removes only the managed integration server directory after explicit confirmation.

## GameHub Configuration

Use the existing runtime configuration system with:

```bash
MINECRAFT_SERVER_DIR=./integration/minecraft/server
MINECRAFT_HOST=127.0.0.1
MINECRAFT_JAVA_PORT=25565
MINECRAFT_BEDROCK_PORT=19132
```

For provider-managed lifecycle operations, the example env file also points start/stop commands at the integration scripts.

## Validation Flow

Once the environment is set up and started, GameHub can validate:

- provider discovery
- capability discovery
- Java status
- world listing
- pack validation

The read-only diagnostic remains the first safe check. It should be run before any lifecycle automation is attempted against the integration server.

## Troubleshooting

- If setup fails, confirm Java 21 is installed and visible in `PATH`.
- If Paper download fails, verify network access to the Paper API.
- If Geyser download fails, verify network access to the Geyser download endpoint.
- If `start` refuses to run, confirm `eula.txt` contains `eula=true`.
- If the server directory already contains unrelated files, the setup script stops rather than overwriting them.
- If `status` shows the server offline, confirm the Paper process is running and the Java port is correct.

## Safety Boundaries

This environment must only operate on the managed integration server directory.
It must never touch:

- an existing user Minecraft installation
- production worlds
- a user's global Geyser configuration
- a user's global Paper configuration

The environment is clearly labeled as:

`JB³ GAMEHUB INTEGRATION TEST SERVER`

## Removal

To remove the managed test server directory only:

```bash
npm run minecraft:test:clean -- --confirm
```

That command only deletes the managed integration server directory and refuses to run without `--confirm`.
