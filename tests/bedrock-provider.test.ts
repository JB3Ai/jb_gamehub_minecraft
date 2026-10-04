import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BedrockProvider } from "../packages/bedrock-provider";
import { bootstrapCore, FamilyService } from "../packages/core";
import type { ProviderPlayerLifecycleEvent } from "../packages/provider-manager";

const PACK_UUID = "1c3e8cf8-83f5-4d7e-9f11-2bd9339a2e10";
const MODULE_UUID = "a32fa729-a57e-4e72-b00c-77444fdc0a20";

async function fixtureRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `jbgh021-${name}-`));
}

async function waitFor<T>(description: string, read: () => Promise<T>, ready: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observed = await read();
    if (ready(observed)) return observed;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}. Last observed: ${JSON.stringify(observed)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function writeBedrockFixture(root: string): Promise<void> {
  await mkdir(path.join(root, "worlds", "city", "db"), { recursive: true });
  await mkdir(path.join(root, "resource_packs", PACK_UUID), { recursive: true });
  await writeFile(path.join(root, "bedrock_server.exe"), "fixture");
  await writeFile(path.join(root, "worlds", "city", "level.dat"), "level");
  await writeFile(path.join(root, "worlds", "city", "world_resource_packs.json"), JSON.stringify([{ pack_id: PACK_UUID, version: [1, 0, 0] }]));
  await writeFile(path.join(root, "resource_packs", PACK_UUID, "manifest.json"), JSON.stringify({
    format_version: 2,
    header: { name: "Fixture textures", uuid: PACK_UUID, version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: MODULE_UUID, version: [1, 0, 0] }],
  }));
}

test("native Bedrock provider declares an honest degraded capability set without BDS", async () => {
  const provider = new BedrockProvider();
  await provider.register();
  assert.equal(provider.metadata().status, "degraded");
  assert.equal(provider.getCapabilities()["runtime.native-bedrock"], false);
  await assert.rejects(() => provider.startServer("bedrock-main"), /not configured/);
});

test("native Bedrock provider validates a managed world and drives lifecycle events through BDS stdout/stdin", async () => {
  const root = await fixtureRoot("runtime");
  await writeBedrockFixture(root);
  const script = [
    "console.log('Server started.');",
    "console.log('Player connected: Alex, xuid: 2533274790000001');",
    "process.stdin.on('data', data => { const command = data.toString(); if (command.startsWith('kick')) console.log('Player disconnected: Alex, xuid: 2533274790000001'); if (command.startsWith('stop')) process.exit(0); });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const provider = new BedrockProvider({ serverDir: root, startCommand: `node -e "${script.replace(/"/g, '\\"')}"` });
  const events: string[] = [];
  const unsubscribe = provider.subscribePlayerEvents((event) => events.push(event.type));
  try {
    await provider.register();
    assert.equal(provider.metadata().status, "ready");
    assert.equal(provider.getCapabilities()["player.enforcement"], true);
    assert.deepEqual((await provider.getWorlds("bedrock-main")).map((world) => world.id), ["city"]);
    assert.equal((await provider.validateWorld("bedrock-main", "city")).valid, true);
    await provider.startServer("bedrock-main");
    await waitFor("managed fixture player.joined event", async () => events, (current) => current.includes("player.joined"));
    await provider.disconnectPlayer("bedrock-main", "2533274790000001", "Policy expired");
    await waitFor("managed fixture player.left event", async () => events, (current) => current.includes("player.left"));
    assert.deepEqual(events, ["player.joined", "player.left"]);
    assert.equal((await provider.getOnlinePlayers("bedrock-main")).length, 0);
  } finally {
    await provider.stopServer("bedrock-main").catch(() => undefined);
    await waitFor("fixture process to stop before cleanup", () => provider.getServerStatus("bedrock-main"), (status) => status.status === "offline");
    unsubscribe();
    await rm(root, { recursive: true, force: true });
  }
});

test("native Bedrock provider parses a player-joined lifecycle log line split across stdout chunks", async () => {
  const root = await fixtureRoot("chunked-join");
  await writeBedrockFixture(root);
  const script = [
    "console.log('Server started.');",
    "process.stdout.write('[2026-09-21 13:50:36:314 INFO] Player connec');",
    "setTimeout(() => process.stdout.write('ted: JonoElite79231, xuid: 2535416533732593\\r\\n'), 50);",
    "process.stdin.on('data', data => { if (data.toString().startsWith('stop')) process.exit(0); });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const provider = new BedrockProvider({ serverDir: root, startCommand: `node -e "${script.replace(/"/g, '\\"')}"` });
  const events: ProviderPlayerLifecycleEvent[] = [];
  const unsubscribe = provider.subscribePlayerEvents((event) => events.push(event));
  try {
    await provider.register();
    await provider.startServer("bedrock-main");
    await waitFor("chunked player.joined event", async () => events, (current) => current.some((event) => event.type === "player.joined"));
    const joinEvents = events.filter((event) => event.type === "player.joined");
    assert.equal(joinEvents.length, 1);
    assert.equal(joinEvents[0].externalPlayerId, "2535416533732593");
    assert.equal(joinEvents[0].displayName, "JonoElite79231");
    const online = await provider.getOnlinePlayers("bedrock-main");
    assert.equal(online.length, 1);
    assert.equal(online[0].externalPlayerId, "2535416533732593");
  } finally {
    await provider.stopServer("bedrock-main").catch(() => undefined);
    await waitFor("fixture process to stop before cleanup", () => provider.getServerStatus("bedrock-main"), (status) => status.status === "offline");
    unsubscribe();
    await rm(root, { recursive: true, force: true });
  }
});

test("native Bedrock provider parses a player-left lifecycle log line split across stdout chunks", async () => {
  const root = await fixtureRoot("chunked-leave");
  await writeBedrockFixture(root);
  const script = [
    "console.log('Server started.');",
    "console.log('[2026-09-22 16:45:53:340 INFO] Player connected: JonoElite79231, xuid: 2535416533732593');",
    "setTimeout(() => { process.stdout.write('[2026-09-22 16:46:26:653 INFO] Player disconnec'); setTimeout(() => process.stdout.write('ted: JonoElite79231, xuid: 2535416533732593, pfid: 4210118A1E0D32D2\\r\\n'), 50); }, 100);",
    "process.stdin.on('data', data => { if (data.toString().startsWith('stop')) process.exit(0); });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const provider = new BedrockProvider({ serverDir: root, startCommand: `node -e "${script.replace(/"/g, '\\"')}"` });
  const events: ProviderPlayerLifecycleEvent[] = [];
  const unsubscribe = provider.subscribePlayerEvents((event) => events.push(event));
  try {
    await provider.register();
    await provider.startServer("bedrock-main");
    await waitFor("chunked player.left event", async () => events, (current) => current.some((event) => event.type === "player.left"));
    const leaveEvents = events.filter((event) => event.type === "player.left");
    assert.equal(leaveEvents.length, 1);
    assert.equal(leaveEvents[0].externalPlayerId, "2535416533732593");
    assert.equal(leaveEvents[0].externalPlayerId.endsWith(","), false);
    assert.equal((await provider.getOnlinePlayers("bedrock-main")).length, 0);
  } finally {
    await provider.stopServer("bedrock-main").catch(() => undefined);
    await waitFor("fixture process to stop before cleanup", () => provider.getServerStatus("bedrock-main"), (status) => status.status === "offline");
    unsubscribe();
    await rm(root, { recursive: true, force: true });
  }
});

test("native Bedrock provider issues a console kick using the player's display name, not the raw XUID", async () => {
  const root = await fixtureRoot("kick-target");
  await writeBedrockFixture(root);
  const captureFile = path.join(root, "kick-capture.txt");
  await writeFile(captureFile, "");
  const script = [
    "const fs = require('fs');",
    "console.log('Server started.');",
    "console.log('Player connected: Alex, xuid: 2533274790000001');",
    "process.stdin.on('data', data => { fs.appendFileSync(process.env.JBGH_KICK_CAPTURE_FILE, data.toString()); const command = data.toString(); if (command.startsWith('kick')) console.log('Player disconnected: Alex, xuid: 2533274790000001'); if (command.startsWith('stop')) process.exit(0); });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const provider = new BedrockProvider({ serverDir: root, startCommand: `node -e "${script.replace(/"/g, '\\"')}"` });
  const events: ProviderPlayerLifecycleEvent[] = [];
  const unsubscribe = provider.subscribePlayerEvents((event) => events.push(event));
  process.env.JBGH_KICK_CAPTURE_FILE = captureFile;
  try {
    await provider.register();
    await provider.startServer("bedrock-main");
    await waitFor("Alex to appear in the provider online-player map", () => provider.getOnlinePlayers("bedrock-main"),
      (players) => players.some((player) => player.externalPlayerId === "2533274790000001"));
    await provider.disconnectPlayer("bedrock-main", "2533274790000001", "Policy expired");
    await waitFor("the kick to produce Alex's player.left event", async () => events.filter((event) => event.type === "player.left"),
      (left) => left.some((event) => event.externalPlayerId === "2533274790000001"));
    const captured = await readFile(captureFile, "utf8");
    assert.match(captured, /^kick "Alex" Policy expired/);
    assert.equal(events.filter((event) => event.type === "player.left").length, 1);
    assert.equal((await provider.getOnlinePlayers("bedrock-main")).length, 0);
  } finally {
    delete process.env.JBGH_KICK_CAPTURE_FILE;
    await provider.stopServer("bedrock-main").catch(() => undefined);
    await waitFor("kick fixture process to stop before cleanup", () => provider.getServerStatus("bedrock-main"), (status) => status.status === "offline");
    unsubscribe();
    await rm(root, { recursive: true, force: true });
  }
});

test("native Bedrock provider fails honestly when enforcement targets a player that is not online", async () => {
  const root = await fixtureRoot("kick-offline");
  await writeBedrockFixture(root);
  const script = [
    "console.log('Server started.');",
    "process.stdin.on('data', data => { if (data.toString().startsWith('stop')) process.exit(0); });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const provider = new BedrockProvider({ serverDir: root, startCommand: `node -e "${script.replace(/"/g, '\\"')}"` });
  try {
    await provider.register();
    await provider.startServer("bedrock-main");
    await waitFor("offline-player fixture server readiness", () => provider.getServerStatus("bedrock-main"), (status) => status.status === "online");
    await assert.rejects(() => provider.disconnectPlayer("bedrock-main", "not-online-xuid", "Policy expired"), /not currently online/);
  } finally {
    await provider.stopServer("bedrock-main").catch(() => undefined);
    await waitFor("fixture process to stop before cleanup", () => provider.getServerStatus("bedrock-main"), (status) => status.status === "offline");
    await rm(root, { recursive: true, force: true });
  }
});

test("native Bedrock provider reports missing linked packs without claiming validation success", async () => {
  const root = await fixtureRoot("missing-pack");
  await writeBedrockFixture(root);
  await rm(path.join(root, "resource_packs", PACK_UUID), { recursive: true, force: true });
  const provider = new BedrockProvider({ serverDir: root });
  await provider.register();
  const result = await provider.validateWorld("bedrock-main", "city");
  assert.equal(result.valid, false);
  assert.equal(result.missingPacks[0]?.type, "missing_pack");
  await rm(root, { recursive: true, force: true });
});

test("native Bedrock lifecycle events create provider-neutral family sessions", async () => {
  const root = await fixtureRoot("family-lifecycle");
  await writeBedrockFixture(root);
  const script = [
    "console.log('Server started.');",
    "console.log('[2026-09-22 16:45:53:340 INFO] Player connected: JonoElite79231, xuid: 2535416533732593');",
    // Keep the player connected until the test has observed the durable active session.
    "process.stdin.on('data', data => { if (data.toString().startsWith('stop')) process.stdout.write('[2026-09-22 16:46:26:653 INFO] Player disconnected: JonoElite79231, xuid: 2535416533732593, pfid: 4210118A1E0D32D2\\n', () => process.exit(0)); });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const manager = await bootstrapCore({
    minecraftServerDir: path.join(root, "paper"),
    bedrockServerDir: root,
    bedrockStartCommand: `node -e "${script.replace(/"/g, '\\"')}"`,
    persistenceDbPath: path.join(root, "gamehub.sqlite"),
  });
  const familyService = new FamilyService(manager);
  const unbind = familyService.bindPlayerLifecycle();
  let stopRequested = false;
  try {
    const family = await familyService.createFamily({ name: "Bedrock Family", timezone: "UTC" });
    const child = await familyService.createChild({ familyId: family.id, name: "JonoElite79231", timezone: "UTC" });
    await familyService.linkIdentity({
      childId: child.id,
      providerId: "minecraft-bedrock",
      externalPlayerId: "2535416533732593",
      displayName: "JonoElite79231",
      identityType: "minecraft-bedrock-xuid",
      verified: true,
    });
    const operation = await manager.startServer("bedrock-main");
    assert.equal((await manager.getOperation(operation.operationId))?.status, "completed");
    const sessions = await waitFor("FamilyService to persist the active Bedrock session", () => familyService.listSessions(child.id),
      (current) => current.some((session) => session.status === "active"));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].providerId, "minecraft-bedrock");
    assert.equal(sessions[0].serverId, "bedrock-main");
    assert.equal(sessions[0].status, "active");
    // Explicitly release the fixture's leave event only after checking the active session.
    stopRequested = true;
    const stop = await manager.stopServer("bedrock-main");
    assert.equal((await manager.getOperation(stop.operationId))?.status, "completed");
    const endedSessions = await waitFor("FamilyService to persist the same session as ended", () => familyService.listSessions(child.id),
      (current) => current.some((session) => session.id === sessions[0].id && session.status === "ended"));
    assert.equal(endedSessions.length, 1);
    assert.equal(endedSessions[0].status, "ended");
  } finally {
    if (!stopRequested) await manager.stopServer("bedrock-main").catch(() => undefined);
    await waitFor("family fixture process to stop before cleanup", () => manager.getServerStatus("bedrock-main"), (status) => status.status === "offline");
    unbind();
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
