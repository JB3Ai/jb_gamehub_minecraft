# ARCHITECTURE.md - JB³ GameHub System Architecture

## Core System Architecture Overview

```text
       ┌─────────────────────────────────────────────────────────────┐
       │                   Browser / Client Layer                    │
       │               React 18 + Vite + Tailwind SPA                 │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
                         REST API / JSON & WebSockets
                                      │
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                    Node.js Express Backend                  │
       │            (API Routes, Process Manager, RCON Client)       │
       ├──────────────────────────────┬──────────────────────────────┤
       │                              │                              │
       ▼                              ▼                              ▼
┌──────────────┐              ┌──────────────┐               ┌──────────────┐
│  Paper Java  │              │   Bedrock    │               │  AI Agent    │
│  Server JAR  │              │  Dedicated   │               │ Gemini 3.6   │
└──────┬───────┘              └──────┬───────┘               └──────┬───────┘
       │                             │                              │
       ▼                             ▼                              │
┌──────────────┐              ┌──────────────┐                      │
│ Geyser +     │              │ UDP Bedrock  │                      │
│ Floodgate    │              │ Proxy        │                      │
└──────┬───────┘              └──────┬───────┘                      │
       │                             │                              │
       └──────────────────────┬──────┘                              │
                              │                                     │
                              ▼                                     ▼
                   ┌────────────────────┐               ┌──────────────────┐
                   │ Java & Bedrock     │               │ RCON Execution & │
                   │ Minecraft Clients  │               │ Config Synthesis │
                   └────────────────────┘               └──────────────────┘
```

---

## 1. Frontend-to-Backend Communication Flow

The interaction between the React SPA frontend and the Node.js Express backend follows a structured client-server architecture designed for real-time responsiveness and low latency.

### REST API Communication
- **Client Endpoints**: The React UI issues HTTP/REST requests via `fetch`/`axios` abstractions located in `/src/lib/api.ts` or server proxy handlers.
- **Payload Format**: Standardized JSON objects for requests and responses (`{ success: true, data: ..., error?: string }`).
- **Core Endpoints**:
  - `GET /api/health` — Cluster and backend daemon health status.
  - `GET /api/servers` — Returns all active and configured Minecraft server instances with telemetry metadata.
  - `POST /api/servers/:id/power` — Dispatch power state modifications (`start`, `stop`, `restart`).
  - `POST /api/console/command` — Direct RCON command execution targeting an active server process.
  - `POST /api/copilot/prompt` — Natural language prompt transmission to the Gemini AI Agent engine.

### Telemetry & RCON Console Streaming
- **Polling / WebSocket Channel**: Real-time telemetry (TPS, CPU %, RAM usage, online players) and console stdout logs are streamed continuously to the UI.
- **RCON Protocol Bridge**: The backend uses an internal Node.js RCON client library (`minecraft-rcon` / `mcping`) to maintain an active TCP connection to the Minecraft server's RCON port (default `25575`).

---

## 2. Paper Minecraft Server Integration Path

**Paper** is the high-performance Java server engine used as the primary foundation for Java edition gameplay and plugin support.

### Execution & Lifecycle Path
1. **Provisioning**: The backend downloads or links the target Paper server JAR (`paper-1.21.4.jar`) into the project instance directory (`/servers/:serverId/`).
2. **Configuration Synthesis**:
   - `server.properties` is generated or updated by the backend parser, configuring key parameters:
     - `enable-rcon=true`
     - `rcon.port=25575`
     - `rcon.password=<encrypted_secret>`
     - `view-distance=10`
     - `motd=JB³ GameHub Managed Server`
   - `eula.txt` is validated (`eula=true`).
3. **Process Supervision**: The Express backend spawns the Java process using `child_process.spawn()`:
   ```bash
   java -Xms2G -Xmx6G -XX:+UseG1GC -jar paper-1.21.4.jar nogui
   ```
4. **Stdout / Stderr Interception**: Log outputs are parsed in real time for crash events, tick rates, and player join/leave events.

---

## 3. Bedrock & Geyser/Floodgate Crossplay Integration Path

To achieve the vision of **"Every Device"**, GameHub seamlessly bridges Java and Bedrock Edition players using **GeyserMC** and **Floodgate**.

### Crossplay Architecture
- **GeyserMC**: A proxy/plugin that translates Bedrock network packets (UDP, Bedrock Protocol) into Java network packets (TCP, Java Protocol) on the fly.
- **Floodgate**: Allows Bedrock users to log in without needing a Java Edition Minecraft account, generating secure skin avatars and UUIDs.

### Integration Flow
```text
Bedrock Client (iOS / Android / Switch / Xbox / PlayStation)
                     │
            UDP Port 19132
                     │
                     ▼
       GeyserMC Crossplay Bridge (Plugin / Standalone)
                     │
             Packet Translation
                     │
                     ▼
       Paper Minecraft Server (TCP Port 25565) + Floodgate
```

### Configuration Pipeline
1. **1-Click Enablement**: Toggling "Geyser Crossplay" in the GameHub UI automatically places `Geyser-Spigot.jar` and `Floodgate.jar` into the server's `plugins/` directory.
2. **Auto-Configuration**: GameHub updates `plugins/Geyser-Spigot/config.yml` to bind UDP port `19132` and sync authentication modes with Floodgate.
3. **Bedrock Dedicated Server (BDS) Alternative**: For pure Bedrock instances without Java requirement, GameHub provisions native Bedrock Dedicated Server binaries with `bedrock_server.exe` / `bedrock_server` execution.

---

## 4. AI Agent (JB AI Copilot) Integration Path

The **JB AI Copilot** delivers natural language administration, automated troubleshooting, and command synthesis using the **@google/genai SDK** powered by **Gemini 3.6 Flash**.

### Flow & Guardrail Pipeline

```text
[User Natural Language Prompt]
  "Fix server lag and set view distance to 8"
                     │
                     ▼
[Express Backend API Route (/api/copilot/prompt)]
                     │
                     ▼
[@google/genai SDK - Gemini 3.6 Flash Model]
  - System Prompt: Minecraft Sysadmin & RCON Expert
  - Input: Current Telemetry (TPS: 14.2, RAM: 85%), server.properties, Prompt
                     │
                     ▼
[Structured Response & Command Intent Synthesis]
  {
    "explanation": "TPS dropped due to high view distance. Reducing to 8 and culling entities.",
    "rconCommands": ["kill @e[type=item]", "say [AI Copilot] Optimizing performance..."],
    "configUpdates": { "view-distance": 8, "simulation-distance": 6 }
  }
                     │
                     ▼
[Command Guardrail Validator]
  - Checks against prohibited file system commands
  - Verifies RCON payload syntax
                     │
                     ▼
[Execution & Feedback Engine]
  ├── RCON Dispatch ──► Minecraft Server Process
  ├── File Mutation ──► server.properties
  └── UI Stream    ──► React Copilot Chat Panel
```

### Safety & Guardrail Enforcement
- **Execution Bounds**: The AI agent is strictly restricted to RCON admin commands (`/tps`, `/kill @e[type=item]`, `/kick`, `/whitelist`, `/time`) and managed server config files.
- **Rollback Snapshots**: Prior to executing AI-suggested configuration changes, GameHub automatically generates an in-memory or disk snapshot for 1-click restoration.
