import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "path";
import WebSocket from "ws";
import type http from "http";
import { startServer } from "../server";

process.env.NODE_ENV = "production";

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

function createCollector(socket: WebSocket) {
  const events: Array<Record<string, unknown>> = [];

  socket.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      events.push(parsed);
    } catch {
      // Ignore non-JSON payloads.
    }
  });

  async function waitForTypeSequence(expectedTypes: string[], timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const matched: Array<Record<string, unknown>> = [];
      let cursor = 0;

      for (const event of events) {
        if (event.type === expectedTypes[cursor]) {
          matched.push(event);
          cursor += 1;
          if (cursor === expectedTypes.length) {
            return matched;
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Timed out waiting for event sequence: ${expectedTypes.join(" -> ")}`);
  }

  async function waitForType(expectedType: string, timeoutMs = 4000) {
    const [event] = await waitForTypeSequence([expectedType], timeoutMs);
    return event;
  }

  return { events, waitForType, waitForTypeSequence };
}

test("WebSocket receives operation lifecycle and server status events", async () => {
  const port = 3321;
  const server = await startServer(port, {
    minecraftServerDir: fixtureDir,
    minecraftHost: "127.0.0.1",
    minecraftJavaPort: 45678,
    minecraftBedrockPort: 19132,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
  });

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const collector = createCollector(socket);

  try {
    await once(socket, "open");

    const startResponse = await fetch(`http://127.0.0.1:${port}/api/servers/minecraft-main/start`, { method: "POST" });
    assert.equal(startResponse.status, 202);

    const operationEvents = await collector.waitForTypeSequence([
      "operation.created",
      "operation.started",
      "operation.completed",
    ]);

    const operationIds = operationEvents.map((event) => event.operationId);
    assert.ok(operationIds.every((operationId) => typeof operationId === "string" && operationId.startsWith("op_")));
    assert.equal(new Set(operationIds).size, 1);
    assert.equal(operationEvents[0]?.providerId, "minecraft");
    assert.equal(operationEvents[0]?.serverId, "minecraft-main");
    assert.equal(operationEvents[0]?.status, "queued");
    assert.equal(operationEvents[1]?.status, "running");
    assert.equal(operationEvents[2]?.status, "completed");
    for (const event of operationEvents) {
      assert.equal(typeof event.timestamp, "string");
      assert.match(String(event.timestamp), /^\d{4}-\d{2}-\d{2}T/);
    }

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/servers/minecraft-main/status`);
    assert.equal(statusResponse.status, 200);

    const statusEvent = await collector.waitForType("server.status.changed");
    assert.equal(statusEvent.providerId, "minecraft");
    assert.equal(statusEvent.serverId, "minecraft-main");
    assert.equal(statusEvent.status, "offline");
    assert.equal(typeof statusEvent.timestamp, "string");
  } finally {
    socket.close();
    await closeServer(server);
  }
});

test("WebSocket receives failure lifecycle events", async () => {
  const port = 3322;
  const server = await startServer(port, {
    minecraftServerDir: fixtureDir,
    minecraftHost: "127.0.0.1",
    minecraftJavaPort: 45679,
    minecraftBedrockPort: 19132,
    minecraftStartCommand: "node -e \"process.exit(1)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
  });

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const collector = createCollector(socket);

  try {
    await once(socket, "open");

    const response = await fetch(`http://127.0.0.1:${port}/api/servers/minecraft-main/start`, { method: "POST" });
    assert.equal(response.status, 202);

    const failureEvents = await collector.waitForTypeSequence([
      "operation.created",
      "operation.started",
      "operation.failed",
    ]);

    assert.equal(failureEvents[0]?.providerId, "minecraft");
    assert.equal(failureEvents[0]?.serverId, "minecraft-main");
    assert.equal(failureEvents[0]?.status, "queued");
    assert.equal(failureEvents[1]?.status, "running");
    assert.equal(failureEvents[2]?.status, "failed");
    assert.equal(failureEvents[2]?.operationId, failureEvents[0]?.operationId);
    assert.equal(typeof failureEvents[2]?.timestamp, "string");
  } finally {
    socket.close();
    await closeServer(server);
  }
});

test("WebSocket receives world validation completion events", async () => {
  const port = 3323;
  const server = await startServer(port, {
    minecraftServerDir: fixtureDir,
    minecraftHost: "127.0.0.1",
    minecraftJavaPort: 45680,
    minecraftBedrockPort: 19132,
  });

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const collector = createCollector(socket);

  try {
    await once(socket, "open");

    const response = await fetch(`http://127.0.0.1:${port}/api/servers/minecraft-main/worlds/celestial-castle/validate`, {
      method: "POST",
    });
    assert.equal(response.status, 200);

    const validationEvents = await collector.waitForTypeSequence([
      "operation.created",
      "operation.started",
      "operation.completed",
      "world.validation.completed",
    ]);

    assert.equal(validationEvents[0]?.providerId, "minecraft");
    assert.equal(validationEvents[0]?.serverId, "minecraft-main");
    assert.equal(validationEvents[3]?.providerId, "minecraft");
    assert.equal(validationEvents[3]?.serverId, "minecraft-main");
    assert.equal(validationEvents[3]?.worldId, "celestial-castle");
    assert.equal(validationEvents[3]?.status, "completed");
    assert.equal(typeof validationEvents[3]?.timestamp, "string");

    const payload = validationEvents[3]?.payload as { valid?: boolean; invalidPacks?: Array<{ type?: string }> } | undefined;
    assert.equal(payload?.valid, false);
    assert.ok(payload?.invalidPacks?.some((issue) => issue.type === "version_mismatch"));
  } finally {
    socket.close();
    await closeServer(server);
  }
});
