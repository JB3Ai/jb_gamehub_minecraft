# ROADMAP.md - JB³ GameHub Feature Roadmap

## Validated Vertical Slices

- [x] JBGH-011A: Local Paper + Geyser Integration Environment
- [x] JBGH-012: Provider Lifecycle Hardening + Real Event Evidence
- [x] JBGH-012A: Lifecycle Evidence Assertion
- [x] JBGH-013: Minimal Operational Dashboard
- [x] JBGH-014: Multi-Server / Provider Registry
- [x] JBGH-015: Persistent Operations, Events, and Audit Trail
- [x] JBGH-016: Provider-Neutral Analytics and Operational Intelligence
- [x] JBGH-017: AI Studio Read-Only Intelligence Layer
- [x] JBGH-018: Family Management and Parental Controls
- [x] JBGH-019: Provider-Neutral Rewards and Education Hooks
- [x] JBGH-020C: Content Library UI + Import Preview / Approval
- [x] JBGH-020D: Bedrock Worlds & Pack Linking (content pipeline closed; native runtime remains provider-scoped)
- [ ] JBGH-021: Native Bedrock Server Provider (BDS adapter implemented; live native-client acceptance pending)
- [x] JBGH-021A — CLOSED / PASS: Native BDS Live Acceptance

### JBGH-021A — CLOSED / PASS

Native Bedrock Dedicated Server live acceptance completed successfully
on 2026-10-01.

Validated:

- native BDS start/stop
- provider discovery
- endpoint/capabilities discovery
- provider-discovered world validation
- world: Bedrock level
- real client join
- Family session start
- client disconnect
- Family session closure
- reconnect usage persistence
- SERVER_ACCESS deny enforcement
- real native BDS kick
- audit/history evidence
- dashboard evidence
- persistence after GameHub restart
- source BDS preservation
- disposable runtime cleanup

All 18 acceptance gates passed.

JBGH-021A is CLOSED.
JBGH-022 may now proceed.

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
- [x] Express.js API backend endpoints for server discovery and health checks
- [ ] Parser for `server.properties` and RCON authentication handlers
- [ ] Live WebSocket streaming for telemetry metrics

### Sprint 3: Server Execution & Storage Engine
- [x] Power engine triggers (`start`, `stop`, `restart`) for background server processes
- [ ] Interactive live RCON console stream viewer with command history
- [ ] World browser, `.mcworld` / ZIP importer, and 1-click snapshot backups
- [x] Provider-neutral endpoint metadata contract and API inventory exposure
- [x] Read-only analytics endpoints over persisted lifecycle history
- [x] Persistence retention overview and explicit cleanup controls

### Sprint 4: Crossplay & Ecosystem Marketplace
- [ ] Built-in Geyser & Floodgate Bedrock crossplay bridge installer
- [ ] Spigot & Modrinth 1-click plugin store with dependency auto-resolution
- [ ] Minecraft server engine version manager (Paper, Fabric, Purpur, Vanilla, Bedrock)

### Sprint 5: Gemini AI Copilot Agent (MVP)
- [ ] Natural language RCON command synthesis powered by Gemini 3.6 Flash
- [ ] Automated server crash log analyzer and lag troubleshooter
- [ ] Conversational configuration modifier for `server.properties` and plugin files
- [x] Provider-neutral AI abstraction (Gemini / OpenAI / offline fallback)
- [x] Bounded, read-only context assembly over providers, operations, events, and analytics
- [x] Read-only AI Studio API and dashboard panel with privacy-safe query audit trail
- [ ] AI Action + Approval Layer (future milestone; no AI-triggered mutations exist yet)
