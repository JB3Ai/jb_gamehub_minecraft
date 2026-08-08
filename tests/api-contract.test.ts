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
        serverType: string;
        status: string;
        availability: boolean;
        lastStatusUpdate: string;
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

    const syntheticServer = serversBody.servers.find((server) => server.id === "synthetic-main");
    assert.ok(syntheticServer);
    assert.equal(syntheticServer?.serverType, "Example Test Provider");
    assert.match(String(syntheticServer?.endpoints.java), /^synthetic:\/\//);

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
  } finally {
    await closeServer(server);
  }
});
