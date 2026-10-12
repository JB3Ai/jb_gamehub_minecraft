import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import dgram from "node:dgram";
import { createHash } from "node:crypto";
import { attachmentAcceptanceConfig, attachmentAcceptanceEndpoint } from "./attachment-acceptance-config";
import { canonicalAttachmentPath, pathContains } from "../../../packages/core/runtime-attachment-verification";
import { InMemoryProviderManager } from "../../../packages/provider-manager";
import { SqlitePersistenceRepository } from "../../../packages/core/sqlite-repository";
import { scopeRuntimeProvider, waitForRuntimeStopped } from "../../../packages/provider-manager/scoped-runtime-provider";
import { MinecraftProvider } from "../../../packages/minecraft-provider";
import { BedrockProvider } from "../../../packages/bedrock-provider";
import { createAttachedJavaRuntime } from "../../../packages/minecraft-provider/attached-runtime";
import { createAttachedBedrockRuntime } from "../../../packages/bedrock-provider/attached-runtime";
import type { RuntimeAttachmentPolicy } from "../../../packages/core/runtime-attachment";

async function assertEndpointFree(transport: "tcp" | "udp", port: number, address: string) {
  if (transport === "tcp") {
    const socket = net.createServer();
    await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(port, address, () => socket.close((error) => error ? reject(error) : resolve())); });
  } else {
    const socket = dgram.createSocket(address.includes(":") ? "udp6" : "udp4");
    await new Promise<void>((resolve, reject) => {
      socket.once("error", (error) => { socket.close(); reject(error); });
      socket.bind(port, address, () => socket.close(() => resolve()));
    });
  }
}
async function main() {
  const config = attachmentAcceptanceConfig(process.argv[2], process.env);
  const root = await canonicalAttachmentPath(config.root);
  const markerPath = await canonicalAttachmentPath(path.join(root, ".jbgh-022f-acceptance.json"));
  const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
  if (marker.purpose !== "JBGH-022F" || marker.allowStartStop !== true || marker.allowWorldWrites !== true || path.resolve(marker.runtimeRoot ?? "") !== root) throw new Error("Runtime-bound approval marker with explicit world-write acknowledgement required.");
  const transport = config.kind === "java" ? "tcp" : "udp";
  const endpoint = await attachmentAcceptanceEndpoint(config, async () => {
    const propertiesPath = await canonicalAttachmentPath(path.join(root, "server.properties"));
    return fs.readFile(propertiesPath, "utf8");
  });
  await assertEndpointFree(transport, endpoint.port, endpoint.bindAddress);
  if (config.ipv6Port) await assertEndpointFree("udp", config.ipv6Port, "::");
  const evidenceParent = await canonicalAttachmentPath(path.dirname(config.evidence));
  if (pathContains(root, evidenceParent)) throw new Error("Evidence parent resolves inside the source runtime.");
  await fs.mkdir(config.evidence, { recursive: true });
  const evidenceRoot = await canonicalAttachmentPath(config.evidence);
  if (pathContains(root, evidenceRoot) || pathContains(evidenceRoot, root)) throw new Error("Canonical evidence directory overlaps source runtime.");
  const providerId = config.kind === "java" ? "minecraft" : "minecraft-bedrock";
  const manager = new InMemoryProviderManager({ repository: new SqlitePersistenceRepository({ filePath: path.join(evidenceRoot, `acceptance-${Date.now()}.sqlite`) }), defaultActor: "explicit-runtime-acceptance" });
  const evidence: Record<string, unknown> = { milestone: "JBGH-022F", providerId, serverId: config.serverId, live: true, playerAcceptance: false, status: "FAILED", startedAt: new Date().toISOString(), events: [] };
  let started = false;
  await manager.initialize();
  try {
    const base = config.kind === "java" ? new MinecraftProvider({ serverDir: root, serverId: "acceptance-unattached-default", javaPort: config.port }) : new BedrockProvider({ serverId: "acceptance-unattached-default" });
    await manager.register(scopeRuntimeProvider(base, config.kind === "java" ? createAttachedJavaRuntime : createAttachedBedrockRuntime));
    manager.onEvent((event) => (evidence.events as unknown[]).push(event));
    const policy: RuntimeAttachmentPolicy = { hostId: "acceptance-host", managedRoots: {}, adoptionRoots: [root], adoptionLocations: { runtime: root }, artifactLocations: config.java ? { java: config.java } : {} };
    const endpoints = [{ id: "game", protocol: config.kind === "java" ? "java-paper" : "native-bds", transport, bindAddress: endpoint.bindAddress, port: { mode: "fixed" as const, value: endpoint.port } }];
    if (config.ipv6Port) endpoints.push({ id: "game-v6", protocol: "native-bds", transport: "udp", bindAddress: "::", port: { mode: "fixed", value: config.ipv6Port } });
    const plan = await manager.planProvisioning({ schemaVersion: 1, providerId, serverId: config.serverId, hostId: "acceptance-host", storage: { mode: "adopt", locationRef: "runtime" }, endpoints, providerOptions: { artifactFile: config.artifact, ...(config.java ? { javaRuntimeRef: "java" } : {}) } });
    const preview = await manager.previewRuntimeAttachment(plan, policy);
    const result = await manager.attachRuntime({ ...preview, approved: true }, policy);
    if (result.result.state !== "PROVISIONED") throw new Error("Attachment did not complete.");
    evidence.attachmentOperation = result.operationId;
    evidence.initialStatus = await manager.getServerStatus(config.serverId, providerId);
    if ((evidence.initialStatus as { status: string }).status !== "offline") throw new Error("Acceptance requires an initially stopped test runtime.");
    const operation = await manager.startServer(config.serverId, providerId); if (operation.status !== "completed") throw new Error("Start dispatch failed; inspect persisted operation."); started = true;
    const deadline = Date.now() + 120_000;
    while ((await manager.getServerStatus(config.serverId, providerId)).status !== "online") {
      if (Date.now() > deadline) throw new Error("Runtime readiness deadline exceeded.");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    evidence.endpoints = await manager.getServerConnectionEndpoints(config.serverId, providerId);
    const worlds = await manager.getWorlds(config.serverId, providerId); evidence.worlds = worlds.map(({ id, name }) => ({ id, name }));
    if (!worlds.length) throw new Error("Provider discovered no worlds.");
    const stop = await manager.stopServer(config.serverId, providerId); if (stop.status !== "completed") throw new Error("Stop dispatch failed.");
    await waitForRuntimeStopped(manager.getProvider(providerId), config.serverId); started = false;
    for (const artifact of preview.descriptor.manifest.filter((item) => item.relativePath && item.artifactType === "file")) {
      const bytes = await fs.readFile(path.join(root, artifact.relativePath!));
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.observedHash) throw new Error(`Source artifact changed during acceptance: ${artifact.name}`);
    }
    for (const world of worlds) await fs.access(world.path);
    evidence.sourceArtifactsIntact = true; evidence.finalStatus = await manager.getServerStatus(config.serverId, providerId); evidence.status = "PASS";
  } catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
  finally {
    if (started) {
      try {
        const stopped = await manager.stopServer(config.serverId, providerId);
        if (stopped.status !== "completed") throw new Error("Cleanup stop dispatch failed.");
        await waitForRuntimeStopped(manager.getProvider(providerId), config.serverId); evidence.cleanupStopped = true;
      } catch (error) { evidence.cleanupError = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
    }
    evidence.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(evidenceRoot, `attachment-${config.kind}-${Date.now()}.json`), JSON.stringify(evidence, null, 2));
    await manager.shutdown();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
