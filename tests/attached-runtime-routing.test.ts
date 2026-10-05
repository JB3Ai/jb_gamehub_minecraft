import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { attachedFixture } from "./helpers/attached-runtime-fixture";
import { SqlitePersistenceRepository } from "../packages/core/sqlite-repository";
import { InMemoryProviderManager, type GameProvider, type ProviderPlayerLifecycleEvent } from "../packages/provider-manager";
import { scopeRuntimeProvider } from "../packages/provider-manager/scoped-runtime-provider";
import { createAttachedJavaRuntime } from "../packages/minecraft-provider/attached-runtime";
import { createAttachedBedrockRuntime } from "../packages/bedrock-provider/attached-runtime";
import { MinecraftProvider } from "../packages/minecraft-provider";
import { BedrockProvider } from "../packages/bedrock-provider";
import { SyntheticProvider } from "../packages/synthetic-provider";

for (const kind of ["java", "bedrock"] as const) test(`${kind} attached runtimes route independently, preserve events and restore after restart`, async (t) => {
  const a = await attachedFixture(t, kind, "a", 23001); const b = await attachedFixture(t, kind, "b", 23011);
  const policy = { ...a.policy, adoptionRoots: [...a.policy.adoptionRoots, ...b.policy.adoptionRoots], adoptionLocations: { ...a.policy.adoptionLocations, ...b.policy.adoptionLocations } };
  const filePath = path.join(a.base, "routes.sqlite"); let manager: InMemoryProviderManager;
  const calls: string[] = []; const children = new Map<string, GameProvider>(); const emitters = new Map<string, (event: ProviderPlayerLifecycleEvent) => void>();
  const initialize = async () => {
    manager = new InMemoryProviderManager({ repository: new SqlitePersistenceRepository({ filePath }) }); await manager.initialize();
    const base = kind === "java" ? new MinecraftProvider({ serverDir: path.join(a.base, "legacy") }) : new BedrockProvider();
    await manager.register(scopeRuntimeProvider(base, async (record, settings) => {
      const child = await (kind === "java" ? createAttachedJavaRuntime : createAttachedBedrockRuntime)(record, settings); const id = record.descriptor.serverId; let online = false;
      child.startServer = async (serverId) => { assert.equal(serverId, id); calls.push(`start:${id}`); online = true; return { simulated: true }; };
      child.stopServer = async (serverId) => { assert.equal(serverId, id); calls.push(`stop:${id}`); online = false; return { simulated: true }; };
      child.getServerStatus = async () => ({ status: online ? "online" : "offline" });
      child.subscribePlayerEvents = (listener) => { emitters.set(id, listener); return () => { emitters.delete(id); }; };
      children.set(id, child); return child;
    }));
  };
  await initialize();
  try {
    for (const fixture of [a, b]) { const plan = await manager!.planProvisioning(fixture.request); const preview = await manager!.previewRuntimeAttachment(plan, policy); assert.equal((await manager!.attachRuntime({ ...preview, approved: true }, policy)).result.state, "PROVISIONED"); }
    const records = manager!.listRuntimeAttachments(); assert.equal(records.length, 2);
    assert.equal((await manager!.getServer(a.request.serverId!, a.providerId))?.ownership, "ADOPTED");
    const start = await manager!.startServer(a.request.serverId!, a.providerId, "verified-admin"); assert.equal(start.status, "completed");
    assert.equal((await manager!.getServerStatus(b.request.serverId!, b.providerId)).status, "offline");
    assert.ok((await manager!.getWorlds(a.request.serverId!)).every((world) => world.path.startsWith(a.root)));
    assert.ok((await manager!.getWorlds(b.request.serverId!)).every((world) => world.path.startsWith(b.root)));
    assert.equal((await manager!.getServerConnectionEndpoints(b.request.serverId!))[0].port, 23011);
    const events: ProviderPlayerLifecycleEvent[] = []; const unsubscribe = manager!.onPlayerEvent((event) => events.push(event));
    emitters.get(a.request.serverId!)!({ type: "player.joined", providerId: a.providerId, serverId: a.request.serverId!, externalPlayerId: "player", displayName: "Fixture", identityType: kind === "java" ? "minecraft" : "minecraft-bedrock", timestamp: new Date().toISOString() });
    assert.equal(events.length, 1); assert.equal(events[0].serverId, a.request.serverId); unsubscribe();
    const before = [...calls]; await assert.rejects(manager!.startServer("unknown", a.providerId), /not found/); assert.deepEqual(calls, before);
    assert.equal((await manager!.stopServer(a.request.serverId!, a.providerId)).status, "completed");
    assert.ok((await manager!.listAudits()).some((audit) => audit.actor === "verified-admin"));
    await manager!.shutdown(); await initialize(); for (const record of records) await manager!.recoverRuntimeAttachment(record.operationId, policy);
    assert.equal((await manager!.startServer(b.request.serverId!, b.providerId)).status, "completed"); await manager!.stopServer(b.request.serverId!, b.providerId);
    await fs.appendFile(path.join(a.root, kind === "java" ? "paper.jar" : "bedrock_server.exe"), "changed");
    const denied = await manager!.startServer(a.request.serverId!, a.providerId); assert.equal(denied.status, "failed");
    assert.ok((await fs.readFile(path.join(b.root, "server.properties"), "utf8")).includes("b-world"));
  } finally { await manager!.shutdown(); }
});

test("two synthetic scoped attachments isolate state and reject wrong provider selection", async () => {
  const manager = new InMemoryProviderManager(); await manager.initialize();
  const scoped = scopeRuntimeProvider(new SyntheticProvider(), async (record) => new SyntheticProvider({ providerId: "synthetic", serverId: record.descriptor.serverId }));
  await manager.register(scoped);
  try {
    for (const serverId of ["a", "b"]) await scoped.activateAttachment!({ effectId: serverId, operationId: serverId, digest: serverId, fencingToken: 1, attachedAt: "2026-10-05", descriptor: { schemaVersion: 1, providerId: "synthetic", serverId, hostId: "local", runtimeRoot: "synthetic://fixture", rootIdentity: { device: "virtual", inode: serverId }, ownership: "ADOPTED", mode: "attach", destructiveOwnership: false, manifest: [], endpoints: [], worlds: [], verifiedAt: "2026-10-05", issues: [] } }, { hostId: "local", adoptionRoots: [], managedRoots: {}, adoptionLocations: {}, artifactLocations: {} }, async () => {});
    assert.equal((await manager.startServer("a", "synthetic")).status, "completed");
    assert.equal((await manager.getServerStatus("a", "synthetic")).status, "online"); assert.equal((await manager.getServerStatus("b", "synthetic")).status, "offline");
    await assert.rejects(manager.startServer("a", "missing"), /not found|Unknown provider/);
    await manager.stopServer("a", "synthetic");
  } finally { await manager.shutdown(); }
});

test("Bedrock launch dispatch errors fail honestly without an unhandled child error", async (t) => {
  const f = await attachedFixture(t, "bedrock", "spawn-error", 23501);
  const provider = new BedrockProvider({ serverDir: f.root, serverId: f.request.serverId, startCommand: `"${path.join(f.base, "does-not-exist.exe")}"` });
  await provider.register(); await assert.rejects(provider.startServer(f.request.serverId!), /ENOENT/);
  assert.equal((await provider.getServerStatus(f.request.serverId!)).status, "offline");
});

test("attached Java refuses to launch without pre-existing EULA acceptance", async (t) => {
  const f = await attachedFixture(t, "java", "eula", 23511); const manager = new InMemoryProviderManager({ repository: new SqlitePersistenceRepository({ filePath: path.join(f.base, "eula.sqlite") }) }); await manager.initialize();
  try {
    await manager.register(scopeRuntimeProvider(new MinecraftProvider({ serverDir: f.root }), createAttachedJavaRuntime));
    const preview = await manager.previewRuntimeAttachment(await manager.planProvisioning(f.request), f.policy);
    await manager.attachRuntime({ ...preview, approved: true }, f.policy);
    const result = await manager.startServer(f.request.serverId!, f.providerId);
    assert.equal(result.status, "failed");
    await assert.rejects(fs.access(path.join(f.root, "eula.txt")));
  } finally { await manager.shutdown(); }
});
