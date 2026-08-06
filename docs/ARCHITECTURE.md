# ARCHITECTURE.md - System Architecture

## Technology Stack
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons, Recharts, Motion/React
- **Backend API**: Express.js, TypeScript CJS Bundle (via esbuild)
- **AI Infrastructure**: @google/genai SDK with Gemini 3.6 Flash for RCON & config synthesis
- **Protocol Protocols**: Minecraft RCON, Query, Bedrock UDP Proxy

## Application Flow
```
[User Interface (React SPA)] 
          │
          ├── (REST / JSON) ────────► [Express Backend Server]
          │                                  │
          │                                  ├──► [Gemini 3.6 Flash AI Engine]
          │                                  └──► [RCON / Minecraft Server Process]
```
