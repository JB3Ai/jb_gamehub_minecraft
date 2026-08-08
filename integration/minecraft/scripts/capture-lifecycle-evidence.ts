import fs from "fs/promises";
import path from "path";
import { once } from "events";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import type http from "http";
import { startServer } from "../../../server";
import { bootstrapCore } from "../../../packages/core/index";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const INTEGRATION_ROOT = path.join(WORKSPACE_ROOT, "integration", "minecraft");
const SERVER_DIR = path.resolve(process.env.MINECRAFT_SERVER_DIR || path.join(INTEGRATION_ROOT, "server"));
const EVIDENCE_DIR = path.join(INTEGRATION_ROOT, "evidence");
const SERVER_MARKER = path.join(SERVER_DIR, ".jbgamehub-managed");
const API_PORT = Number(process.env.MINECRAFT_TEST_API_PORT || "3330");
const HOST = process.env.MINECRAFT_HOST || "127.0.0.1";
const JAVA_PORT = Number(process.env.MINECRAFT_JAVA_PORT || "25565");
const BEDROCK_PORT = Number(process.env.MINECRAFT_BEDROCK_PORT || "19132");

type EventRecord = Record<string, unknown>;

interface EvidenceReport {
  generatedAt: string;
  apiBaseUrl: string;
  websocketUrl: string;
  serverDir: string;
  providerId: string;
  serverId: string;
  paperDetected: boolean;
  geyserDetected: boolean;
  capabilities: Record<string, boolean>;
  worlds: Array<{ id: string; name: string }>;
  validation: {
    valid: boolean;
    missingPacks: number;
    invalidPacks: number;
    errors: number;
  };
  startOperationId: string;
  stopOperationId: string;
  timeline: EventRecord[];
  statusChecks: {
    beforeStart: string;
    afterStart: string;
    afterStop: string;
  };
}

async function assertManagedServerDir(): Promise<void> {
  if (!SERVER_DIR.startsWith(INTEGRATION_ROOT)) {
    throw new Error(`Refusing to run lifecycle evidence outside integration root: ${SERVER_DIR}`);
  }

  try {
    await fs.access(SERVER_MARKER);
  } catch {
    throw new Error(`Integration marker missing at ${SERVER_MARKER}. Run minecraft:test:setup first.`);
  }
}

async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function createEventCollector(socket: WebSocket) {
  const events: EventRecord[] = [];
  socket.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString()) as EventRecord;
      events.push(parsed);
    } catch {
      // Ignore malformed payloads
    }
  });

  return {
    events,
    async waitFor(predicate: (event: EventRecord) => boolean, label: string, timeoutMs = 30000): Promise<EventRecord> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = events.find(predicate);
        if (found) {
          return found;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out waiting for event: ${label}`);
    },
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  return (await response.json()) as T;
}

async function waitForServerStatus(apiBaseUrl: string, serverId: string, target: string, maxChecks = 40): Promise<string> {
  for (let i = 0; i < maxChecks; i += 1) {
    const status = await fetchJson<{ status: string }>(`${apiBaseUrl}/api/servers/${serverId}/status`);
    if (status.status === target) {
      return status.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const latest = await fetchJson<{ status: string }>(`${apiBaseUrl}/api/servers/${serverId}/status`);
  return latest.status;
}

async function ensureOfflineBaseline(apiBaseUrl: string, serverId: string): Promise<void> {
  const status = await fetchJson<{ status: string }>(`${apiBaseUrl}/api/servers/${serverId}/status`);
  if (status.status === "offline") {
    return;
  }

  await fetchJson<{ operationId: string }>(`${apiBaseUrl}/api/servers/${serverId}/stop`, { method: "POST" });
  const finalStatus = await waitForServerStatus(apiBaseUrl, serverId, "offline");
  if (finalStatus !== "offline") {
    throw new Error(`Failed to establish offline baseline. Current status: ${finalStatus}`);
  }
}

function operationEventPredicate(type: string, operationId: string) {
  return (event: EventRecord) => event.type === type && event.operationId === operationId;
}

async function writeEvidence(report: EvidenceReport): Promise<{ jsonPath: string; mdPath: string }> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(EVIDENCE_DIR, `JBGH-012-lifecycle-${stamp}.json`);
  const mdPath = path.join(EVIDENCE_DIR, `JBGH-012-lifecycle-${stamp}.md`);

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const markdown = [
    "# JBGH-012 Lifecycle Evidence",
    "",
    `Generated at: ${report.generatedAt}`,
    `Server directory: ${report.serverDir}`,
    "",
    "## Sequence Summary",
    "",
    `- Provider: ${report.providerId}`,
    `- Server: ${report.serverId}`,
    `- Paper detected: ${report.paperDetected ? "yes" : "no"}`,
    `- Geyser detected: ${report.geyserDetected ? "yes" : "no"}`,
    `- Start operation: ${report.startOperationId}`,
    `- Stop operation: ${report.stopOperationId}`,
    "",
    "## Status Checks",
    "",
    `- Before start: ${report.statusChecks.beforeStart}`,
    `- After start: ${report.statusChecks.afterStart}`,
    `- After stop: ${report.statusChecks.afterStop}`,
    "",
    "## World Validation",
    "",
    `- Worlds discovered: ${report.worlds.map((world) => world.name).join(", ")}`,
    `- Validation valid: ${report.validation.valid}`,
    `- Missing packs: ${report.validation.missingPacks}`,
    `- Invalid packs: ${report.validation.invalidPacks}`,
    `- Errors: ${report.validation.errors}`,
    "",
    "## Event Timeline",
    "",
    "```json",
    JSON.stringify(report.timeline, null, 2),
    "```",
    "",
  ].join("\n");

  await fs.writeFile(mdPath, markdown, "utf8");
  return { jsonPath, mdPath };
}

async function main(): Promise<void> {
  process.env.NODE_ENV = "production";
  await assertManagedServerDir();

  const core = await bootstrapCore({
    minecraftServerDir: SERVER_DIR,
    minecraftHost: HOST,
    minecraftJavaPort: JAVA_PORT,
    minecraftBedrockPort: BEDROCK_PORT,
    minecraftStartCommand: "npx tsx ../scripts/manage.ts start",
    minecraftStopCommand: "npx tsx ../scripts/manage.ts stop",
  });

  const provider = core.getProvider("minecraft");
  const diagnostics = await provider.getDiagnostics();

  const httpServer = await startServer(API_PORT, {
    minecraftServerDir: SERVER_DIR,
    minecraftHost: HOST,
    minecraftJavaPort: JAVA_PORT,
    minecraftBedrockPort: BEDROCK_PORT,
    minecraftStartCommand: "npx tsx ../scripts/manage.ts start",
    minecraftStopCommand: "npx tsx ../scripts/manage.ts stop",
  });

  const apiBaseUrl = `http://127.0.0.1:${API_PORT}`;
  const websocketUrl = `ws://127.0.0.1:${API_PORT}/ws`;
  const socket = new WebSocket(websocketUrl);
  const collector = createEventCollector(socket);

  try {
    await once(socket, "open");

    const providers = await fetchJson<{ providers: Array<{ id: string }> }>(`${apiBaseUrl}/api/providers`);
    const providerId = providers.providers[0]?.id;
    if (!providerId) {
      throw new Error("No provider returned by /api/providers");
    }

    const providerInfo = await fetchJson<{ capabilities: Record<string, boolean> }>(`${apiBaseUrl}/api/providers/${providerId}`);

    const servers = await fetchJson<{ servers: Array<{ id: string }> }>(`${apiBaseUrl}/api/servers`);
    const serverId = servers.servers[0]?.id;
    if (!serverId) {
      throw new Error("No server returned by /api/servers");
    }

    await ensureOfflineBaseline(apiBaseUrl, serverId);

    const statusBefore = await fetchJson<{ status: string }>(`${apiBaseUrl}/api/servers/${serverId}/status`);

    const startResult = await fetchJson<{ operationId: string }>(`${apiBaseUrl}/api/servers/${serverId}/start`, { method: "POST" });
    const startOperationId = startResult.operationId;

    await collector.waitFor(operationEventPredicate("operation.created", startOperationId), "operation.created/start");
    await collector.waitFor(operationEventPredicate("operation.started", startOperationId), "operation.started/start");
    await collector.waitFor(operationEventPredicate("operation.completed", startOperationId), "operation.completed/start");

    const afterStart = await waitForServerStatus(apiBaseUrl, serverId, "online");
    await collector.waitFor(
      (event) => event.type === "server.status.changed" && event.serverId === serverId && event.status === "online",
      "server.status.changed online",
    );

    const worlds = await fetchJson<{ worlds: Array<{ id: string; name: string }> }>(`${apiBaseUrl}/api/servers/${serverId}/worlds`);
    if (worlds.worlds.length === 0) {
      throw new Error("Expected at least one world in integration environment");
    }

    const validation = await fetchJson<{
      valid: boolean;
      missingPacks: unknown[];
      invalidPacks: unknown[];
      errors: unknown[];
    }>(`${apiBaseUrl}/api/servers/${serverId}/worlds/${worlds.worlds[0].id}/validate`, { method: "POST" });

    const stopResult = await fetchJson<{ operationId: string }>(`${apiBaseUrl}/api/servers/${serverId}/stop`, { method: "POST" });
    const stopOperationId = stopResult.operationId;

    await collector.waitFor(operationEventPredicate("operation.created", stopOperationId), "operation.created/stop");
    await collector.waitFor(operationEventPredicate("operation.started", stopOperationId), "operation.started/stop");

    const afterStop = await waitForServerStatus(apiBaseUrl, serverId, "offline");
    await collector.waitFor(
      (event) => event.type === "server.status.changed" && event.serverId === serverId && event.status === "offline",
      "server.status.changed offline",
    );
    await collector.waitFor(operationEventPredicate("operation.completed", stopOperationId), "operation.completed/stop");

    const timeline = collector.events.filter((event) => {
      const type = String(event.type || "");
      return type.startsWith("operation.") || type === "server.status.changed" || type === "world.validation.completed";
    });

    const report: EvidenceReport = {
      generatedAt: new Date().toISOString(),
      apiBaseUrl,
      websocketUrl,
      serverDir: SERVER_DIR,
      providerId,
      serverId,
      paperDetected: diagnostics.paperDetected,
      geyserDetected: diagnostics.geyserDetected,
      capabilities: providerInfo.capabilities,
      worlds: worlds.worlds,
      validation: {
        valid: validation.valid,
        missingPacks: validation.missingPacks.length,
        invalidPacks: validation.invalidPacks.length,
        errors: validation.errors.length,
      },
      startOperationId,
      stopOperationId,
      timeline,
      statusChecks: {
        beforeStart: statusBefore.status,
        afterStart,
        afterStop,
      },
    };

    const outputs = await writeEvidence(report);
    console.log(`Lifecycle evidence JSON: ${outputs.jsonPath}`);
    console.log(`Lifecycle evidence Markdown: ${outputs.mdPath}`);
  } finally {
    socket.close();
    await closeHttpServer(httpServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
