import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import childProcess from "node:child_process";
import net from "node:net";
import dgram from "node:dgram";
import { createHash } from "node:crypto";
import { SqlitePersistenceRepository } from "../packages/core/sqlite-repository";
import { RuntimeAttachmentService, type RuntimeAttachmentHooks } from "../packages/core/runtime-attachment-service";
import { ProvisioningApplyException, ProvisioningInterrupted } from "../packages/core/provisioning-apply-contracts";
import type { RuntimeAttachmentPolicy } from "../packages/core/runtime-attachment";
import type { ServerProvisioningRequest } from "../packages/core/provisioning";
import { JavaProvisioningPlanner } from "../packages/minecraft-provider/provisioning";
import { BedrockProvisioningPlanner } from "../packages/bedrock-provider/provisioning";
import { JavaRuntimeAttachments } from "../packages/minecraft-provider/runtime-attachment";
import { BedrockRuntimeAttachments } from "../packages/bedrock-provider/runtime-attachment";
import { MinecraftProvider } from "../packages/minecraft-provider";
import { BedrockProvider } from "../packages/bedrock-provider";
import { InMemoryProviderManager } from "../packages/provider-manager";

const latch = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
const hasCode = (code: string) => (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === code;
async function fixture(t: TestContext, kind: "java" | "bedrock" = "bedrock") {
  await fsp.mkdir("tests/tmp", { recursive: true }); const base = await fsp.mkdtemp(path.resolve("tests/tmp/attachment-"));
  const root = path.join(base, "runtime"); await fsp.mkdir(root);
  const artifact = kind === "java" ? "paper.jar" : "bedrock_server.exe";
  const world = kind === "java" ? "Unique Java World" : "worlds/Unique Bedrock World";
  await fsp.mkdir(path.join(root, world), { recursive: true });
  await fsp.writeFile(path.join(root, artifact), "fixture executable bytes only");
  await fsp.writeFile(path.join(base, "java.exe"), "fixture Java reference only");
  const configuration = kind === "java" ? "server-port=25565\nserver-ip=\nlevel-name=Unique Java World\n" : "server-port=19132\nserver-portv6=19133\nlevel-name=Unique Bedrock World\n";
  await fsp.writeFile(path.join(root, "server.properties"), configuration);
  const planner = kind === "java" ? new JavaProvisioningPlanner() : new BedrockProvisioningPlanner();
  const request: ServerProvisioningRequest = { schemaVersion: 1, providerId: kind === "java" ? "minecraft" : "minecraft-bedrock", serverId: "attached-one", hostId: "test-host", storage: { mode: "adopt", locationRef: "runtime" }, endpoints: JSON.parse(JSON.stringify(planner.profileAdapter!.profile().defaultEndpoints)), ...(kind === "java" ? { providerOptions: { javaRuntimeRef: "java" } } : {}) };
  if (kind === "bedrock") request.endpoints.push({ id: "game-v6", protocol: "native-bds", transport: "udp", bindAddress: "::", port: { mode: "fixed", value: 19133 } });
  const policy: RuntimeAttachmentPolicy = { hostId: "test-host", managedRoots: {}, adoptionRoots: [base], adoptionLocations: { runtime: root }, artifactLocations: { java: path.join(base, "java.exe") }, endpointInventory: async () => ({ complete: true, bindings: [] }) };
  const repositories: SqlitePersistenceRepository[] = []; let time = Date.parse("2026-10-05T10:00:00Z");
  const open = async () => { const repo = new SqlitePersistenceRepository({ filePath: path.join(base, "state.sqlite") }); await repo.initialize(); repositories.push(repo); return repo; };
  const worker = (repo: SqlitePersistenceRepository, hooks: RuntimeAttachmentHooks = {}) => {
    const adapter = kind === "java" ? new JavaRuntimeAttachments() : new BedrockRuntimeAttachments();
    return { adapter, service: new RuntimeAttachmentService(repo.provisioning, planner, adapter, { now: () => new Date(time), leaseMs: 1000, hooks }) };
  };
  t.after(async () => { for (const repo of repositories) await repo.close(); await fsp.rm(base, { recursive: true, force: true }); });
  return { base, root, artifact, configuration, planner, request, policy, open, worker, expire: () => { time += 2000; } };
}
for (const kind of ["java", "bedrock"] as const) test(`${kind} attachment verifies immutable manifests and replays after repository/provider restart`, async (t) => {
  const f = await fixture(t, kind); let repo = await f.open(); let worker = f.worker(repo);
  const plan = await f.planner.plan(f.request); const preview = await worker.service.preview(plan, f.policy);
  assert.ok(Object.isFrozen(preview.descriptor.manifest)); assert.equal(preview.descriptor.ownership, "ADOPTED"); assert.equal(preview.descriptor.destructiveOwnership, false);
  assert.equal(preview.descriptor.manifest.find((item) => item.name === "runtime")?.observedHash, createHash("sha256").update("fixture executable bytes only").digest("hex"));
  assert.deepEqual(JSON.parse(JSON.stringify(preview.descriptor)), preview.descriptor); assert.equal(preview.descriptor.worlds.length, 1);
  const result = await worker.service.attach({ ...preview, approved: true }, f.policy, "admin"); assert.equal(result.result.state, "PROVISIONED");
  assert.equal(worker.adapter.list().length, 1); assert.equal(repo.provisioning.attachmentRecords().length, 1);
  const journal = repo.provisioning.journal(result.operationId);
  assert.deepEqual(await worker.service.attach({ ...preview, approved: true }, f.policy, "admin"), result);
  assert.deepEqual(repo.provisioning.journal(result.operationId), journal);
  await repo.close(); repo = await f.open(); worker = f.worker(repo);
  assert.deepEqual(await worker.service.recover(result.operationId, f.policy), result); assert.equal(worker.adapter.list().length, 1);
  assert.equal((await repo.getOperation(result.operationId))?.type, "server.provision.attach");
  assert.ok((await repo.listAudit({ operationId: result.operationId })).length > 0);
});

test("unapproved roots, traversal, protected/managed overlap and junctions are rejected", async (t) => {
  const f = await fixture(t); const worker = f.worker(await f.open()); const plan = await f.planner.plan(f.request);
  await assert.rejects(worker.service.preview(plan, { ...f.policy, adoptionRoots: [] }), /outside approved/);
  await assert.rejects(worker.service.preview(plan, { ...f.policy, adoptionLocations: { runtime: path.join(f.root, "..", "runtime") + path.sep + ".." + path.sep + "runtime" } }), /traversal/);
  await assert.rejects(worker.service.preview(plan, { ...f.policy, protectedPaths: [f.root] }), /protected/i);
  await assert.rejects(worker.service.preview(plan, { ...f.policy, managedRoots: { occupied: f.base } }), /managed or protected/);
  await fsp.symlink(f.root, path.join(f.base, "alias"), "junction");
  await assert.rejects(worker.service.preview(plan, { ...f.policy, adoptionLocations: { runtime: path.join(f.base, "alias") } }), /[Ss]ymlink|junction/);
});
for (const kind of ["java", "bedrock"] as const) test(`${kind} rejects missing/wrong-type executable and configuration`, async (t) => {
  const f = await fixture(t, kind); const worker = f.worker(await f.open()); const plan = await f.planner.plan(f.request);
  await fsp.unlink(path.join(f.root, f.artifact)); await assert.rejects(worker.service.preview(plan, f.policy), /ARTIFACT_UNAVAILABLE/);
  await fsp.mkdir(path.join(f.root, f.artifact)); await assert.rejects(worker.service.preview(plan, f.policy), /ARTIFACT_UNAVAILABLE/);
  await fsp.rmdir(path.join(f.root, f.artifact)); await fsp.writeFile(path.join(f.root, f.artifact), "fixture");
  await fsp.unlink(path.join(f.root, "server.properties")); await assert.rejects(worker.service.preview(plan, f.policy), /ARTIFACT_UNAVAILABLE/);
});
test("Java runtime reference is required and verified without executing it", async (t) => {
  const f = await fixture(t, "java"); const worker = f.worker(await f.open());
  const plan = await f.planner.plan(f.request); await fsp.unlink(f.policy.artifactLocations.java);
  await assert.rejects(worker.service.preview(plan, f.policy), /ARTIFACT_UNAVAILABLE/);
});
test("expected hashes, changed artifacts, unsafe world paths and endpoint mismatch block attachment", async (t) => {
  const f = await fixture(t); const worker = f.worker(await f.open()); const plan = await f.planner.plan(f.request);
  await assert.rejects(worker.service.preview(plan, { ...f.policy, expectedHashes: { runtime: "0".repeat(64) } }), /Hash mismatch/);
  const preview = await worker.service.preview(plan, f.policy);
  await fsp.appendFile(path.join(f.root, f.artifact), "changed");
  await assert.rejects(worker.service.attach({ ...preview, approved: true }, f.policy, "admin"), hasCode("ARTIFACT_DRIFT"));
  await fsp.writeFile(path.join(f.root, "server.properties"), f.configuration.replace("19132", "19140"));
  await assert.rejects(worker.service.preview(plan, f.policy), /endpoints do not match/);
  await fsp.writeFile(path.join(f.root, "server.properties"), f.configuration.replace("Unique Bedrock World", "../../escape"));
  await assert.rejects(worker.service.preview(plan, f.policy), /Unsafe artifact/);
});
for (const conflict of ["server", "root", "nested", "endpoint"] as const) test(`${conflict} attachment conflict is exclusive across database connections`, async (t) => {
  const f = await fixture(t); const repo = await f.open(); const first = f.worker(repo); const second = f.worker(await f.open());
  const input = await first.service.preview(await f.planner.plan(f.request), f.policy);
  const winner = await first.service.attach({ ...input, approved: true }, f.policy, "admin");
  const secondRoot = conflict === "nested" ? path.join(f.root, "child-runtime") : path.join(f.base, "second");
  await fsp.mkdir(secondRoot); await fsp.writeFile(path.join(secondRoot, f.artifact), "fixture executable bytes only");
  const secondConfiguration = conflict === "endpoint" ? f.configuration : f.configuration.replace("19132", "20132").replace("19133", "20133");
  await fsp.writeFile(path.join(secondRoot, "server.properties"), secondConfiguration);
  const request = JSON.parse(JSON.stringify(f.request)) as ServerProvisioningRequest; request.serverId = conflict === "server" ? f.request.serverId : "attached-second"; request.storage = { mode: "adopt", locationRef: "second" };
  if (conflict !== "root" && conflict !== "endpoint") for (const endpoint of request.endpoints) if (endpoint.transport !== "virtual" && endpoint.port.mode === "fixed") endpoint.port.value += 1000;
  const policy = { ...f.policy, adoptionLocations: { second: conflict === "root" ? f.root : secondRoot } };
  const preview = await second.service.preview(await f.planner.plan(request), policy);
  const loser = await second.service.attach({ ...preview, approved: true }, policy, "admin");
  assert.equal(loser.result.state, "ROLLED_BACK"); assert.equal(loser.error?.code, "RESOURCE_CONFLICT"); assert.equal(loser.error?.ownerOperationId, winner.operationId);
  assert.equal(repo.provisioning.attachmentRecords().length, 1); assert.equal(repo.provisioning.claims(loser.operationId).filter((claim) => claim.state === "active").length, 0);
});

test("rollback after attachment removes references only and preserves external bytes", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const worker = f.worker(repo, { afterProviderAttach: async () => { throw new Error("injected failure"); } });
  const before = await fsp.readFile(path.join(f.root, f.artifact));
  const preview = await worker.service.preview(await f.planner.plan(f.request), f.policy);
  const result = await worker.service.attach({ ...preview, approved: true }, f.policy, "admin");
  assert.equal(result.result.state, "ROLLED_BACK"); assert.equal(worker.adapter.list().length, 0); assert.equal(repo.provisioning.attachmentRecords().length, 0);
  assert.equal(repo.provisioning.attachmentIntent(result.operationId)?.state, "ROLLED_BACK");
  assert.deepEqual(await fsp.readFile(path.join(f.root, f.artifact)), before); assert.equal(await fsp.readFile(path.join(f.root, "server.properties"), "utf8"), f.configuration);
});
for (const boundary of ["afterClaims", "afterRecord", "afterProviderAttach", "afterReceipt"] as const) test(`restart reconciles crash at ${boundary}`, async (t) => {
  const f = await fixture(t); let repo = await f.open(); let worker = f.worker(repo, { [boundary]: async () => { throw new ProvisioningInterrupted(boundary); } });
  const preview = await worker.service.preview(await f.planner.plan(f.request), f.policy); const id = `attach_${preview.plan.planId}`;
  await assert.rejects(worker.service.attach({ ...preview, approved: true }, f.policy, "admin"), ProvisioningInterrupted);
  assert.equal(repo.provisioning.attachmentRecords().length, boundary === "afterClaims" ? 0 : 1);
  assert.equal(Boolean(repo.provisioning.attachmentIntent(id)?.receipt), boundary === "afterReceipt");
  await repo.close(); repo = await f.open(); worker = f.worker(repo); f.expire();
  const result = await worker.service.recover(id, f.policy); assert.equal(result.result.state, "PROVISIONED");
  assert.equal(repo.provisioning.attachmentRecords().length, 1); assert.equal(worker.adapter.list().length, 1);
  assert.equal(repo.provisioning.attachmentIntent(id)?.receipt?.reconciled, boundary !== "afterClaims");
  assert.equal(repo.provisioning.claims(id).filter((claim) => claim.state === "active").length, 4);
});
test("stale worker is fenced before provider attachment after recovery", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const reached = latch(); const release = latch();
  const old = f.worker(repo, { afterRecord: async () => { reached.release(); await release.promise; } });
  const preview = await old.service.preview(await f.planner.plan(f.request), f.policy);
  const pending = old.service.attach({ ...preview, approved: true }, f.policy, "admin"); await reached.promise; f.expire();
  const current = f.worker(await f.open()); const recovered = await current.service.recover(`attach_${preview.plan.planId}`, f.policy);
  assert.equal(recovered.result.state, "PROVISIONED"); release.release(); await assert.rejects(pending, hasCode("LEASE_LOST"));
  assert.equal(old.adapter.list().length, 0); assert.equal(current.adapter.list().length, 1); assert.equal(repo.provisioning.attachmentRecords().length, 1);
});
test("providers advertise attach only and manager exposes durable records without lifecycle changes", async (t) => {
  const f = await fixture(t); const repo = await f.open(); await repo.close(); const manager = new InMemoryProviderManager({ repository: repo }); await manager.initialize();
  try {
    const provider = new BedrockProvider(); await manager.register(provider);
    for (const p of [provider, new MinecraftProvider({ serverDir: "unused" })]) { assert.equal(p.getCapabilities()["server.provision.attach"], true); assert.equal(p.getCapabilities()["server.provision.apply"], undefined); }
    const before = await manager.listServers(); const preview = await manager.previewRuntimeAttachment(await f.planner.plan(f.request), f.policy);
    const result = await manager.attachRuntime({ ...preview, approved: true }, f.policy);
    assert.equal(manager.listRuntimeAttachments().length, 1); assert.equal(provider.runtimeAttachments.list().length, 1);
    assert.equal((await manager.getOperation(result.operationId))?.type, "server.provision.attach");
    assert.deepEqual(await manager.listServers(), before);
  } finally { await manager.shutdown(); }
});
test("attachment performs no runtime writes, deletions, network binding or process spawning", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const worker = f.worker(repo); const plan = await f.planner.plan(f.request);
  const fail = () => { throw new Error("Unexpected runtime mutation"); };
  try {
    for (const name of ["mkdir", "writeFile", "appendFile", "copyFile", "rename", "rm", "unlink"] as const) t.mock.method(fsp, name, fail);
    for (const name of ["mkdirSync", "writeFileSync", "appendFileSync", "copyFileSync", "renameSync", "rmSync", "unlinkSync"] as const) t.mock.method(fs, name, fail);
    for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"] as const) t.mock.method(childProcess, name, fail);
    t.mock.method(net.Server.prototype, "listen", fail); t.mock.method(dgram.Socket.prototype, "bind", fail);
    const preview = await worker.service.preview(plan, f.policy); assert.equal((await worker.service.attach({ ...preview, approved: true }, f.policy, "admin")).result.state, "PROVISIONED");
    assert.equal(await fsp.readFile(path.join(f.root, "server.properties"), "utf8"), f.configuration);
  } finally { t.mock.restoreAll(); }
});

test("recovery detects artifact drift after record publication and rolls back references safely", async (t) => {
  const f = await fixture(t); let repo = await f.open(); let worker = f.worker(repo, { afterRecord: async () => { throw new ProvisioningInterrupted("crash"); } });
  const preview = await worker.service.preview(await f.planner.plan(f.request), f.policy);
  await assert.rejects(worker.service.attach({ ...preview, approved: true }, f.policy, "admin"), ProvisioningInterrupted);
  await fsp.appendFile(path.join(f.root, f.artifact), "operator changed artifact");
  const changed = await fsp.readFile(path.join(f.root, f.artifact)); await repo.close(); repo = await f.open(); worker = f.worker(repo); f.expire();
  const result = await worker.service.recover(`attach_${preview.plan.planId}`, f.policy);
  assert.equal(result.result.state, "ROLLED_BACK"); assert.equal(repo.provisioning.attachmentRecords().length, 0);
  assert.equal(repo.provisioning.claims(result.operationId).filter((claim) => claim.state === "active").length, 0);
  assert.deepEqual(await fsp.readFile(path.join(f.root, f.artifact)), changed);
});

test("changed manifest cannot reuse a completed attachment identity", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const worker = f.worker(repo); const plan = await f.planner.plan(f.request);
  const preview = await worker.service.preview(plan, f.policy); await worker.service.attach({ ...preview, approved: true }, f.policy, "admin");
  await fsp.appendFile(path.join(f.root, f.artifact), "replacement"); const changed = await worker.service.preview(plan, f.policy);
  await assert.rejects(worker.service.attach({ ...changed, approved: true }, f.policy, "admin"), hasCode("APPROVAL_MISMATCH"));
  assert.equal(repo.provisioning.attachmentRecords().length, 1);
});

test("unreadable artifact rejects verification and missing optional world remains explicit", async (t) => {
  const f = await fixture(t); const worker = f.worker(await f.open()); const plan = await f.planner.plan(f.request);
  t.mock.method(fsp, "open", async () => { throw Object.assign(new Error("fixture access denied"), { code: "EACCES" }); });
  try { await assert.rejects(worker.service.preview(plan, f.policy), /access denied/); } finally { t.mock.restoreAll(); }
  await fsp.rmdir(path.join(f.root, "worlds/Unique Bedrock World"));
  const preview = await worker.service.preview(plan, f.policy);
  assert.ok(preview.descriptor.manifest.some((artifact) => artifact.verification === "missing-optional"));
  assert.deepEqual(preview.descriptor.worlds, []);
});

test("concurrent attachments cannot both claim the same runtime root", async (t) => {
  const f = await fixture(t); const leftRepo = await f.open(); const reached = latch(); const release = latch();
  const first = f.worker(leftRepo, { afterClaims: async () => { reached.release(); await release.promise; } });
  const second = f.worker(await f.open());
  const left = await first.service.preview(await f.planner.plan(f.request), f.policy);
  const right = await second.service.preview(await f.planner.plan({ ...f.request, serverId: "second-contender" }), f.policy);
  const running = first.service.attach({ ...left, approved: true }, f.policy, "admin"); await reached.promise;
  try {
    const loser = await second.service.attach({ ...right, approved: true }, f.policy, "admin");
    assert.equal(loser.error?.code, "RESOURCE_CONFLICT"); assert.equal(loser.result.state, "ROLLED_BACK");
  } finally { release.release(); }
  assert.equal((await running).result.state, "PROVISIONED"); assert.equal(leftRepo.provisioning.attachmentRecords().length, 1);
});

test("unsupported property syntax cannot hide configured listener ports", async (t) => {
  const f = await fixture(t, "java"); const worker = f.worker(await f.open()); const plan = await f.planner.plan(f.request);
  await fsp.writeFile(path.join(f.root, "server.properties"), f.configuration.replace("server-port=25565", "server-port:25566"));
  await assert.rejects(worker.service.preview(plan, f.policy), /key=value/);
  await fsp.writeFile(path.join(f.root, "server.properties"), f.configuration + "enable-rcon=TRUE\n");
  await assert.rejects(worker.service.preview(plan, f.policy), /auxiliary Java listeners/);
});
