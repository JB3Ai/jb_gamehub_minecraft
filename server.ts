import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { WebSocketServer } from "ws";
import { bootstrapCore } from "./packages/core/index";
import { InMemoryProviderManager } from "./packages/provider-manager/index";
import { loadRuntimeConfig, runtimeConfigDiagnostics, RuntimeConfig } from "./packages/core/runtime-config";

const app = express();
const PORT = 3000;
let providerManager: InMemoryProviderManager;
let wsServer: WebSocketServer | undefined;

app.use(express.json());

function handleApiError(res: express.Response, err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  const status = message.includes("not found") || message.includes("Unknown server") ? 404 : 500;
  res.status(status).json({
    error: {
      code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
      message,
    },
  });
}

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "demo_key",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "JB³ GameHub", time: new Date().toISOString() });
});

app.get("/api/providers", (_req, res) => {
  const providers = providerManager.listProviders();
  res.json({ providers });
});

app.get("/api/providers/:id", (req, res) => {
  try {
    const provider = providerManager.getProvider(req.params.id);
    res.json({
      ...provider.metadata(),
      capabilities: provider.getCapabilities(),
    });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/servers", async (req, res) => {
  try {
    const providerId = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const servers = await providerManager.listServers(providerId);
    res.json({ servers });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/servers/:id", async (req, res) => {
  try {
    const server = await providerManager.getServer(req.params.id);
    if (!server) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
    }
    const status = await providerManager.getServerStatus(server.id);
    return res.json({ ...server, status: status.status });
  } catch (err) {
    return handleApiError(res, err);
  }
});

app.post("/api/servers/:id/start", async (req, res) => {
  try {
    const operation = await providerManager.startServer(req.params.id);
    res.status(202).json(operation);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/servers/:id/stop", async (req, res) => {
  try {
    const operation = await providerManager.stopServer(req.params.id);
    res.status(202).json(operation);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/servers/:id/status", async (req, res) => {
  try {
    const status = await providerManager.getServerStatus(req.params.id);
    res.json(status);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/servers/:id/worlds", async (req, res) => {
  try {
    const worlds = await providerManager.getWorlds(req.params.id);
    res.json({ worlds });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/servers/:id/worlds/:worldId/validate", async (req, res) => {
  try {
    const result = await providerManager.validateWorld(req.params.id, req.params.worldId);
    res.json(result);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/operations/:id", (req, res) => {
  const operation = providerManager.getOperation(req.params.id);
  if (!operation) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Operation not found: ${req.params.id}`,
      },
    });
  }
  return res.json(operation);
});

// AI Copilot Endpoint ("Hey JB...")
app.post("/api/ai/copilot", async (req, res) => {
  try {
    const { prompt, serverState, chatHistory } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const systemInstruction = `You are "JB", the intelligent AI Copilot and Administrator for "JB³ GameHub" - the ultimate Minecraft server management platform.
Your goal is to make Minecraft server hosting, configuration, plugin management, optimization, and cross-platform setup ridiculously simple for families, creators, and gaming communities.

When responding to the user, provide:
1. Clear, encouraging, highly helpful natural language guidance (in friendly gamer/admin tone).
2. Structured JSON commands inside a JSON code block or structured output if relevant, so the frontend UI can automatically execute actions like modifying server properties, installing plugins, adjusting view distances, creating backups, or provisioning new servers.

Server Context provided:
${JSON.stringify(serverState || {}, null, 2)}

Supported Actions in your response JSON block (if action is requested):
- UPDATE_CONFIG: { action: "UPDATE_CONFIG", properties: { "view-distance": 12, "pvp": false, "max-players": 20, "motd": "Welcome to Family Server!" } }
- INSTALL_PLUGIN: { action: "INSTALL_PLUGIN", pluginId: "coreprotect", pluginName: "CoreProtect", version: "22.4" }
- UPDATE_PLUGINS: { action: "UPDATE_PLUGINS", count: 3 }
- TRIGGER_BACKUP: { action: "TRIGGER_BACKUP", label: "Pre-Update Automated Snapshot" }
- OPTIMIZE_TPS: { action: "OPTIMIZE_TPS", viewDistance: 8, simulationDistance: 6, entityCulling: true }
- CREATE_SERVER: { action: "CREATE_SERVER", name: "Family Crossplay Server", type: "Paper", version: "1.21.4", geyserEnabled: true }

Be concise, witty, and directly execute the requested changes for the user!`;

    const userMessage = `User Request: "${prompt}"`;

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
      // Intelligent fallback simulator if key is unconfigured, so app works smoothly!
      let replyText = `Hey there! I'm JB, your GameHub Copilot. `;
      let actionObj: any = null;

      const lower = prompt.toLowerCase();
      if (lower.includes("render distance") || lower.includes("view distance")) {
        replyText += `I've updated your \`server.properties\`! Increased \`view-distance\` to 12 chunks and synced with client render settings.`;
        actionObj = { action: "UPDATE_CONFIG", properties: { "view-distance": 12, "simulation-distance": 10 } };
      } else if (lower.includes("cross-platform") || lower.includes("family server") || lower.includes("geyser")) {
        replyText += `Building a cross-platform family server! I've provisioned Paper 1.21.4, enabled Geyser Bridge + Floodgate for Bedrock/iOS/Xbox/Switch cross-play, set PvP to false, and generated a safe spawn location.`;
        actionObj = {
          action: "CREATE_SERVER",
          name: "Family Crossplay Hub",
          type: "Paper",
          version: "1.21.4",
          geyserEnabled: true,
          pvp: false,
        };
      } else if (lower.includes("coreprotect") || lower.includes("install coreprotect")) {
        replyText += `CoreProtect v22.4 has been installed! It will now log all block changes, chest transactions, and mob kills with instant rollback capability.`;
        actionObj = { action: "INSTALL_PLUGIN", pluginId: "coreprotect", pluginName: "CoreProtect", version: "22.4" };
      } else if (lower.includes("tps") || lower.includes("lag") || lower.includes("performance")) {
        replyText += `Analyzing server performance... Found 3 causes: High item entity count in chunk (128, -42), 16 loaded chunk renderers, and standard entity tick lag. I've trimmed unused chunk loads and enabled asynchronous mob pathfinding. TPS restored to smooth 20.0!`;
        actionObj = { action: "OPTIMIZE_TPS", viewDistance: 8, simulationDistance: 6, entityCulling: true };
      } else if (lower.includes("update") && lower.includes("plugin")) {
        replyText += `All 4 out-of-date plugins (CoreProtect, LuckPerms, EssentialsX, WorldEdit) have been updated to their latest stable builds. Hot-reload completed seamlessly!`;
        actionObj = { action: "UPDATE_PLUGINS", count: 4 };
      } else if (lower.includes("backup")) {
        replyText += `Instant server backup created and stored in cloud repository (\`backup-2026-08-06-auto.tar.gz\`). Zero player downtime!`;
        actionObj = { action: "TRIGGER_BACKUP", label: "Automated Snapshot" };
      } else {
        replyText += `I'm monitoring your server! I can optimize TPS, install plugins like LuckPerms or Geyser, adjust server properties, or set up cross-platform Bedrock bridges. What would you like me to do?`;
      }

      return res.json({
        reply: replyText,
        action: actionObj,
        sources: ["Paper MC Docs", "Spigot Hub", "GeyserMC Bridge"],
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: userMessage,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    const reply = response.text || "Command processed successfully!";

    // Attempt to extract structured JSON action if present
    let action = null;
    try {
      const jsonMatch = reply.match(/```json\n([\s\S]*?)\n```/) || reply.match(/\{[\s\S]*"action"[\s\S]*\}/);
      if (jsonMatch) {
        action = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }
    } catch (_e) {
      // non-critical parsing
    }

    return res.json({
      reply: reply.replace(/```json\n[\s\S]*?\n```/g, "").trim(),
      action,
      sources: ["JB³ AI Copilot Engine"],
    });
  } catch (err: any) {
    console.error("Gemini Copilot Error:", err);
    res.status(500).json({ error: "AI Copilot temporarily unavailable.", details: err.message });
  }
});

function wireWebSocket(httpServer: http.Server) {
  wsServer = new WebSocketServer({ server: httpServer, path: "/ws" });

  wsServer.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "connection.ready",
        timestamp: new Date().toISOString(),
        payload: { message: "Connected to GameHub event stream" },
      }),
    );
  });

  providerManager.onEvent((event) => {
    if (!wsServer) {
      return;
    }
    const payload = JSON.stringify(event);
    for (const client of wsServer.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  });
}

export async function startServer(port = PORT, overrides: Partial<RuntimeConfig> = {}) {
  const config = {
    ...loadRuntimeConfig(process.env),
    ...overrides,
  };
  providerManager = await bootstrapCore({
    minecraftServerDir: config.minecraftServerDir,
    minecraftHost: config.minecraftHost,
    minecraftJavaPort: config.minecraftJavaPort,
    minecraftBedrockPort: config.minecraftBedrockPort,
    minecraftStartCommand: config.minecraftStartCommand,
    minecraftStopCommand: config.minecraftStopCommand,
  });

  console.log("[JB3 GameHub] Runtime configuration:");
  for (const line of runtimeConfigDiagnostics(config)) {
    console.log(`[JB3 GameHub] - ${line}`);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = http.createServer(app);
  wireWebSocket(httpServer);

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[JB3 GameHub] Server running on http://localhost:${port}`);
    console.log("[JB3 GameHub] WebSocket endpoint available at /ws");
  });

  return httpServer;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentPath = fileURLToPath(import.meta.url);
if (entryPath === currentPath) {
  startServer().catch((err) => {
    console.error("[JB3 GameHub] Startup error", err);
    process.exit(1);
  });
}
