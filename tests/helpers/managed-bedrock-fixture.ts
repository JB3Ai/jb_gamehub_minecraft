import fs from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";
import { bytesHash, creationHash, type ApprovedRuntimeBundle } from "../../packages/core/managed-create";
import type { RuntimeAttachmentPolicy } from "../../packages/core/runtime-attachment";
import type { ServerProvisioningRequest } from "../../packages/core/provisioning";
import { SqlitePersistenceRepository } from "../../packages/core/sqlite-repository";
import { InMemoryProviderManager } from "../../packages/provider-manager";
import { scopeRuntimeProvider } from "../../packages/provider-manager/scoped-runtime-provider";
import { BedrockProvider } from "../../packages/bedrock-provider";
import { createAttachedBedrockRuntime } from "../../packages/bedrock-provider/attached-runtime";

/** Small, non-executable fixture bundle. No vendor binaries, real paths or real license record. */
export async function managedBedrockFixture(t: TestContext) {
  await fs.mkdir("tests/tmp", { recursive: true });
  const base = await fs.mkdtemp(path.resolve("tests/tmp/managed-bedrock-")), root = path.join(base, "managed"), source = path.join(base, "approved-source"), protectedRoot = path.join(base, "protected-install");
  await fs.mkdir(root); await fs.mkdir(source); await fs.mkdir(protectedRoot);
  const fixture = JSON.parse(await fs.readFile(new URL("../fixtures/managed-bedrock/bundle-files.json", import.meta.url), "utf8")) as Record<string, string>;
  const files: ApprovedRuntimeBundle["files"] = [];
  for (const relativePath of Object.keys(fixture).sort()) {
    const content = fixture[relativePath], location = path.join(source, relativePath);
    await fs.mkdir(path.dirname(location), { recursive: true }); await fs.writeFile(location, content);
    files.push({ relativePath, size: Buffer.byteLength(content), sha256: bytesHash(Buffer.from(content)), classification: relativePath === "server.properties" ? "protected-config" : "immutable-runtime" });
  }
  await fs.mkdir(path.join(source, "assets", "empty"));
  // Existing install state is deliberately outside the approved runtime inventory.
  await fs.mkdir(path.join(source, "worlds", "Bedrock level"), { recursive: true });
  await fs.writeFile(path.join(source, "worlds", "Bedrock level", "level.dat"), "must not be copied");
  const bundle: ApprovedRuntimeBundle = { schemaVersion: 1, runtimeKind: "native-bds", version: "1.26.51.1", platform: "win32", architecture: "x64", transport: "raknet", sourceRef: "bundle-source", entrypoint: "bedrock_server.exe", files,
    directories: ["assets/empty"], runtimeOutputs: [{ relativePath: "worlds", kind: "directory" }], limits: { maxFiles: 64, maxDepth: 8, maxFileBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 } };
  const digest = creationHash(bundle);
  const policy: RuntimeAttachmentPolicy = { hostId: "local", managedRoots: { root }, adoptionRoots: [], adoptionLocations: {}, artifactLocations: {}, protectedPaths: [protectedRoot], endpointInventory: async () => ({ complete: true, bindings: [] }),
    managedCreate: { filesystem: "local-exclusive", bundleLocations: { "bundle-source": source }, bundles: { "approved-bds": bundle }, profiles: { "bedrock-raknet-approved": { providerId: "minecraft-bedrock", revision: "1", artifacts: [], bundle: { reference: "approved-bds", digest }, acceptanceRef: "bds-license", configuration: { runtimeKind: "native-bds", compatibility: "bds-1.26.51.1-raknet-v1", transport: "raknet", bundleVersion: "1.26.51.1", worldName: "managed-bedrock-world", additionalDefaults: { difficulty: "easy" } } } },
      acceptances: { "bds-license": { revision: "1", actor: "test-only-operator", acceptedAt: "2026-10-14T09:00:00Z", termsRef: "test-only-terms-not-real-authorization", hostId: "local", profileId: "bedrock-raknet-approved", profileRevision: "1", serverId: "bedrock-022g-test", providerId: "minecraft-bedrock", bundleDigest: digest, authorizeGeneratedAcceptance: true } } } };
  const request: ServerProvisioningRequest = { schemaVersion: 1, providerId: "minecraft-bedrock", serverId: "bedrock-022g-test", hostId: "local", storage: { mode: "create", rootId: "root", directoryName: "fresh" },
    endpoints: [{ id: "game-v4", protocol: "native-bds", transport: "udp", bindAddress: "0.0.0.0", port: { mode: "fixed", value: 29232 } }, { id: "game-v6", protocol: "native-bds", transport: "udp", bindAddress: "::", port: { mode: "fixed", value: 29233 } }], providerOptions: { profileRef: "bedrock-raknet-approved" } };
  const managers: InMemoryProviderManager[] = []; let now = Date.parse("2026-10-16T10:00:00Z");
  const open = async () => {
    const repository = new SqlitePersistenceRepository({ filePath: path.join(base, "state.sqlite") });
    const manager = new InMemoryProviderManager({ repository }); await manager.initialize(); managers.push(manager);
    const provider = scopeRuntimeProvider(new BedrockProvider({ serverDir: protectedRoot, serverId: "legacy-bedrock" }), createAttachedBedrockRuntime);
    await manager.register(provider); return { repository, manager, provider };
  };
  t.after(async () => { for (const manager of managers) await manager.shutdown(); await fs.rm(base, { recursive: true, force: true }); });
  const options = { now: () => new Date(now), leaseMs: 1000, probe: async () => {} };
  const repin = () => { const digest = creationHash(bundle); policy.managedCreate!.profiles["bedrock-raknet-approved"].bundle!.digest = digest; policy.managedCreate!.acceptances["bds-license"].bundleDigest = digest; };
  return { base, root, source, protectedRoot, bundle, policy, request, open, options, repin, expire: () => { now += 2000; }, target: path.join(root, "fresh") };
}
