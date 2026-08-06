# Screen Flows - JB³ GameHub

## Navigation & Screen Hierarchy

```text
[JB³ GameHub TopBar Header]
  ├── Project Switcher: [🏰 Family SMP ▾]
  ├── Quick Deploy Button: [+ New Server]
  └── RCON Context Badge: [🟢 Connected: 25575]

[Sidebar Navigation]
  ├── 📊 Dashboard      ──► Bento Grid: Live Telemetry, Server Status, Active Players, AI Bar
  ├── 🖥️ Server Manager  ──► Multi-Instance Grid, Power Toggles, server.properties Editor
  ├── 🌍 World Library   ──► Dimensions List, Snapshot Backups, .mcworld Importer
  ├── 🧩 Plugin Store    ──► Modrinth/Spigot Search, Geyser Crossplay 1-Click Toggle
  ├── ⚡ Telemetry       ──► Live Recharts TPS Graphs, Entity Counts, RCON Console Streaming
  ├── 🤖 AI Copilot      ──► Gemini 3.6 Flash Conversational Administration & Auto-Fixes
  └── ⚙️ Settings        ──► Parent Mode Limits, Discord Webhooks, API Credentials
```

---

## Screen Detail Specifications

### 1. Dashboard View (`/`)
Primary operational workspace. Displays:
- **Top Status Banner**: Overall cluster status, active player total across all servers.
- **Metrics Bento Grid**: 4 live metric cards (TPS: 20.0, CPU: 18%, RAM: 5.3/16GB, Players: 12/20).
- **Active Server List**: Compact cards showing server engine type, port, and quick power toggle.
- **Embedded AI Quick Assistant**: Single-line prompt bar to execute admin requests instantly.

### 2. Server Manager View (`/servers`)
- Multi-server cards with status badges and detail expanded panels.
- Visual `server.properties` form (MOTD, difficulty, spawn protection, view distance sliders).
- Server deployment wizard modal.

### 3. World Library View (`/worlds`)
- Dimension breakdown (Overworld, Nether, The End, Custom Adventure Maps).
- Snapshot backup timeline with 1-click restore triggers.

### 4. Plugin Store View (`/plugins`)
- Search bar with category filters (Administration, Performance, Crossplay, Economy).
- 1-click installation toggles with dependency auto-resolution badges.

### 5. Telemetry & Console View (`/monitoring`)
- Real-time Recharts line charts for TPS over time and CPU/RAM usage breakdown.
- Color-coded interactive RCON terminal stream with command input bar.

### 6. AI Copilot View (`/copilot`)
- Gemini 3.6 Flash conversational interface with quick prompt chips.
- Command execution history log with rollbacks.
