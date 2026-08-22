import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type http from "http";
import { startServer } from "../server";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/minecraft-server");

function testDbPath(name: string): string {
  return path.resolve(process.cwd(), "tests", "tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sqlite`);
}

async function closeServer(server: http.Server): Promise<void> {
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

test("provider and server API contract with operation retrieval", async () => {
  process.env.NODE_ENV = "production";

  const server = await startServer(3310, {
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: testDbPath("api-contract"),
    aiProvider: "fallback",
  });

  try {
    const providersRes = await fetch("http://127.0.0.1:3310/api/providers");
    assert.equal(providersRes.status, 200);
    const providersBody = (await providersRes.json()) as { providers: Array<{ id: string }> };
    assert.ok(providersBody.providers.some((provider) => provider.id === "minecraft"));
    assert.ok(providersBody.providers.some((provider) => provider.id === "synthetic"));

    const serversRes = await fetch("http://127.0.0.1:3310/api/servers");
    assert.equal(serversRes.status, 200);
    const serversBody = (await serversRes.json()) as {
      servers: Array<{
        id: string;
        providerId: string;
        serverType: string;
        status: string;
        availability: boolean;
        lastStatusUpdate: string;
        connectionEndpoints?: Array<{ id: string; protocol: string; transport: string; display: string }>;
        endpoints: { java: string; bedrock?: string };
      }>;
    };
    const serverId = serversBody.servers[0]?.id;
    assert.equal(serverId, "minecraft-main");
    assert.equal(serversBody.servers[0]?.serverType, "Minecraft");
    assert.ok(["online", "offline", "starting", "stopping", "error"].includes(String(serversBody.servers[0]?.status)));
    assert.equal(typeof serversBody.servers[0]?.availability, "boolean");
    assert.equal(typeof serversBody.servers[0]?.lastStatusUpdate, "string");
    assert.equal(typeof serversBody.servers[0]?.endpoints?.java, "string");
    assert.ok(Array.isArray(serversBody.servers[0]?.connectionEndpoints));
    assert.ok((serversBody.servers[0]?.connectionEndpoints?.length || 0) > 0);

    const syntheticServer = serversBody.servers.find((server) => server.id === "synthetic-main");
    assert.ok(syntheticServer);
    assert.equal(syntheticServer?.serverType, "Example Test Provider");
    assert.match(String(syntheticServer?.endpoints.java), /^synthetic:\/\//);
    assert.ok(syntheticServer?.connectionEndpoints?.every((endpoint) => endpoint.transport === "virtual"));

    const startRes = await fetch(`http://127.0.0.1:3310/api/servers/${serverId}/start`, { method: "POST" });
    assert.equal(startRes.status, 202);
    const startBody = (await startRes.json()) as { operationId: string };

    const opRes = await fetch(`http://127.0.0.1:3310/api/operations/${startBody.operationId}`);
    assert.equal(opRes.status, 200);
    const opBody = (await opRes.json()) as { type: string; status: string };
    assert.equal(opBody.type, "server.start");
    assert.equal(opBody.status, "completed");

    const operationsRes = await fetch("http://127.0.0.1:3310/api/operations?providerId=minecraft&limit=10");
    assert.equal(operationsRes.status, 200);
    const operationsBody = (await operationsRes.json()) as {
      operations: Array<{ operationId: string; providerId: string; serverId?: string; type: string }>;
    };
    assert.ok(operationsBody.operations.some((operation) => operation.operationId === startBody.operationId));
    assert.ok(operationsBody.operations.every((operation) => operation.providerId === "minecraft"));

    const eventsRes = await fetch("http://127.0.0.1:3310/api/events?providerId=minecraft&limit=20");
    assert.equal(eventsRes.status, 200);
    const eventsBody = (await eventsRes.json()) as {
      events: Array<{ type: string; providerId?: string; serverId?: string; operationId?: string }>;
    };
    assert.ok(eventsBody.events.some((event) => event.type === "operation.created" && event.providerId === "minecraft"));

    const historyRes = await fetch("http://127.0.0.1:3310/api/servers/minecraft/minecraft-main/history?limit=20");
    assert.equal(historyRes.status, 200);
    const historyBody = (await historyRes.json()) as {
      providerId: string;
      serverId: string;
      operations: Array<{ providerId: string; serverId?: string }>;
      events: Array<{ providerId?: string; serverId?: string }>;
      audits: Array<{ action: string; result: string }>;
    };
    assert.equal(historyBody.providerId, "minecraft");
    assert.equal(historyBody.serverId, "minecraft-main");
    assert.ok(historyBody.operations.every((operation) => operation.providerId === "minecraft"));
    assert.ok(historyBody.events.every((event) => event.providerId === "minecraft" || event.providerId === undefined));
    assert.ok(historyBody.audits.some((audit) => audit.action === "server.start.requested"));

    const restartRes = await fetch(`http://127.0.0.1:3310/api/servers/${serverId}/restart`, { method: "POST" });
    assert.equal(restartRes.status, 202);
    const restartBody = (await restartRes.json()) as { operationId: string };
    const restartOpRes = await fetch(`http://127.0.0.1:3310/api/operations/${restartBody.operationId}`);
    assert.equal(restartOpRes.status, 200);
    const restartOpBody = (await restartOpRes.json()) as { type: string; status: string };
    assert.equal(restartOpBody.type, "server.restart");
    assert.equal(restartOpBody.status, "completed");

    const worldsRes = await fetch(`http://127.0.0.1:3310/api/servers/${serverId}/worlds`);
    assert.equal(worldsRes.status, 200);
    const worldsBody = (await worldsRes.json()) as { worlds: Array<{ id: string }> };
    assert.ok(worldsBody.worlds.some((world) => world.id === "celestial-castle"));

    const summaryRes = await fetch("http://127.0.0.1:3310/api/analytics/summary?window=24h");
    assert.equal(summaryRes.status, 200);
    const summaryBody = (await summaryRes.json()) as {
      generatedAt: string;
      from: string;
      to: string;
      data: { totals: { providers: number; servers: number } };
    };
    assert.equal(typeof summaryBody.generatedAt, "string");
    assert.equal(typeof summaryBody.from, "string");
    assert.equal(typeof summaryBody.to, "string");
    assert.ok(summaryBody.data.totals.providers >= 2);
    assert.ok(summaryBody.data.totals.servers >= 2);

    const providerAnalyticsRes = await fetch("http://127.0.0.1:3310/api/analytics/providers/minecraft?window=24h");
    assert.equal(providerAnalyticsRes.status, 200);
    const providerAnalyticsBody = (await providerAnalyticsRes.json()) as { providerId: string; data: { providerId: string } };
    assert.equal(providerAnalyticsBody.providerId, "minecraft");
    assert.equal(providerAnalyticsBody.data.providerId, "minecraft");

    const serverAnalyticsRes = await fetch("http://127.0.0.1:3310/api/analytics/servers/minecraft/minecraft-main?window=24h");
    assert.equal(serverAnalyticsRes.status, 200);
    const serverAnalyticsBody = (await serverAnalyticsRes.json()) as { providerId: string; serverId: string; data: { serverId: string } };
    assert.equal(serverAnalyticsBody.providerId, "minecraft");
    assert.equal(serverAnalyticsBody.serverId, "minecraft-main");
    assert.equal(serverAnalyticsBody.data.serverId, "minecraft-main");

    const operationsAnalyticsRes = await fetch("http://127.0.0.1:3310/api/analytics/operations?window=24h&providerId=minecraft");
    assert.equal(operationsAnalyticsRes.status, 200);

    const eventsAnalyticsRes = await fetch("http://127.0.0.1:3310/api/analytics/events?window=24h&providerId=minecraft");
    assert.equal(eventsAnalyticsRes.status, 200);

    const uptimeAnalyticsRes = await fetch("http://127.0.0.1:3310/api/analytics/uptime?window=24h&providerId=minecraft");
    assert.equal(uptimeAnalyticsRes.status, 200);

    const worldValidationRes = await fetch("http://127.0.0.1:3310/api/analytics/world-validation?window=24h&providerId=minecraft");
    assert.equal(worldValidationRes.status, 200);

    const historyOverviewRes = await fetch("http://127.0.0.1:3310/api/history/overview");
    assert.equal(historyOverviewRes.status, 200);
    const historyOverviewBody = (await historyOverviewRes.json()) as {
      generatedAt: string;
      data: { retention: { operationRetentionDays: number }; oldestByDomain: { operations?: string } };
    };
    assert.equal(typeof historyOverviewBody.generatedAt, "string");
    assert.ok(historyOverviewBody.data.retention.operationRetentionDays > 0);

    const cleanupRejectedRes = await fetch("http://127.0.0.1:3310/api/history/cleanup", { method: "POST" });
    assert.equal(cleanupRejectedRes.status, 400);

    const cleanupRes = await fetch("http://127.0.0.1:3310/api/history/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "CLEANUP_HISTORY", actor: "contract-test" }),
    });
    assert.equal(cleanupRes.status, 200);
    const cleanupBody = (await cleanupRes.json()) as {
      cleanup: { operationsDeleted: number; eventsDeleted: number; auditDeleted: number };
      policy: { operationRetentionDays: number };
      executedAt: string;
      cutoff: { operationsBefore: string };
    };
    assert.equal(typeof cleanupBody.executedAt, "string");
    assert.ok(cleanupBody.policy.operationRetentionDays > 0);
    assert.equal(typeof cleanupBody.cleanup.operationsDeleted, "number");
    assert.equal(typeof cleanupBody.cutoff.operationsBefore, "string");

    const aiProvidersRes = await fetch("http://127.0.0.1:3310/api/ai/providers");
    assert.equal(aiProvidersRes.status, 200);
    const aiProvidersBody = (await aiProvidersRes.json()) as {
      active: string;
      readOnly: boolean;
      configured: { gemini: boolean; openai: boolean };
    };
    assert.equal(aiProvidersBody.active, "fallback");
    assert.equal(aiProvidersBody.readOnly, true);

    const aiRejectedRes = await fetch("http://127.0.0.1:3310/api/ai/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "a" }),
    });
    assert.equal(aiRejectedRes.status, 400);

    const aiAskRes = await fetch("http://127.0.0.1:3310/api/ai/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Why did Minecraft go offline?", providerId: "minecraft", window: "24h" }),
    });
    assert.equal(aiAskRes.status, 200);
    const aiAskBody = (await aiAskRes.json()) as {
      requestId: string;
      question: string;
      answer: string;
      providerId: string;
      model: string;
      contextSources: string[];
      contextWindow: { from: string; to: string };
      generatedAt: string;
    };
    assert.equal(typeof aiAskBody.requestId, "string");
    assert.equal(aiAskBody.providerId, "fallback");
    assert.ok(aiAskBody.contextSources.length > 0);
    assert.equal(typeof aiAskBody.answer, "string");

    const aiAuditRes = await fetch("http://127.0.0.1:3310/api/ai/audit?limit=10");
    assert.equal(aiAuditRes.status, 200);
    const aiAuditBody = (await aiAuditRes.json()) as {
      audits: Array<{
        action: string;
        result: string;
        metadata?: { requestId?: string; questionLength?: number; answerLength?: number };
      }>;
    };
    const matchingAudit = aiAuditBody.audits.find((entry) => entry.metadata?.requestId === aiAskBody.requestId);
    assert.ok(matchingAudit);
    assert.equal(matchingAudit?.action, "ai.query.requested");
    assert.equal(matchingAudit?.result, "completed");
    assert.equal(typeof matchingAudit?.metadata?.questionLength, "number");
    assert.equal(typeof matchingAudit?.metadata?.answerLength, "number");
    assert.ok(matchingAudit && !("question" in matchingAudit.metadata!));
    assert.ok(matchingAudit && !("answer" in matchingAudit.metadata!));
  } finally {
    await closeServer(server);
  }
});
