import fs from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";
import { bytesHash } from "../../packages/core/managed-create";
import type { RuntimeAttachmentPolicy } from "../../packages/core/runtime-attachment";
import type { ServerProvisioningRequest } from "../../packages/core/provisioning";
import { SqlitePersistenceRepository } from "../../packages/core/sqlite-repository";
import { InMemoryProviderManager } from "../../packages/provider-manager";
import { scopeRuntimeProvider } from "../../packages/provider-manager/scoped-runtime-provider";
import { MinecraftProvider } from "../../packages/minecraft-provider";
import { createAttachedJavaRuntime } from "../../packages/minecraft-provider/attached-runtime";
import { SyntheticProvider } from "../../packages/synthetic-provider";
import { createScopedSyntheticRuntime } from "../../packages/synthetic-provider/managed-create";

export async function managedFixture(t: TestContext, kind: "java" | "synthetic" = "java") {
  await fs.mkdir("tests/tmp", { recursive: true }); const base = await fs.mkdtemp(path.resolve("tests/tmp/managed-create-"));
  const root = path.join(base, "managed"), source = path.join(base, "source.jar"), java = path.join(base, "java.exe");
  await fs.mkdir(root); await fs.writeFile(source, "approved local Paper fixture, never execute"); await fs.writeFile(java, "approved Java fixture, never execute");
  const providerId = kind === "java" ? "minecraft" : "synthetic";
  const policy: RuntimeAttachmentPolicy = { hostId: "local", managedRoots: { root }, adoptionRoots: [], adoptionLocations: {}, artifactLocations: { paper: source, java }, endpointInventory: async () => ({ complete: true, bindings: [] }),
    managedCreate: { filesystem: "local-exclusive", profiles: { approved: kind === "java" ? { providerId, revision: "1", artifacts: [{ reference: "paper", sha256: bytesHash(await fs.readFile(source)) }], runtime: { reference: "java", sha256: bytesHash(await fs.readFile(java)), compatibility: "java-21" }, acceptanceRef: "prior-license", configuration: { bindAddress: "127.0.0.1", worldName: "managed-world" } } : { providerId, revision: "1", artifacts: [], configuration: { label: "neutral" } } },
      acceptances: { "prior-license": { revision: "1", actor: "explicit-operator", acceptedAt: "2026-10-14T09:00:00Z", termsRef: "operator-reviewed-terms", hostId: "local", profileId: "approved", profileRevision: "1", authorizeGeneratedAcceptance: true } } } };
  const request: ServerProvisioningRequest = { schemaVersion: 1, providerId, serverId: "managed-one", hostId: "local", storage: { mode: "create", rootId: "root", directoryName: "fresh" },
    endpoints: kind === "java" ? [{ id: "game", protocol: "java-paper", transport: "tcp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 27051 } }] : [{ id: "control", protocol: "synthetic-control", transport: "virtual" }], providerOptions: { profileRef: "approved" } };
  const managers: InMemoryProviderManager[] = []; let now = Date.parse("2026-10-14T10:00:00Z");
  const open = async () => {
    const repository = new SqlitePersistenceRepository({ filePath: path.join(base, "state.sqlite") });
    const manager = new InMemoryProviderManager({ repository }); await manager.initialize(); managers.push(manager);
    const provider = kind === "java" ? scopeRuntimeProvider(new MinecraftProvider({ serverDir: path.join(base, "legacy"), serverId: "legacy-java" }), createAttachedJavaRuntime) : scopeRuntimeProvider(new SyntheticProvider(), createScopedSyntheticRuntime);
    await manager.register(provider); return { repository, manager, provider };
  };
  t.after(async () => { for (const manager of managers) await manager.shutdown(); await fs.rm(base, { recursive: true, force: true }); });
  const options = { now: () => new Date(now), leaseMs: 1000, probe: async () => {} };
  return { base, root, source, java, policy, request, providerId, open, options, expire: () => { now += 2000; }, target: path.join(root, "fresh") };
}
