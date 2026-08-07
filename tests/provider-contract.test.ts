import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { bootstrapCore } from "../packages/core/index";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/minecraft-server");

test("provider discovery and capability reporting", async () => {
  const manager = await bootstrapCore({
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
  });

  const providers = manager.listProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.id, "minecraft");

  const capabilities = manager.getCapabilities("minecraft");
  assert.equal(capabilities["server.start"], true);
  assert.equal(capabilities["world.list"], true);
});

test("server status, start/stop operation tracking, and operation retrieval", async () => {
  const manager = await bootstrapCore({
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
  });

  const status = await manager.getServerStatus("minecraft-main");
  assert.ok(["online", "offline", "starting", "stopping", "error"].includes(status.status));

  const startOp = await manager.startServer("minecraft-main");
  assert.ok(startOp.operationId.startsWith("op_"));

  const startRecord = manager.getOperation(startOp.operationId);
  assert.equal(startRecord?.status, "completed");
  assert.equal(startRecord?.type, "server.start");

  const stopOp = await manager.stopServer("minecraft-main");
  const stopRecord = manager.getOperation(stopOp.operationId);
  assert.equal(stopRecord?.status, "completed");
  assert.equal(stopRecord?.type, "server.stop");
});

test("world listing and pack validation mismatch fixture", async () => {
  const manager = await bootstrapCore({
    minecraftServerDir: fixtureDir,
  });

  const worlds = await manager.getWorlds("minecraft-main");
  assert.ok(worlds.length >= 1);

  const world = worlds.find((item) => item.id === "celestial-castle");
  assert.ok(world);

  const validation = await manager.validateWorld("minecraft-main", "celestial-castle");
  assert.equal(validation.valid, false);
  assert.ok(validation.invalidPacks.some((issue) => issue.type === "version_mismatch"));
});
