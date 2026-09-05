# 🎮 JB³ GameHub

> **Make Minecraft Multiplayer Effortless. One Click. One Dashboard. Every Device.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/Build-Passing-emerald.svg)]()
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.4%20Ready-3b82f6.svg)]()
[![AI Powered](https://img.shields.io/badge/AI-Gemini%203.6%20Flash-a855f7.svg)]()

**JB³ GameHub** is an open-source Minecraft management platform designed to make game hosting accessible to everyone, from parents and educators to content creators and experienced server administrators.

---

## 🚀 Key Features

- ⚡ **1-Click Engine Deployments**: Support for Paper, Purpur, Fabric, Vanilla, Bedrock, Geyser Crossplay, and Velocity.
- 🤖 **JB AI Copilot Engine**: Natural language server administration powered by Gemini 3.6 Flash.
- 🏰 **Project Workspaces**: Group worlds, plugins, backups, and player permissions into cohesive Minecraft projects (Family SMP, School Classroom, Creator Series).
- 📊 **Real-Time Telemetry & RCON**: Instant TPS, CPU, RAM graphs and live interactive console output.
- 🌐 **Geyser & Bedrock Crossplay**: Native bridge configuration allowing mobile, console, and PC players to play together seamlessly.
- 🧩 **1-Click Plugin & World Marketplace**: Integrated store for EssentialsX, WorldEdit, LuckPerms, and community maps.
- 🧭 **Provider-Neutral Operations**: Manage Minecraft and synthetic providers through one lifecycle and persistence contract.
- 📈 **Operational Intelligence**: Query provider-scoped uptime, operation, event, validation, and retention analytics.
- 🧠 **AI Studio (Read-Only)**: Ask natural-language questions about GameHub activity; AI Studio can observe and explain but never mutate GameHub.
- 🎁 **Provider-Neutral Rewards**: Parent-audited bonus minutes and temporary server entitlements with deterministic parental-policy safety boundaries.

---

## 🛠️ Repository Architecture

The current implementation is a TypeScript application with a Vite React dashboard, an Express/WebSocket API, and provider/core packages:

```text
jb_gamehub_minecraft/
├── server.ts           # Express REST API and WebSocket event adapter
├── src/                # React dashboard and browser-side state/API clients
├── packages/
│   ├── core/           # SQLite persistence, migrations, and analytics service
│   ├── minecraft-provider/ # Minecraft lifecycle and world provider
│   ├── synthetic-provider/ # Provider abstraction test implementation
│   ├── provider-manager/   # Provider contracts and orchestration
│   ├── minecraft/      # Shared Minecraft package surface
│   ├── ai/             # AI package surface
│   ├── ui/             # Shared UI package surface
│   └── shared/         # Shared package surface
├── tests/              # Provider, API, persistence, WebSocket, and dashboard tests
├── docs/               # Architecture, API, database, product, and feature specs
├── design/             # Design system and interaction specifications
├── docker/             # Container build assets
└── scripts/            # Setup and operational utilities
```

---

## 🏁 Quick Start

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x

### Installation
```bash
# Clone the repository
git clone https://github.com/jb3ai/jb-gamehub.x.git
cd jb_gamehub_minecraft

# Install dependencies
npm install

# Start the API and Vite dashboard in development
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📖 Documentation

- [GAMEHUB_MASTER_SPEC.md](./GAMEHUB_MASTER_SPEC.md) - Master Specification & Vision
- [PRODUCT.md](./docs/PRODUCT.md) - Product Overview & Capabilities
- [ROADMAP.md](./docs/ROADMAP.md) - Feature Roadmap & Release Cycles
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) - System Architecture & Tech Stack
- [DATABASE.md](./docs/DATABASE.md) - Data Schemas & Models
- [API.md](./docs/API.md) - REST API Reference
- [JBGH-016-analytics.md](./docs/JBGH-016-analytics.md) - Provider-Neutral Analytics and History Management
- [JBGH-017-ai-studio.md](./docs/JBGH-017-ai-studio.md) - AI Studio Read-Only Intelligence Layer
- [JBGH-019-rewards-education-hooks.md](./docs/JBGH-019-rewards-education-hooks.md) - Provider-Neutral Rewards and Education Hooks
- [UI.md](./docs/UI.md) - Design System & Component Guidelines
- [IDEAS.md](./IDEAS.md) - Innovation Sandbox & Backlog

---

## 📄 License

JB³ GameHub is open-source software licensed under the [MIT License](LICENSE).
