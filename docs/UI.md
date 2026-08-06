# UI.md - Design System & Component Guidelines

## Color Tokens
- **Background**: `#09090b` (Slate Dark Canvas)
- **Surface**: `#18181b` (Card Background)
- **Border**: `#27272a` (Subtle 1px Borders)
- **Primary / Success**: `#10b981` (Emerald 500)
- **Accent / Warning**: `#f59e0b` (Amber 500)
- **Danger**: `#f43f5e` (Rose 500)
- **Info / Bedrock**: `#3b82f6` (Blue 500)
- **Plugin Purple**: `#a855f7` (Purple 500)

## Typography
- **Headings**: Plus Jakarta Sans / Inter Display font with high tracking and bold weights
- **Telemetry & Logs**: Monospace (`font-mono`) for console logs, IP addresses, ports, and metrics.

## Key Component Blueprint
- `<ServerCard />`: Displays server status, IP, port, player count, and power toggle.
- `<PlayerCard />`: Displays player skin head, OP badge, world, ping, and quick action buttons.
- `<MetricCard />`: Highlights single telemetry metrics (TPS, CPU, RAM, Players).
- `<ConsoleWindow />`: Interactive dark terminal with streaming RCON logs and command input.
- `<PluginCard />`: Displays plugin info, version, category, and 1-click install button.
- `<WorldCard />`: Displays world preview, size, type, and import/clone actions.
- `<AIChat />`: Interactive Copilot panel with quick prompt chips and structured response rendering.
