# 📘 JB³ GameHub Product Requirements Document (PRD)

**Version:** 1.0 Alpha  
**Status:** Living Document  
**Author:** Jonathan Blackburn (JB³Ai)  
**Last Updated:** August 2026  

---

## Table of Contents
1. Executive Summary
2. Vision
3. Mission
4. Problem Statement
5. Target Users
6. User Personas
7. User Journeys
8. Core Features
9. Product Modules
10. Dashboard
11. Server Manager
12. World Manager
13. Plugin Manager
14. Player Management
15. AI Assistant
16. Marketplace
17. Parent Portal
18. Education Portal
19. Cloud Sync
20. Security
21. Notifications
22. Settings
23. Mobile App
24. API
25. Database
26. Permissions
27. Future Roadmap
28. UI Design System
29. Technical Architecture
30. Development Roadmap

---

## 1. Executive Summary
JB³ GameHub is an open-source platform that makes creating, managing and sharing Minecraft servers as easy as installing a mobile app.

The product removes technical barriers for families, educators, creators and communities while still providing the power that experienced administrators expect.

---

## 2. Vision
To make Minecraft multiplayer accessible to everyone in the world, on any device, with zero technical friction.

---

## 3. Mission
One Click. One Dashboard. Every Device.

---

## 4. Problem Statement
Hosting a Minecraft server currently requires port forwarding, editing complex `.properties` files, downloading JAR files, configuring Java runtimes, resolving plugin conflicts, and managing terminal commands. This prevents 90%+ of players, parents, and educators from enjoying private multiplayer worlds.

---

## 5. Target Users
- **Families**: Parents seeking safe, private multiplayer spaces for their children and friends.
- **Educators & Schools**: Teachers using Minecraft for STEM, coding lessons, and homework integration.
- **Content Creators**: Streamers and YouTubers hosting subscriber worlds, events, and series.
- **Communities & Guilds**: Small-to-medium gaming communities needing high uptime and crossplay.
- **Beginners & Admins**: Anyone wanting server management without terminal headaches.

---

## 6. User Personas
- **Parent Sarah (Non-Technical)**: Wants a 1-click private server for her kids with screen time rules and zero griefing.
- **Teacher Mark (Educator)**: Requires classroom worlds with attendance, student whitelists, and quiz rewards.
- **Streamer Alex (Creator)**: Needs sub-only server access, instant world reset backups, and Twitch integration.
- **SysAdmin Dave (Advanced User)**: Demands raw RCON console access, TPS graphs, and custom JAR execution.

---

## 7. User Journeys
1. **First-Time Family Setup**: Install GameHub -> Click "Deploy Family SMP" -> Select Paper + Geyser Crossplay -> Copy Join Code -> Play on Switch, iPad, & PC.
2. **AI-Assisted Plugin Installation**: Ask JB Copilot "Install CoreProtect and limit view distance to 10" -> JB updates config & installs plugin automatically.
3. **Emergency World Restore**: Player accidentally blows up spawn -> Parent opens World Manager -> Clicks "Restore 2:00 PM Snapshot" -> Server rolls back instantly.

---

## 8. Core Features
- 1-Click Engine Deployments (Paper, Fabric, Purpur, Vanilla, Bedrock, Geyser)
- Gemini 3.6 Flash AI Copilot Engine
- Unified "Projects" Workspace Mental Model
- Real-Time RCON Console & Telemetry Graphs
- Instant Snapshot Backups & Rollbacks
- Geyser & Floodgate Bedrock Crossplay Bridge

---

## 9. Product Modules
1. Dashboard
2. Server Manager
3. World Manager
4. Plugin Store
5. Player Management
6. AI Assistant
7. Marketplace
8. Parent Portal
9. Education Portal
10. Monitoring & Telemetry

---

## 10. Dashboard
High-density Bento Grid layout displaying:
- Live Server Status (Online/Offline/Updating)
- Real-Time Metrics (TPS, CPU %, RAM GB, Player Count)
- Multi-Server Quick Switcher
- Live Streaming RCON Console Output
- AI Assistant Quick Command Prompt

---

## 11. Server Manager
- Deploy, Clone, Stop, Start, Restart, and Delete server instances.
- Visual editor for `server.properties` (MOTD, PVP, Difficulty, Max Players, Spawn Protection).
- Switch engine platforms with automatic jar dependency downloads.

---

## 12. World Manager
- Support unlimited worlds per project workspace.
- Import `.mcworld`, `.zip`, and schematic files.
- 1-click snapshot creation, duplication, export, and scheduled cloud backups.

---

## 13. Plugin Manager
- Integrated Spigot, Paper, and Modrinth plugin store.
- 1-click installation for EssentialsX, LuckPerms, WorldEdit, CoreProtect, and Geyser.
- Automatic dependency resolution and version compatibility checks.

---

## 14. Player Management
- Active player list with skin avatars, ping indicator, and current dimension.
- Operator (OP) privilege toggles, kick, ban, and spawn teleport controls.
- Whitelist and ban-list visual managers.

---

## 15. AI Assistant
- Natural language RCON execution powered by Gemini 3.6 Flash.
- Automated crash log analysis and lag troubleshooting.
- Natural language configuration modifications.

---

## 16. Marketplace
- Community-contributed world maps (Parkour, Skyblock, Survival Games, Cities).
- Curated plugin bundles for specific playstyles (RPG, Creative, Hardcore).

---

## 17. Parent Portal
- Playtime scheduling and daily screen time limits.
- Remote approval for player whitelist additions.
- Homework / Chore completion reward triggers in-game.

---

## 18. Education Portal
- Classroom assignment worlds and STEM challenges.
- Automated quiz reward triggers and student attendance logging.
- Future integration with Isikolo education platform.

---

## 19. Cloud Sync
- Scheduled offsite backups to Google Drive, Dropbox, and OneDrive.
- Cloudflare Tunnel integration for 1-click public domain creation without port forwarding.

---

## 20. Security
- Encrypted RCON credential storage.
- AI command execution guardrails.
- Zero open external ports by default when using Cloudflare Tunnels.

---

## 21. Notifications
- Real-time web pushes and Discord Webhook alerts for server restarts, crashes, and player joins.

---

## 22. Settings
- Dark / Light theme selection.
- API Key management for Gemini AI, Discord, and Cloudflare.
- System update channel settings (Stable, Beta, LTS).

---

## 23. Mobile App
- Companion app for iOS and Android for remote server power toggle, player moderation, and AI voice prompt administration.

---

## 24. API
- RESTful HTTP API for server lifecycle, RCON command dispatch, and AI prompt processing.

---

## 25. Database
- Lightweight local state or cloud database options (Firestore, SQLite, PostgreSQL).

---

## 26. Permissions
- Role-Based Access Control (Owner, Admin, Moderator, Parent, Student, Player).

---

## 27. Future Roadmap
- Phase 1: MVP Dashboard & AI Copilot (Completed)
- Phase 2: Parent Portal & Discord Integration
- Phase 3: Education Portal & Multi-Node Cluster Support

---

## 28. UI Design System
- Dark Slate Canvas (`#09090b`), Surface Cards (`#18181b`), Accent Emerald (`#10b981`).
- Mathematical spacing, high contrast, clean typography (Plus Jakarta Sans + Monospace).

---

## 29. Technical Architecture
- Modular Monorepo: React 18, Express.js, TypeScript, Tailwind CSS, Gemini 3.6 Flash SDK.

---

## 30. Development Roadmap
- Sprint 0: Foundation & Specifications (Current)
- Sprint 1: Agentic AI RCON Actions & Automation
- Sprint 2: Cloud Sync & Mobile Companion App
