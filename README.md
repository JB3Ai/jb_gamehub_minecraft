# 🎮 JB³ GameHub

> **Make Minecraft Multiplayer Effortless. One Click. One Dashboard. Every Device.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/Build-Passing-emerald.svg)]()
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.4%20Ready-3b82f6.svg)]()
[![AI Powered](https://img.shields.io/badge/AI-Gemini%203.6%20Flash-a855f7.svg)]()

**JB³ GameHub** is an open-source Minecraft management platform designed to make game hosting accessible to everyone — from parents and educators to content creators and seasoned server administrators.

---

## 🚀 Key Features

- ⚡ **1-Click Engine Deployments**: Support for Paper, Purpur, Fabric, Vanilla, Bedrock, Geyser Crossplay, and Velocity.
- 🤖 **JB AI Copilot Engine**: Natural language server administration powered by Gemini 3.6 Flash.
- 🏰 **Project Workspaces**: Group worlds, plugins, backups, and player permissions into cohesive Minecraft projects (Family SMP, School Classroom, Creator Series).
- 📊 **Real-Time Telemetry & RCON**: Instant TPS, CPU, RAM graphs and live interactive console output.
- 🌐 **Geyser & Bedrock Crossplay**: Native bridge configuration allowing mobile, console, and PC players to play together seamlessly.
- 🧩 **1-Click Plugin & World Marketplace**: Integrated store for EssentialsX, WorldEdit, LuckPerms, and community maps.

---

## 🛠️ Repository Architecture

This repository is organized as a modular monorepo:

```text
jb_gamehub_minecraft/
├── apps/
│   ├── web/            # Primary React + Vite + Tailwind Control Panel
│   ├── api/            # Express.js RCON & AI Copilot Proxy Backend
│   └── desktop/        # Desktop companion & launcher wrapper
├── packages/
│   ├── ui/             # Reusable UI component library (shadcn/ui based)
│   ├── minecraft/      # Minecraft engine, RCON, & server.properties parser
│   ├── ai/             # Gemini AI Copilot agent & command synthesis
│   └── shared/         # Common TypeScript interfaces and data models
├── docs/               # Architecture, API, Database, Product, & Security specs
├── docker/             # Dockerfile & compose manifests
└── scripts/            # Development, deployment, and setup utilities
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

# Start the dev server
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
- [UI.md](./docs/UI.md) - Design System & Component Guidelines
- [IDEAS.md](./IDEAS.md) - Innovation Sandbox & Backlog

---

## 📄 License

JB³ GameHub is open-source software licensed under the [MIT License](LICENSE).
