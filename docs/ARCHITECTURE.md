# ARCHITECTURE.md - JB³ GameHub System Architecture

## Core System Architecture

```text
Browser
   │
   ▼
React Dashboard
   │
 REST API
   │
   ▼
Node Backend
   │
 ├──────────────┐
 │              │
 ▼              ▼
Paper        Bedrock
 │              │
 ▼              ▼
Geyser       Floodgate
 │
 ▼
Minecraft Clients
(Java + Bedrock)
```

## Technology Stack

- **Frontend Application Layer**: React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons, Recharts, Motion
- **Backend Service Layer**: Node.js, Express.js REST API, TypeScript CJS Bundle
- **AI Agent Intelligence**: @google/genai SDK powered by Gemini 3.6 Flash for RCON synthesis & auto-configuration
- **Networking & Protocols**: Minecraft RCON, Query, UDP Bedrock Proxy, Geyser/Floodgate Crossplay Bridge

---

## Planned Integration Ecosystem (Future Expansion)

### Cloud Backup & Persistence Integrations
- **Google Drive**: Automated scheduled snapshot sync
- **Dropbox**: User world export and offsite backups
- **OneDrive**: Simple family world synchronization

### Community & Moderation Services
- **Discord Bot**: Real-time console logs, whitelist control, and server status alerts
- **AI Agent**: Autonomous crash recovery, lag detection, and player moderation

### Hosting & Infrastructure
- **Cloudflare Tunnels**: Zero-port-forwarding secure public addresses
- **Docker**: Containerized multi-node game daemon runners
- **Plugin Marketplace**: Integrated Spigot, Paper, and Modrinth plugin store
