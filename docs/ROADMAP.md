# ROADMAP.md - JB³ GameHub Feature Roadmap

## 🚀 Sprint Roadmap

### Sprint 0: Foundation & Specification ✅
- [x] Monorepo repository layout (`apps/`, `packages/`, `docs/`, `design/`, `docker/`, `scripts/`)
- [x] Vision & Master Specification (`GAMEHUB_MASTER_SPEC.md`)
- [x] Product Requirements Document (`PRD.md`)
- [x] Product Overview & Architecture (`PRODUCT.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API.md`)
- [x] Innovation Backlog Sandbox (`IDEAS.md`)
- [x] Design System & UX Principles Specs (`/design/*`)

### Sprint 1: React Dashboard & Core Component Library ✅
- [x] High-density Bento Grid dashboard layout with live metrics
- [x] Dark theme design system (`#09090b` canvas, `#18181b` card surfaces)
- [x] Full sidebar & topbar workspace navigation with Project support ("Family SMP")
- [x] Mock data engine for offline-first zero-delay testing
- [x] Reusable component library (`<ServerCard />`, `<PlayerCard />`, `<MetricCard />`, `<ConsoleWindow />`, `<PluginCard />`, `<WorldCard />`, `<AIChat />`)

### Sprint 2: Backend API & Server Discovery (Next)
- [ ] Express.js API backend endpoints for server discovery and health checks
- [ ] Parser for `server.properties` and RCON authentication handlers
- [ ] Live WebSocket streaming for telemetry metrics

### Sprint 3: Server Execution & Storage Engine
- [ ] Power engine triggers (`start`, `stop`, `restart`) for background server processes
- [ ] Interactive live RCON console stream viewer with command history
- [ ] World browser, `.mcworld` / ZIP importer, and 1-click snapshot backups

### Sprint 4: Crossplay & Ecosystem Marketplace
- [ ] Built-in Geyser & Floodgate Bedrock crossplay bridge installer
- [ ] Spigot & Modrinth 1-click plugin store with dependency auto-resolution
- [ ] Minecraft server engine version manager (Paper, Fabric, Purpur, Vanilla, Bedrock)

### Sprint 5: Gemini AI Copilot Agent (MVP)
- [ ] Natural language RCON command synthesis powered by Gemini 3.6 Flash
- [ ] Automated server crash log analyzer and lag troubleshooter
- [ ] Conversational configuration modifier for `server.properties` and plugin files
