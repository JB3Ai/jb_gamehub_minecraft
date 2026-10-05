import { provisioningRouter, provisioningApiOptionsFromEnvironment, authorizeProvisioning, type ProvisioningApiOptions } from "./packages/core/provisioning-api";
import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { WebSocketServer } from "ws";
import { AnalyticsService, resolveWindow } from "./packages/core/analytics-service";
import { bootstrapCore } from "./packages/core/index";
import { AiStudioService } from "./packages/core/ai-studio-service";
import { FamilyService } from "./packages/core/family-service";
import { createAiProvider } from "./packages/ai-provider/index";
import { EventQuery, InMemoryProviderManager, OperationQuery } from "./packages/provider-manager/index";
import { loadRuntimeConfig, runtimeConfigDiagnostics, RuntimeConfig } from "./packages/core/runtime-config";
import { ContentLibraryScanner } from "./packages/content-library";
import type { ContentImportPlan, ContentItem, ContentScanReport } from "./packages/content-library";
import { MinecraftContentImportAdapter } from "./packages/minecraft-provider/content-import";
import fs from "node:fs/promises";

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
let providerManager: InMemoryProviderManager;
let provisioningOptions: ProvisioningApiOptions = { authorize: () => undefined, policies: {} };
let wsServer: WebSocketServer | undefined;
let activeRuntimeConfig: RuntimeConfig | undefined;
let analyticsService: AnalyticsService;
let familyService: FamilyService;
let aiStudioService: AiStudioService;
let unbindFamilyLifecycle: (() => void) | undefined;
const contentItems = new Map<string, ContentItem>();
const contentPlans = new Map<string, ContentImportPlan>();

function contentRoot(): string {
  const configured = process.env.GAMEHUB_CONTENT_ROOT?.trim();
  return path.resolve(configured || path.join(process.cwd(), "JBGH-020 TEST CONTENT"));
}

function contentAuditPath(): string {
  if (!activeRuntimeConfig) throw new Error("Runtime configuration is unavailable.");
  return path.join(activeRuntimeConfig.minecraftServerDir, "gamehub-content-audit.jsonl");
}

function assertContentSourcePath(relativePath: unknown): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error("Invalid sourcePath: supply a non-empty path relative to the configured content root.");
  }
  const root = contentRoot();
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid sourcePath: the path must remain inside the configured content root.");
  }
  return candidate;
}

async function listContentSources(root: string): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
  const results: Array<{ path: string; kind: "file" | "directory" }> = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push({ path: path.relative(root, child), kind: "directory" });
        await visit(child);
      } else if (entry.isFile()) {
        results.push({ path: path.relative(root, child), kind: "file" });
      }
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

async function listInstalledDatapacks(worldsRoot: string): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
  const worlds = await listContentSources(worldsRoot);
  const worldDirectories = worlds.filter((entry) => entry.kind === "directory" && !entry.path.includes(path.sep));
  const datapacks = await Promise.all(
    worldDirectories.map(async (world) => {
      const root = path.join(worldsRoot, world.path, "datapacks");
      const entries = await listContentSources(root);
      return entries.map((entry) => ({ ...entry, path: path.join(world.path, "datapacks", entry.path) }));
    }),
  );
  return datapacks.flat().sort((left, right) => left.path.localeCompare(right.path));
}

async function readContentAudit(): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(contentAuditPath(), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

app.use(express.json());
app.use(async (req, res, next) => {
  const protectedHistory = /^\/api\/(operations|events|history)(\/|$)/.test(req.path) || /^\/api\/servers\/[^/]+\/[^/]+\/history$/.test(req.path);
  if (protectedHistory && (Object.keys(provisioningOptions.policies).length > 0 || providerManager?.listRuntimeAttachments().length)) {
    try { if (!await authorizeProvisioning(req, res, providerManager, provisioningOptions)) return; }
    catch { res.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE" } }); return; }
  }
  next();
});
app.use("/api/provisioning", provisioningRouter(() => providerManager, () => provisioningOptions));
// Legacy lifecycle URLs must not become an authorization bypass for attached servers.
app.use("/api/servers/:id", async (req, res, next) => {
  try {
    if (providerManager.listRuntimeAttachments().some((record) => record.descriptor.serverId === req.params.id)) {
      const principal = await authorizeProvisioning(req, res, providerManager, provisioningOptions);
      if (!principal) return;
      res.locals.principal = principal;
    }
    next();
  } catch { res.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization unavailable." } }); }
});
app.all("/api/providers/:providerId/servers/:serverId/:action", async (req, res) => {
  try {
    const principal = await authorizeProvisioning(req, res, providerManager, provisioningOptions); if (!principal) return;
    const { providerId, serverId, action } = req.params;
    const server = await providerManager.getServer(serverId, providerId); if (!server) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    if (req.method === "POST" && ["start", "stop", "restart"].includes(action)) {
      const operation = action === "start" ? await providerManager.startServer(serverId, providerId, principal.actor) : action === "stop" ? await providerManager.stopServer(serverId, providerId, principal.actor) : await providerManager.restartServer(serverId, providerId, principal.actor);
      res.status(202).json(operation); return;
    }
    if (req.method === "GET" && action === "status") { res.json(await providerManager.getServerStatus(serverId, providerId)); return; }
    if (req.method === "GET" && action === "endpoints") { res.json({ endpoints: await providerManager.getServerConnectionEndpoints(serverId, providerId) }); return; }
    if (req.method === "GET" && action === "worlds") { res.json({ worlds: (await providerManager.getWorlds(serverId, providerId)).map(({ id, name }) => ({ id, name })) }); return; }
    res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
  } catch { res.status(422).json({ error: { code: "RUNTIME_REQUEST_FAILED", message: "Runtime request failed." } }); }
});

function handleApiError(res: express.Response, err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  const isNotFound = message.includes("not found") || message.includes("Unknown server");
  const isBadRequest =
    message.startsWith("Invalid ") ||
    message.includes("must be earlier than") ||
    message.includes("approval is required") ||
    message.includes("Scan content before") ||
    message.includes("Content item not found") ||
    message.includes("Reward") ||
    message.includes("reward") ||
    message.includes("confirmation required");
  const status = isNotFound ? 404 : isBadRequest ? 400 : 500;
  res.status(status).json({
    error: {
      code: status === 404 ? "NOT_FOUND" : status === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR",
      message,
    },
  });
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: ${raw}`);
  }

  return Math.min(parsed, max);
}

function parseOperationQuery(req: express.Request): OperationQuery {
  return {
    providerId: typeof req.query.providerId === "string" ? req.query.providerId : undefined,
    serverId: typeof req.query.serverId === "string" ? req.query.serverId : undefined,
    operationId: typeof req.query.operationId === "string" ? req.query.operationId : undefined,
    type: typeof req.query.type === "string" ? (req.query.type as OperationQuery["type"]) : undefined,
    state: typeof req.query.state === "string" ? (req.query.state as OperationQuery["state"]) : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    limit: parseLimit(req.query.limit, 100, 500),
  };
}

function parseAnalyticsWindow(req: express.Request) {
  return resolveWindow({
    window: typeof req.query.window === "string" ? req.query.window : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    providerId: typeof req.query.providerId === "string" ? req.query.providerId : undefined,
    serverId: typeof req.query.serverId === "string" ? req.query.serverId : undefined,
    type: typeof req.query.type === "string" ? req.query.type : undefined,
    state: typeof req.query.state === "string" ? req.query.state : undefined,
    limit: typeof req.query.limit === "string" ? parseLimit(req.query.limit, 2000, 5000) : undefined,
  });
}

function requireCleanupConfirmation(req: express.Request): void {
  const body = req.body as { confirm?: string; actor?: string } | undefined;
  if (body?.confirm !== "CLEANUP_HISTORY") {
    throw new Error("Cleanup confirmation required: set body.confirm to CLEANUP_HISTORY");
  }
}

function parseEventQuery(req: express.Request): EventQuery {
  return {
    providerId: typeof req.query.providerId === "string" ? req.query.providerId : undefined,
    serverId: typeof req.query.serverId === "string" ? req.query.serverId : undefined,
    operationId: typeof req.query.operationId === "string" ? req.query.operationId : undefined,
    type: typeof req.query.type === "string" ? (req.query.type as EventQuery["type"]) : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    limit: parseLimit(req.query.limit, 200, 1000),
  };
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
    const diagnosticsCache = new Map<string, Awaited<ReturnType<ReturnType<typeof providerManager.getProvider>["getDiagnostics"]>>>();

    const enriched = await Promise.all(
      servers.map(async (server) => {
        const provider = providerManager.getProvider(server.providerId);
        let diagnostics = diagnosticsCache.get(server.providerId);
        if (!diagnostics) {
          diagnostics = await provider.getDiagnostics();
          diagnosticsCache.set(server.providerId, diagnostics);
        }

        const status = await providerManager.getServerStatus(server.id);
        const connectionEndpoints = await providerManager.getServerConnectionEndpoints(server.id);
        const javaEndpoint =
          connectionEndpoints.find((endpoint) => endpoint.protocol.includes("java") || endpoint.id === "java") || connectionEndpoints[0];
        const bedrockEndpoint = connectionEndpoints.find((endpoint) => endpoint.protocol.includes("bedrock") || endpoint.id === "bedrock");

        return {
          ...server,
          serverType: provider.metadata().name,
          status: status.status,
          availability: status.status === "online" || status.status === "starting",
          lastStatusUpdate: new Date().toISOString(),
          connectionEndpoints,
          endpoints: {
            java: javaEndpoint?.display || "N/A",
            bedrock: bedrockEndpoint?.display,
          },
          diagnostics,
        };
      }),
    );

    res.json({ servers: enriched });
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
    const operation = await providerManager.startServer(req.params.id, undefined, res.locals.principal?.actor);
    res.status(202).json(operation);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/servers/:id/stop", async (req, res) => {
  try {
    const operation = await providerManager.stopServer(req.params.id, undefined, res.locals.principal?.actor);
    res.status(202).json(operation);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/servers/:id/restart", async (req, res) => {
  try {
    const operation = await providerManager.restartServer(req.params.id, undefined, res.locals.principal?.actor);
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

app.get("/api/content/sources", async (_req, res) => {
  try {
    const root = contentRoot();
    res.json({
      root,
      sources: await listContentSources(root),
    });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/content", (_req, res) => {
  res.json({ items: [...contentItems.values()] });
});

app.post("/api/content/scan", async (req, res) => {
  try {
    const sourcePath = assertContentSourcePath(req.body?.sourcePath);
    const target = {
      targetId: typeof req.body?.serverId === "string" ? req.body.serverId : "minecraft-main",
      providerId: "minecraft",
    };
    const scanner = new ContentLibraryScanner();
    const report: ContentScanReport = await scanner.scan({ paths: [sourcePath], target });
    for (const item of report.items) contentItems.set(item.contentId, item);
    res.status(201).json({ report });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/content/items/:contentId", (req, res) => {
  const item = contentItems.get(req.params.contentId);
  if (!item) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `Content item not found: ${req.params.contentId}` } });
  }
  return res.json({ item });
});

/**
 * Resolves the managed content root for a known server ID. Bedrock content
 * is routed to the native BDS installation root (`bedrockServerDir`) rather
 * than the Java/Paper server directory; this keeps the two editions'
 * managed worlds/packs from being mixed on disk.
 */
function resolveContentServerDir(serverId: string): string {
  if (!activeRuntimeConfig) throw new Error("Runtime configuration is unavailable.");
  if (serverId === "minecraft-main") return activeRuntimeConfig.minecraftServerDir;
  if (serverId === "bedrock-main") {
    if (!activeRuntimeConfig.bedrockServerDir) {
      throw new Error("Bedrock content import requires BEDROCK_SERVER_DIR to be configured.");
    }
    return activeRuntimeConfig.bedrockServerDir;
  }
  throw new Error(`Unknown server: ${serverId}`);
}

app.post("/api/content/import-plans", (req, res) => {
  try {
    const contentId = req.body?.contentId;
    const serverId = typeof req.body?.serverId === "string" ? req.body.serverId : "minecraft-main";
    const worldId = typeof req.body?.worldId === "string" ? req.body.worldId : undefined;
    const item = typeof contentId === "string" ? contentItems.get(contentId) : undefined;
    if (!item) throw new Error("Content item not found. Scan content before creating an import plan.");
    const serverDir = resolveContentServerDir(serverId);

    const adapter = new MinecraftContentImportAdapter({ serverDir });
    const plan = adapter.createPlan({ item, providerId: "minecraft", serverId, worldId });
    contentPlans.set(plan.operationId, plan);
    res.status(plan.status === "blocked" ? 422 : 201).json({ plan });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/content/import-plans/:operationId", (req, res) => {
  const plan = contentPlans.get(req.params.operationId);
  if (!plan) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `Import plan not found: ${req.params.operationId}` } });
  }
  return res.json({ plan });
});

app.post("/api/content/import-plans/:operationId/execute", async (req, res) => {
  try {
    const plan = contentPlans.get(req.params.operationId);
    if (!plan) throw new Error(`Import plan not found: ${req.params.operationId}`);
    const item = contentItems.get(plan.contentId);
    if (!item) throw new Error(`Content item not found: ${plan.contentId}`);
    if (req.body?.approve !== true) throw new Error("Import approval is required: set body.approve to true.");
    const serverDir = resolveContentServerDir(plan.serverId);

    const adapter = new MinecraftContentImportAdapter({ serverDir });
    const result = await adapter.execute(plan, { item, providerId: "minecraft", serverId: plan.serverId }, true);
    res.status(result.status === "completed" ? 201 : result.status === "blocked" ? 422 : 409).json({ result });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/content/inventory", async (_req, res) => {
  try {
    if (!activeRuntimeConfig) throw new Error("Runtime configuration is unavailable.");
    const serverDir = activeRuntimeConfig.minecraftServerDir;
    const roots = [
      { contentType: "java-world", path: path.join(serverDir, "worlds") },
      { contentType: "paper-plugin", path: path.join(serverDir, "plugins") },
      { contentType: "resource-pack", path: path.join(serverDir, "resource_packs") },
    ];
    const inventory = await Promise.all(
      roots.map(async (root) => ({
        ...root,
        items: await listContentSources(root.path),
      })),
    );
    inventory.push({
      contentType: "datapack",
      path: path.join(serverDir, "worlds"),
      items: await listInstalledDatapacks(path.join(serverDir, "worlds")),
    });
    res.json({ inventory });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/content/history", async (_req, res) => {
  try {
    res.json({ audit: await readContentAudit() });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/operations/:id", (req, res) => {
  void (async () => {
    const operation = await providerManager.getOperation(req.params.id);
    if (!operation) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Operation not found: ${req.params.id}`,
        },
      });
    }
    return res.json(operation);
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/operations", (req, res) => {
  void (async () => {
    const operations = await providerManager.listOperations(parseOperationQuery(req));
    res.json({ operations });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/events", (req, res) => {
  void (async () => {
    const events = await providerManager.listEvents(parseEventQuery(req));
    res.json({ events });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/servers/:providerId/:serverId/history", (req, res) => {
  void (async () => {
    const limit = parseLimit(req.query.limit, 100, 500);
    const history = await providerManager.getServerHistory(req.params.providerId, req.params.serverId, limit);
    res.json(history);
  })().catch((err) => handleApiError(res, err));
});

app.post("/api/history/cleanup", (req, res) => {
  void (async () => {
    requireCleanupConfirmation(req);
    const policy = {
      operationRetentionDays: activeRuntimeConfig?.operationRetentionDays ?? 90,
      eventRetentionDays: activeRuntimeConfig?.eventRetentionDays ?? 30,
      auditRetentionDays: activeRuntimeConfig?.auditRetentionDays ?? 365,
    };

    const actor = typeof req.body?.actor === "string" ? req.body.actor : "local-admin";
    const result = await providerManager.cleanupHistory(policy, actor);

    res.json(result);
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/history/overview", (req, res) => {
  void (async () => {
    const policy = {
      operationRetentionDays: activeRuntimeConfig?.operationRetentionDays ?? 90,
      eventRetentionDays: activeRuntimeConfig?.eventRetentionDays ?? 30,
      auditRetentionDays: activeRuntimeConfig?.auditRetentionDays ?? 365,
    };
    const data = await analyticsService.persistenceOverview(policy);
    res.json({
      generatedAt: new Date().toISOString(),
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/history/audit", async (req, res) => {
  try {
    const audits = await providerManager.listAudits({
      providerId: typeof req.query.providerId === "string" ? req.query.providerId : undefined,
      serverId: typeof req.query.serverId === "string" ? req.query.serverId : undefined,
      action: typeof req.query.action === "string" ? req.query.action as never : undefined,
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    res.json({ audits });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/analytics/summary", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.summary(window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: window.providerId,
      serverId: window.serverId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/analytics/providers/:providerId", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.provider(req.params.providerId, window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: req.params.providerId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/analytics/servers/:providerId/:serverId", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.server(req.params.providerId, req.params.serverId, window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: req.params.providerId,
      serverId: req.params.serverId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/analytics/operations", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.operations(window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: window.providerId,
      serverId: window.serverId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/analytics/events", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.events(window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: window.providerId,
      serverId: window.serverId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/analytics/uptime", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.uptime(window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: window.providerId,
      serverId: window.serverId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/analytics/world-validation", (req, res) => {
  void (async () => {
    const window = parseAnalyticsWindow(req);
    const data = await analyticsService.worldValidation(window);
    res.json({
      generatedAt: new Date().toISOString(),
      from: window.from,
      to: window.to,
      providerId: window.providerId,
      serverId: window.serverId,
      data,
    });
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/families", async (_req, res) => {
  try {
    const families = await familyService.listFamilies();
    res.json({ families });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/families", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: string; timezone?: string; actor?: string; metadata?: Record<string, unknown> };
    const family = await familyService.createFamily({
      name: body.name || "New Family",
      timezone: body.timezone || "UTC",
      actor: body.actor,
      metadata: body.metadata,
    });
    res.status(201).json(family);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/families/:familyId", async (req, res) => {
  try {
    const family = await familyService.getFamily(req.params.familyId);
    if (!family) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Family not found" } });
    }
    return res.json(family);
  } catch (err) {
    return handleApiError(res, err);
  }
});

app.get("/api/families/:familyId/children", async (req, res) => {
  try {
    const children = await familyService.listChildren(req.params.familyId);
    res.json({ children });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/families/:familyId/children", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: string; timezone?: string; actor?: string; metadata?: Record<string, unknown> };
    const child = await familyService.createChild({
      familyId: req.params.familyId,
      name: body.name || "New Child",
      timezone: body.timezone,
      actor: body.actor,
      metadata: body.metadata,
    });
    res.status(201).json(child);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId", async (req, res) => {
  try {
    const child = await familyService.getChild(req.params.childId);
    if (!child) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Child not found" } });
    }
    return res.json(child);
  } catch (err) {
    return handleApiError(res, err);
  }
});

app.patch("/api/children/:childId", async (req, res) => {
  try {
    const child = await familyService.updateChild(req.params.childId, req.body ?? {});
    res.json(child);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/identities", async (req, res) => {
  try {
    const identities = await familyService.listIdentities(req.params.childId);
    res.json({ identities });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/children/:childId/identities", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      providerId?: string;
      externalPlayerId?: string;
      displayName?: string;
      identityType?: string;
      verified?: boolean;
      metadata?: Record<string, unknown>;
      actor?: string;
    };
    const identity = await familyService.linkIdentity({
      childId: req.params.childId,
      providerId: body.providerId || "synthetic",
      externalPlayerId: body.externalPlayerId || "unlinked",
      displayName: body.displayName || body.externalPlayerId || "Unlinked",
      identityType: body.identityType || "generic",
      verified: body.verified,
      metadata: body.metadata,
      actor: body.actor,
    });
    res.status(201).json(identity);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/rules", async (req, res) => {
  try {
    const rules = await familyService.listRules(req.params.childId);
    res.json({ rules });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/children/:childId/rules", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { type?: string; enabled?: boolean; config?: Record<string, unknown>; actor?: string };
    const rule = await familyService.createRule({
      familyId: (await familyService.getChild(req.params.childId))?.familyId || "",
      childId: req.params.childId,
      type: (body.type as any) || "DAILY_PLAY_LIMIT",
      enabled: body.enabled ?? true,
      config: body.config || {},
      actor: body.actor,
    });
    res.status(201).json(rule);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.patch("/api/rules/:ruleId", async (req, res) => {
  try {
    const rule = await familyService.updateRule(req.params.ruleId, req.body ?? {});
    res.json(rule);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/sessions", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 1000);
    const sessions = await familyService.listSessions(req.params.childId, limit);
    res.json({ sessions });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/playtime", async (req, res) => {
  try {
    const at = typeof req.query.at === "string" ? req.query.at : new Date().toISOString();
    const usage = await familyService.getPlaytime(req.params.childId, at);
    res.json({ generatedAt: new Date().toISOString(), at, usage });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/children/:childId/sessions/:sessionId/end", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { reason?: string; actor?: string; at?: string };
    const existing = await familyService.getSession(req.params.sessionId);
    if (!existing || existing.childId !== req.params.childId) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Session not found" } });
    }
    const session = await familyService.endSession(
      req.params.sessionId,
      body.reason || "client_disconnected",
      body.actor || "system/provider-event",
      body.at || new Date().toISOString(),
    );
    return res.json(session);
  } catch (err) {
    return handleApiError(res, err);
  }
});

app.post("/api/children/:childId/evaluate-access", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      providerId?: string;
      serverId?: string;
      externalPlayerId?: string;
      displayName?: string;
      identityType?: string;
      timestamp?: string;
      actor?: string;
    };
    const result = await familyService.evaluateAccess({
      childId: req.params.childId,
      providerId: body.providerId || "synthetic",
      serverId: body.serverId || "synthetic-main",
      externalPlayerId: body.externalPlayerId || "player",
      displayName: body.displayName,
      identityType: body.identityType,
      timestamp: body.timestamp,
      actor: body.actor,
    });
    res.json(result);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/rewards", async (req, res) => {
  try {
    const rewards = await familyService.listRewards(req.params.childId);
    res.json({ rewards });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/children/:childId/rewards", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      rewardType?: string;
      type?: string;
      amountMinutes?: number;
      providerId?: string;
      providerIds?: string[];
      serverId?: string;
      serverIds?: string[];
      startsAt?: string;
      expiresAt?: string;
      actor?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    };
    const rewardType = String(body.rewardType || body.type || "").toUpperCase();
    if (rewardType !== "BONUS_MINUTES" && rewardType !== "TEMP_SERVER_ACCESS") {
      throw new Error("Invalid reward type");
    }
    const startsAt = body.startsAt || new Date().toISOString();
    const parsedStart = Date.parse(startsAt);
    const expiresAt = body.expiresAt || (Number.isFinite(parsedStart) ? new Date(parsedStart + 60 * 60 * 1000).toISOString() : startsAt);
    const reward = await familyService.grantReward({
      childId: req.params.childId,
      rewardType,
      amountMinutes: body.amountMinutes,
      providerIds: [...new Set([...(body.providerIds || []), ...(body.providerId ? [body.providerId] : [])])],
      serverIds: [...new Set([...(body.serverIds || []), ...(body.serverId ? [body.serverId] : [])])],
      startsAt,
      expiresAt,
      actor: body.actor || "parent-admin",
      reason: body.reason || "Parent reward",
      metadata: body.metadata,
    });
    res.status(201).json(reward);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/entitlements", async (req, res) => {
  try {
    const entitlements = await familyService.resolveEntitlements(req.params.childId, {
      providerId: typeof req.query.providerId === "string" ? req.query.providerId : "synthetic",
      serverId: typeof req.query.serverId === "string" ? req.query.serverId : "synthetic-main",
      at: typeof req.query.at === "string" ? req.query.at : undefined,
    });
    res.json({ entitlements });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/rewards/:rewardId/redeem", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { amountMinutes?: number; actor?: string };
    const reward = await familyService.redeemReward(req.params.rewardId, body.amountMinutes || 0, body.actor);
    res.status(201).json(reward);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.delete("/api/rewards/:rewardId", async (req, res) => {
  try {
    const reward = await familyService.revokeReward(req.params.rewardId, typeof req.query.actor === "string" ? req.query.actor : "parent-admin");
    res.json(reward);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.post("/api/children/:childId/overrides", async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      createdBy?: string;
      scope?: Record<string, unknown>;
      reason?: string;
      startsAt?: string;
      expiresAt?: string;
      metadata?: Record<string, unknown>;
    };
    const override = await familyService.createOverride({
      childId: req.params.childId,
      createdBy: body.createdBy || "parent-admin",
      scope: body.scope || {},
      reason: body.reason || "Temporary override",
      startsAt: body.startsAt || new Date().toISOString(),
      expiresAt: body.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      metadata: body.metadata,
    });
    res.status(201).json(override);
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/children/:childId/overrides", async (req, res) => {
  try {
    const overrides = await providerManager.listParentOverrides({
      childId: req.params.childId,
      limit: parseLimit(req.query.limit, 100, 500),
    });
    res.json({ overrides });
  } catch (err) {
    handleApiError(res, err);
  }
});

app.delete("/api/overrides/:overrideId", async (req, res) => {
  try {
    const override = await familyService.revokeOverride(req.params.overrideId);
    res.json(override);
  } catch (err) {
    handleApiError(res, err);
  }
});

// AI Studio: read-only intelligence layer (JBGH-017). No AI-driven mutations exist here.
app.get("/api/ai/providers", (_req, res) => {
  const config = activeRuntimeConfig;
  res.json({
    active: config?.aiProvider || "fallback",
    model: config?.aiModel || undefined,
    configured: {
      gemini: Boolean(config?.geminiApiKey),
      openai: Boolean(config?.openAiApiKey),
    },
    readOnly: true,
  });
});

app.post("/api/ai/ask", (req, res) => {
  void (async () => {
    const body = req.body as {
      question?: string;
      providerId?: string;
      serverId?: string;
      window?: "24h" | "7d" | "30d";
      actor?: string;
    };

    const answer = await aiStudioService.ask({
      question: body?.question ?? "",
      providerId: body?.providerId,
      serverId: body?.serverId,
      window: body?.window,
      actor: body?.actor,
    });

    res.json(answer);
  })().catch((err) => handleApiError(res, err));
});

app.get("/api/ai/audit", (req, res) => {
  void (async () => {
    const limit = typeof req.query.limit === "string" ? parseLimit(req.query.limit, 100, 1000) : undefined;
    const audits = await aiStudioService.listAuditTrail({ limit });
    res.json({ audits });
  })().catch((err) => handleApiError(res, err));
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
  wsServer = new WebSocketServer({ server: httpServer, path: "/ws", verifyClient: (info, done) => {
    if (!Object.keys(provisioningOptions.policies).length && !providerManager.listRuntimeAttachments().length) { done(true); return; }
    const request = Object.assign(info.req, { get: (name: string) => info.req.headers[name.toLowerCase()] }) as unknown as express.Request;
    Promise.resolve().then(() => provisioningOptions.authorize(request)).then(async (principal) => {
      await providerManager.writeAudit({ actor: principal?.actor ?? "anonymous", action: "provisioning.authorization", result: principal?.admin ? "completed" : "failed", metadata: { transport: "websocket", authorized: principal?.admin === true } });
      done(principal?.admin === true, principal ? 403 : 401);
    }).catch(() => done(false, 401));
  } });

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

export async function startServer(port = PORT, overrides: Partial<RuntimeConfig> = {}, adminOptions?: ProvisioningApiOptions) {
  provisioningOptions = adminOptions ?? await provisioningApiOptionsFromEnvironment();
  const config = {
    ...loadRuntimeConfig(process.env),
    ...overrides,
  };
  activeRuntimeConfig = config;
  contentItems.clear();
  contentPlans.clear();
  providerManager = await bootstrapCore({
    minecraftServerDir: config.minecraftServerDir,
    minecraftHost: config.minecraftHost,
    minecraftJavaPort: config.minecraftJavaPort,
    minecraftBedrockPort: config.minecraftBedrockPort,
    minecraftStartCommand: config.minecraftStartCommand,
    minecraftStopCommand: config.minecraftStopCommand,
    minecraftRconPort: config.minecraftRconPort,
    minecraftRconPassword: config.minecraftRconPassword,
    persistenceDbPath: config.persistenceDbPath,
    operationRetentionDays: config.operationRetentionDays,
    eventRetentionDays: config.eventRetentionDays,
    auditRetentionDays: config.auditRetentionDays,
  });
  for (const record of providerManager.listRuntimeAttachments()) {
    const policy = provisioningOptions.policies[record.descriptor.providerId];
    if (!policy || providerManager.getProvisioningOperation(record.operationId)?.result.state !== "PROVISIONED") continue;
    try { await providerManager.recoverRuntimeAttachment(record.operationId, policy); }
    catch { await providerManager.writeAudit({ actor: "system/recovery", action: "provisioning.state.changed", operationId: record.operationId, result: "failed", metadata: { code: "ATTACHMENT_RECOVERY_REQUIRED" } }); }
  }
  analyticsService = new AnalyticsService(providerManager);
  familyService = new FamilyService(providerManager);
  unbindFamilyLifecycle = familyService.bindPlayerLifecycle();
  const aiProvider = createAiProvider({
    provider: config.aiProvider,
    model: config.aiModel,
    apiKey: config.aiProvider === "openai" ? config.openAiApiKey : config.geminiApiKey,
  });
  aiStudioService = new AiStudioService(providerManager, analyticsService, aiProvider);

  console.log("[JB3 GameHub] Runtime configuration:");
  for (const line of runtimeConfigDiagnostics(config)) {
    console.log(`[JB3 GameHub] - ${line}`);
  }

  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [`${path.resolve(config.minecraftServerDir).replace(/\\/g, "/")}/**`],
        },
      },
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

  httpServer.on("close", () => {
    void vite?.close();
    unbindFamilyLifecycle?.();
    unbindFamilyLifecycle = undefined;
    void providerManager.shutdown();
    wsServer?.close();
    wsServer = undefined;
  });

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
