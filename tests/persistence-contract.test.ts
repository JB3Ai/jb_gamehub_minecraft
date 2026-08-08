import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  GameProvider,
  InMemoryProviderManager,
  PersistenceRepository,
  ProviderDiagnostics,
  ProviderMetadata,
  ServerStatus,
  ValidationResult,
} from "../packages/provider-manager/index";
import { bootstrapCore } from "../packages/core/index";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/minecraft-server");

function testDbPath(name: string): string {
  return path.resolve(process.cwd(), "tests", "tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sqlite`);
}

test("operations, events, audit and state survive persistence restart with provider isolation", async () => {
  const dbPath = testDbPath("persistence-restart");

  const manager = await bootstrapCore({
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
  });

  const syntheticStart = await manager.startServer("synthetic-main");
  await manager.getServerStatus("synthetic-main");
  await manager.stopServer("synthetic-main");
  await manager.getServerStatus("synthetic-main");

  const minecraftStart = await manager.startServer("minecraft-main");
  await manager.validateWorld("minecraft-main", "celestial-castle");
  await manager.stopServer("minecraft-main");

  await manager.shutdown();

  const restarted = await bootstrapCore({
    minecraftServerDir: fixtureDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
  });

  const allOperations = await restarted.listOperations({ limit: 300 });
  assert.ok(allOperations.some((operation) => operation.operationId === syntheticStart.operationId));
  assert.ok(allOperations.some((operation) => operation.operationId === minecraftStart.operationId));

  const syntheticOperations = await restarted.listOperations({ providerId: "synthetic", serverId: "synthetic-main", limit: 100 });
  assert.ok(syntheticOperations.length >= 2);
  assert.ok(syntheticOperations.every((operation) => operation.providerId === "synthetic"));

  const minecraftOperations = await restarted.listOperations({ providerId: "minecraft", serverId: "minecraft-main", limit: 100 });
  assert.ok(minecraftOperations.length >= 2);
  assert.ok(minecraftOperations.every((operation) => operation.providerId === "minecraft"));

  const syntheticEvents = await restarted.listEvents({ providerId: "synthetic", serverId: "synthetic-main", limit: 200 });
  const syntheticStatusEvents = syntheticEvents.filter((event) => event.type === "server.status.changed");
  assert.ok(syntheticStatusEvents.some((event) => event.payload && (event.payload as { status?: string }).status === "online"));
  assert.ok(syntheticStatusEvents.some((event) => event.payload && (event.payload as { status?: string }).status === "offline"));

  const minecraftHistory = await restarted.getServerHistory("minecraft", "minecraft-main", 150);
  assert.ok(minecraftHistory.operations.every((operation) => operation.providerId === "minecraft"));
  assert.ok(minecraftHistory.events.every((event) => event.providerId === "minecraft" || event.providerId === undefined));
  assert.ok(minecraftHistory.audits.some((audit) => audit.action === "world.validation.requested"));

  const syntheticHistory = await restarted.getServerHistory("synthetic", "synthetic-main", 150);
  assert.ok(syntheticHistory.operations.every((operation) => operation.providerId === "synthetic"));
  assert.ok(syntheticHistory.events.every((event) => event.providerId === "synthetic" || event.providerId === undefined));
  assert.ok(syntheticHistory.audits.some((audit) => audit.action === "server.start.requested"));

  await restarted.shutdown();
});

class FailingEventRepository implements PersistenceRepository {
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
  async createOperation(): Promise<void> {}
  async updateOperation(): Promise<void> {}
  async getOperation() {
    return undefined;
  }
  async listOperations() {
    return [];
  }
  async appendEvent(): Promise<void> {
    throw new Error("Persistence appendEvent failed");
  }
  async listEvents() {
    return [];
  }
  async upsertServerState(): Promise<void> {}
  async listServerStates() {
    return [];
  }
  async appendAudit(): Promise<void> {}
  async listAudit() {
    return [];
  }
  async cleanupExpired() {
    return { operationsDeleted: 0, eventsDeleted: 0, auditDeleted: 0 };
  }
}

class MinimalProvider implements GameProvider {
  metadata(): ProviderMetadata {
    return { id: "failing", name: "Failing Test Provider", version: "0.0.1", status: "ready" };
  }

  getCapabilities() {
    return {
      "server.start": true,
      "server.stop": true,
      "server.restart": true,
      "world.list": true,
    };
  }

  async getDiagnostics(): Promise<ProviderDiagnostics> {
    return { paperDetected: false, geyserDetected: false };
  }

  async register(): Promise<void> {}

  async getServers() {
    return [{ id: "failing-main", providerId: "failing", name: "Failing Main" }];
  }

  async getServerStatus(): Promise<ServerStatus> {
    return { status: "offline", players: 0, uptimeSeconds: 0 };
  }

  async startServer() {
    return { simulated: true };
  }

  async stopServer() {
    return { simulated: true };
  }

  async restartServer() {
    return { simulated: true };
  }

  async getWorlds() {
    return [{ id: "w1", name: "w1", path: "synthetic://w1" }];
  }

  async validateWorld(): Promise<ValidationResult> {
    return { valid: true, missingPacks: [], invalidPacks: [], errors: [] };
  }
}

test("storage failure prevents silent success of provider operations", async () => {
  const manager = new InMemoryProviderManager({
    repository: new FailingEventRepository(),
  });

  await manager.initialize();
  await manager.register(new MinimalProvider());

  await assert.rejects(
    async () => {
      await manager.startServer("failing-main");
    },
    /Persistence appendEvent failed/,
  );

  await manager.shutdown();
});
