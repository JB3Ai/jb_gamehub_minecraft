import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type http from "node:http";
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

test("API history survives backend restart using SQLite persistence", async () => {
  process.env.NODE_ENV = "production";
  const dbPath = testDbPath("api-restart");

  const first = await startServer(3331, {
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
  });

  let minecraftOperationId = "";
  let syntheticOperationId = "";

  try {
    const startMinecraftRes = await fetch("http://127.0.0.1:3331/api/servers/minecraft-main/start", { method: "POST" });
    assert.equal(startMinecraftRes.status, 202);
    minecraftOperationId = ((await startMinecraftRes.json()) as { operationId: string }).operationId;

    const startSyntheticRes = await fetch("http://127.0.0.1:3331/api/servers/synthetic-main/start", { method: "POST" });
    assert.equal(startSyntheticRes.status, 202);
    syntheticOperationId = ((await startSyntheticRes.json()) as { operationId: string }).operationId;

    const stopSyntheticRes = await fetch("http://127.0.0.1:3331/api/servers/synthetic-main/stop", { method: "POST" });
    assert.equal(stopSyntheticRes.status, 202);

    const validateRes = await fetch("http://127.0.0.1:3331/api/servers/minecraft-main/worlds/celestial-castle/validate", { method: "POST" });
    assert.equal(validateRes.status, 200);
  } finally {
    await closeServer(first);
  }

  const restarted = await startServer(3331, {
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
  });

  try {
    const operationsRes = await fetch("http://127.0.0.1:3331/api/operations?limit=50");
    assert.equal(operationsRes.status, 200);
    const operationsBody = (await operationsRes.json()) as {
      operations: Array<{ operationId: string; providerId: string; serverId?: string }>;
    };

    assert.ok(operationsBody.operations.some((operation) => operation.operationId === minecraftOperationId));
    assert.ok(operationsBody.operations.some((operation) => operation.operationId === syntheticOperationId));

    const minecraftHistoryRes = await fetch("http://127.0.0.1:3331/api/servers/minecraft/minecraft-main/history?limit=100");
    assert.equal(minecraftHistoryRes.status, 200);
    const minecraftHistory = (await minecraftHistoryRes.json()) as {
      operations: Array<{ providerId: string; serverId?: string }>;
      events: Array<{ providerId?: string; serverId?: string }>;
      audits: Array<{ action: string }>;
    };
    assert.ok(minecraftHistory.operations.every((operation) => operation.providerId === "minecraft"));
    assert.ok(minecraftHistory.events.every((event) => event.providerId === "minecraft" || event.providerId === undefined));
    assert.ok(minecraftHistory.audits.some((audit) => audit.action === "world.validation.requested"));

    const syntheticHistoryRes = await fetch("http://127.0.0.1:3331/api/servers/synthetic/synthetic-main/history?limit=100");
    assert.equal(syntheticHistoryRes.status, 200);
    const syntheticHistory = (await syntheticHistoryRes.json()) as {
      operations: Array<{ providerId: string; serverId?: string }>;
      events: Array<{ providerId?: string; serverId?: string }>;
      audits: Array<{ action: string }>;
    };
    assert.ok(syntheticHistory.operations.every((operation) => operation.providerId === "synthetic"));
    assert.ok(syntheticHistory.events.every((event) => event.providerId === "synthetic" || event.providerId === undefined));
    assert.ok(syntheticHistory.audits.some((audit) => audit.action === "server.start.requested"));
  } finally {
    await closeServer(restarted);
  }
});
