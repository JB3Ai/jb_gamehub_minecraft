import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type http from "http";
import { startServer } from "../server";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/minecraft-server");

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
  });

  try {
    const providersRes = await fetch("http://127.0.0.1:3310/api/providers");
    assert.equal(providersRes.status, 200);
    const providersBody = (await providersRes.json()) as { providers: Array<{ id: string }> };
    assert.equal(providersBody.providers[0]?.id, "minecraft");

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

    const startRes = await fetch(`http://127.0.0.1:3310/api/servers/${serverId}/start`, { method: "POST" });
    assert.equal(startRes.status, 202);
    const startBody = (await startRes.json()) as { operationId: string };

    const opRes = await fetch(`http://127.0.0.1:3310/api/operations/${startBody.operationId}`);
    assert.equal(opRes.status, 200);
    const opBody = (await opRes.json()) as { type: string; status: string };
    assert.equal(opBody.type, "server.start");
    assert.equal(opBody.status, "completed");

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
