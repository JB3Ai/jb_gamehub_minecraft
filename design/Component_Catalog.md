# Component Catalog - JB³ GameHub

The UI relies on reusable, modular components engineered with React, Tailwind CSS, Lucide icons, and Motion.

---

## 1. Core Component Blueprints

### `<ServerCard />`
- **Purpose**: Displays individual server instance summary, engine badge, online status, IP address, player count, and power controls.
- **Props**: `server: ServerInstance`, `onPowerToggle()`, `onSelect()`, `onOpenBackup()`

### `<PlayerCard />`
- **Purpose**: Shows player head avatar (Minotar/Crafatar), username, ping status (ms bar), current world dimension, OP privilege pill, and quick moderation actions (Kick, Ban, Teleport).
- **Props**: `player: Player`, `onOpToggle()`, `onKick()`, `onBan()`

### `<MetricCard />`
- **Purpose**: High-impact telemetry display block (e.g. TPS, CPU %, RAM GB, Player Count) with trend badges and Sparkline graph.
- **Props**: `label: string`, `value: string | number`, `subtext: string`, `icon: LucideIcon`, `trend: string`, `status: 'good' | 'warning' | 'danger'`

### `<Sidebar />`
- **Purpose**: Left-hand navigation rail allowing switching between Dashboard, Servers, Worlds, Plugins, Telemetry, AI Copilot, and Settings views.
- **Props**: `activeTab: string`, `onTabChange(tab: string)`, `serverCount: number`

### `<TopBar />`
- **Purpose**: Top header displaying active Project Workspace name ("Family SMP"), server engine selector, quick power toggle, and active AI status.
- **Props**: `currentProject: string`, `activeServer: ServerInstance`, `onNewServer()`

### `<ConsoleWindow />`
- **Purpose**: Dark terminal window streaming color-coded live RCON console logs with command input field and quick action macro buttons (`/tps`, `/list`, `/reload`).
- **Props**: `logs: ConsoleLog[]`, `onCommandSend(cmd: string)`

### `<PluginCard />`
- **Purpose**: Displays plugin icon, title, description, category badge, rating, and 1-click Install/Uninstall button.
- **Props**: `plugin: PluginItem`, `isInstalled: boolean`, `onToggleInstall()`

### `<WorldCard />`
- **Purpose**: Renders world preview banner, dimension type (Overworld, Nether, End), file size, player count, and snapshot backup buttons.
- **Props**: `world: WorldItem`, `onBackup()`, `onClone()`, `onDelete()`

### `<AIChat />`
- **Purpose**: Interactive AI Copilot assistant panel with quick prompt chips, structured execution logs, and Gemini 3.6 Flash responses.
- **Props**: `onPromptSubmit(prompt: string)`
