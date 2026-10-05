import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { SqlitePersistenceRepository } from "../packages/core/sqlite-repository";
import { ProvisioningApplyService } from "../packages/core/provisioning-apply-service";
import { ProvisioningApplyException, ProvisioningInterrupted, provisioningDigest, type ProvisioningApplyRequest } from "../packages/core/provisioning-apply-contracts";
import { SyntheticProvisioningPlanner } from "../packages/synthetic-provider/provisioning";
import type { SyntheticApplyHooks } from "../packages/synthetic-provider/provisioning-executor";
import type { ServerProvisioningRequest } from "../packages/core/provisioning";
import { InMemoryProviderManager } from "../packages/provider-manager";
import { SyntheticProvider } from "../packages/synthetic-provider";
import { BedrockProvider } from "../packages/bedrock-provider";
import { MinecraftProvider } from "../packages/minecraft-provider";

const request = (name = "one", transport: "tcp" | "udp" = "udp", port = 19132): ServerProvisioningRequest => ({ schemaVersion: 1, providerId: "synthetic", serverId: `server-${name}`, displayName: name, hostId: "test-host", storage: { mode: "create", rootId: "test-root", directoryName: name }, endpoints: [{ id: "game", protocol: "synthetic-game", transport, bindAddress: "127.0.0.1", port: { mode: "fixed", value: port } }] });
const approve = async (planner: SyntheticProvisioningPlanner, input = request()): Promise<ProvisioningApplyRequest> => { const plan = await planner.plan(input); return { plan, approved: true, digest: provisioningDigest(plan) }; };
const code = (expected: string) => (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === expected;
const latch = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
async function fixture(t: TestContext) {
  await fsp.mkdir("tests/tmp", { recursive: true }); const root = await fsp.mkdtemp(path.resolve("tests/tmp/apply-"));
  const repositories: SqlitePersistenceRepository[] = []; const filePath = path.join(root, "state.sqlite");
  let milliseconds = Date.parse("2026-10-04T10:00:00Z"); const now = () => new Date(milliseconds);
  const open = async () => { const repo = new SqlitePersistenceRepository({ filePath }); await repo.initialize(); repositories.push(repo); return repo; };
  const service = (repo: SqlitePersistenceRepository, hooks: SyntheticApplyHooks = {}) => {
    const planner = new SyntheticProvisioningPlanner("synthetic", now, hooks);
    return { planner, apply: new ProvisioningApplyService(repo.provisioning, planner, planner.executor, { now, leaseMs: 1000 }) };
  };
  t.after(async () => { for (const repo of repositories) await repo.close(); await fsp.rm(root, { recursive: true, force: true }); });
  return { root, open, service, now, expire: () => { milliseconds += 2000; } };
}

test("synthetic apply persists plan, resources, claims, journal and existing history after restart", async (t) => {
  const f = await fixture(t); let repo = await f.open(); let worker = f.service(repo); const input = await approve(worker.planner); const original = JSON.stringify(input.plan);
  const first = await worker.apply.apply(input, "test-admin");
  assert.equal(first.result.state, "PROVISIONED"); assert.equal(first.result.outcome, "applied"); assert.equal(JSON.stringify(input.plan), original);
  assert.equal(repo.provisioning.claims(first.operationId).filter((c) => c.state === "active").length, 3);
  assert.equal(repo.provisioning.effects(first.operationId).length, 6);
  assert.equal(repo.provisioning.journal(first.operationId).filter((e) => e.status === "completed" && e.step === "06-registration").length, 1);
  assert.equal((await repo.getOperation(first.operationId))?.status, "completed");
  assert.ok((await repo.listAudit({ operationId: first.operationId })).length >= 3);
  assert.ok((await repo.listEvents({ operationId: first.operationId })).some((e) => e.type === "operation.completed"));
  const journal = repo.provisioning.journal(first.operationId);
  await repo.close(); repo = await f.open(); worker = f.service(repo);
  assert.deepEqual(await worker.apply.apply(input, "another-admin"), first);
  assert.deepEqual(await worker.apply.recover(first.operationId), first);
  assert.deepEqual(repo.provisioning.journal(first.operationId), journal);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(repo.provisioning.listIncomplete().length, 0);
});

for (const resource of ["server", "path", "endpoint"] as const) test(`concurrent ${resource} claim permits exactly one winner across repository connections`, async (t) => {
  const f = await fixture(t); const leftRepo = await f.open(); const rightRepo = await f.open();
  const barrier = latch(); let waiting = 0;
  const hooks: SyntheticApplyHooks = { beforeStep: async (step) => { if (step.id === "01-claim-server") { if (++waiting === 2) barrier.release(); await barrier.promise; } } };
  const left = f.service(leftRepo, hooks); const right = f.service(rightRepo, hooks);
  const a = request("a", "udp", 20001); const b = request("b", "udp", 20002);
  if (resource === "server") b.serverId = a.serverId;
  if (resource === "path") b.storage = a.storage;
  if (resource === "endpoint") b.endpoints = a.endpoints;
  const results = await Promise.all([left.apply.apply(await approve(left.planner, a), "admin"), right.apply.apply(await approve(right.planner, b), "admin")]);
  const winner = results.find((r) => r.result.state === "PROVISIONED")!; const loser = results.find((r) => r.result.state === "ROLLED_BACK")!;
  assert.ok(winner); assert.ok(loser); assert.equal(loser.error?.code, "RESOURCE_CONFLICT"); assert.equal(loser.error?.ownerOperationId, winner.operationId);
  assert.equal(leftRepo.provisioning.claims().filter((c) => c.state === "active").length, 3);
  assert.equal(leftRepo.provisioning.effects(loser.operationId).length, 0);
});

test("TCP and UDP share numeric ports; wildcard/specific bindings share conservative same-transport claims", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const worker = f.service(repo);
  assert.equal((await worker.apply.apply(await approve(worker.planner, request("tcp", "tcp")), "admin")).result.state, "PROVISIONED");
  assert.equal((await worker.apply.apply(await approve(worker.planner, request("udp", "udp")), "admin")).result.state, "PROVISIONED");
  const wild = request("wild", "udp"); (wild.endpoints[0] as { bindAddress: string }).bindAddress = "0.0.0.0";
  assert.equal((await worker.apply.apply(await approve(worker.planner, wild), "admin")).error?.code, "RESOURCE_CONFLICT");
});

test("concurrent duplicate apply rejects active lease and completed replay creates no duplicates", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const reached = latch(); const release = latch();
  const worker = f.service(repo, { beforeStep: async (step) => { if (step.kind === "WRITE_CONFIGURATION") { reached.release(); await release.promise; } } });
  const input = await approve(worker.planner); const running = worker.apply.apply(input, "admin"); await reached.promise;
  await assert.rejects(f.service(await f.open()).apply.apply(input, "admin"), code("APPLY_IN_PROGRESS"));
  release.release(); const result = await running;
  assert.deepEqual(await worker.apply.apply(input, "admin"), result);
  assert.equal(repo.provisioning.effects(result.operationId).length, 6);
});

for (const kind of ["CLAIM_MANAGED_PATH", "CLAIM_ENDPOINT", "WRITE_CONFIGURATION", "REGISTER_SERVER"] as const) test(`injected ${kind} failure rolls back and preserves journal through restart`, async (t) => {
  const f = await fixture(t); let repo = await f.open(); const worker = f.service(repo, { beforeStep: async (step) => { if (step.kind === kind) throw new Error(`fail ${kind}`); } });
  const input = await approve(worker.planner); const result = await worker.apply.apply(input, "admin");
  assert.equal(result.result.state, "ROLLED_BACK"); assert.equal(result.result.outcome, "rolled-back");
  assert.ok(result.error?.stepId); assert.equal(repo.provisioning.claims(result.operationId).filter((c) => c.state === "active").length, 0);
  assert.equal(repo.provisioning.effects(result.operationId).length, 0);
  const journal = repo.provisioning.journal(result.operationId);
  assert.ok(journal.some((e) => e.status === "failed" && e.error?.stepId === result.error?.stepId));
  assert.ok(journal.some((e) => e.step === "ROLLING_BACK"));
  await repo.close(); repo = await f.open(); assert.deepEqual(repo.provisioning.journal(result.operationId), journal);
  const restarted = f.service(repo); assert.deepEqual(await restarted.apply.recover(result.operationId), result);
  assert.equal((await restarted.apply.apply(await approve(restarted.planner, { ...request(), displayName: "retry-new-plan" }), "admin")).result.state, "PROVISIONED");
});

test("partial rollback retains prerequisites and claims without removing unrelated resources", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const other = f.service(repo);
  const unrelated = await other.apply.apply(await approve(other.planner, request("other", "tcp", 25566)), "admin");
  const effects = repo.provisioning.effects(unrelated.operationId);
  const worker = f.service(repo, { beforeStep: async (step) => { if (step.kind === "REGISTER_SERVER") throw new Error("registration failed"); }, beforeCompensate: async () => { throw new Error("compensation failed"); } });
  const result = await worker.apply.apply(await approve(worker.planner), "admin");
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.equal(result.rollbackErrors.length, 1);
  assert.equal(repo.provisioning.claims(result.operationId).filter((c) => c.state === "active").length, 3);
  assert.ok(repo.provisioning.effects(result.operationId).some((e) => e.step.kind === "CREATE_MANAGED_DIRECTORY"));
  assert.ok(repo.provisioning.journal(result.operationId).some((e) => e.status === "compensation_failed"));
  assert.deepEqual(repo.provisioning.effects(unrelated.operationId), effects);
});

for (const crashKind of ["CLAIM_ENDPOINT", "WRITE_CONFIGURATION", "REGISTER_SERVER"] as const) test(`restart resumes after committed ${crashKind} without duplicate effects`, async (t) => {
  const f = await fixture(t); let repo = await f.open(); const worker = f.service(repo, { afterStep: async (step) => { if (step.kind === crashKind) throw new ProvisioningInterrupted("process terminated"); } });
  const input = await approve(worker.planner); await assert.rejects(worker.apply.apply(input, "admin"), ProvisioningInterrupted);
  const id = `apply_${input.plan.planId}`; assert.equal(repo.provisioning.get(id)?.result.state, "APPLYING");
  await repo.close(); repo = await f.open(); const restarted = f.service(repo);
  await assert.rejects(restarted.apply.recover(id), code("APPLY_IN_PROGRESS")); f.expire();
  const result = await restarted.apply.recover(id); assert.equal(result.result.state, "PROVISIONED");
  assert.equal(repo.provisioning.effects(id).length, 6);
  const completed = repo.provisioning.journal(id).filter((e) => e.status === "completed" && result.steps.some((s) => s.id === e.step));
  assert.equal(completed.length, 6);
});

test("restart resumes interrupted rollback", async (t) => {
  const f = await fixture(t); let repo = await f.open(); const worker = f.service(repo, { beforeStep: async (step) => { if (step.kind === "REGISTER_SERVER") throw new Error("fail"); }, beforeCompensate: async () => { throw new ProvisioningInterrupted("crash in rollback"); } });
  const input = await approve(worker.planner); await assert.rejects(worker.apply.apply(input, "admin"), ProvisioningInterrupted);
  const id = `apply_${input.plan.planId}`; assert.equal(repo.provisioning.get(id)?.result.state, "ROLLING_BACK");
  await repo.close(); repo = await f.open(); f.expire();
  assert.equal((await f.service(repo).apply.recover(id)).result.state, "ROLLED_BACK");
  assert.equal(repo.provisioning.claims(id).filter((c) => c.state === "active").length, 0);
});

test("fencing prevents expired worker writes and compensation after recovery", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const reached = latch(); const release = latch();
  const old = f.service(repo, { beforeStep: async (step) => { if (step.kind === "WRITE_CONFIGURATION") { reached.release(); await release.promise; } } });
  const input = await approve(old.planner); const pending = old.apply.apply(input, "admin"); await reached.promise; f.expire();
  const replacement = f.service(await f.open()); const recovered = await replacement.apply.recover(`apply_${input.plan.planId}`);
  assert.equal(recovered.result.state, "PROVISIONED"); release.release(); await assert.rejects(pending, code("LEASE_LOST"));
  assert.equal(repo.provisioning.effects(recovered.operationId).length, 6);
  assert.equal(repo.provisioning.claims(recovered.operationId).filter((c) => c.state === "active").length, 3);
});

test("approval, plan integrity and unsupported apply modes fail before durable mutation", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const worker = f.service(repo); const input = await approve(worker.planner);
  await assert.rejects(worker.apply.apply({ ...input, approved: false } as unknown as ProvisioningApplyRequest, "admin"), code("APPROVAL_REQUIRED"));
  await assert.rejects(worker.apply.apply({ ...input, digest: "wrong" }, "admin"), code("APPROVAL_REQUIRED"));
  const changed = { ...input.plan, serverId: "forged" };
  await assert.rejects(worker.apply.apply({ plan: changed, approved: true, digest: provisioningDigest(changed) }, "admin"), code("PLAN_MISMATCH"));
  const adopted = await approve(worker.planner, { ...request(), storage: { mode: "adopt", locationRef: "external" } });
  await assert.rejects(worker.apply.apply(adopted, "admin"), code("MODE_UNSUPPORTED"));
  assert.equal(repo.provisioning.claims().length, 0); assert.equal((await repo.listOperations()).length, 0);
});

test("manager gates apply capabilities, exposes durable history and keeps runtime registry unchanged", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const manager = new InMemoryProviderManager({ repository: repo }); await repo.close(); await manager.initialize();
  try {
    const provider = new SyntheticProvider(); await manager.register(provider); await manager.register(new BedrockProvider()); await manager.register(new MinecraftProvider({ serverDir: "unused" }));
    for (const id of ["minecraft", "minecraft-bedrock"]) assert.equal(manager.getCapabilities(id)["server.provision.apply"], undefined);
    const before = await manager.listServers(); const input = await approve(provider.provisioning); const result = await manager.applyProvisioning(input);
    assert.equal(manager.getProvisioningOperation(result.operationId)?.result.state, "PROVISIONED");
    assert.equal((await manager.getOperation(result.operationId))?.status, "completed");
    assert.equal(manager.listProvisioningEffects(result.operationId).length, 6);
    assert.deepEqual(await manager.listServers(), before);
    provider.getCapabilities = () => ({ "server.provision.plan": true });
    await assert.rejects(manager.applyProvisioning(input), /does not support provisioning/);
    await assert.rejects(manager.applyProvisioning({ ...input, plan: { ...input.plan, providerId: "minecraft-bedrock" } }), /does not support provisioning/);
  } finally { await manager.shutdown(); }
});

test("apply mutates only SQLite simulation state, never runtime files, processes or sockets", async (t) => {
  const f = await fixture(t); const repo = await f.open(); const worker = f.service(repo); const input = await approve(worker.planner);
  const fail = () => { throw new Error("Unexpected runtime mutation"); };
  try {
    for (const name of ["mkdir", "writeFile", "copyFile", "rename", "rm", "unlink"] as const) t.mock.method(fsp, name, fail);
    for (const name of ["mkdirSync", "writeFileSync", "copyFileSync", "renameSync", "rmSync", "unlinkSync"] as const) t.mock.method(fs, name, fail);
    for (const name of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"] as const) t.mock.method(childProcess, name, fail);
    t.mock.method(net.Server.prototype, "listen", fail); t.mock.method(dgram.Socket.prototype, "bind", fail);
    assert.equal((await worker.apply.apply(input, "admin")).result.state, "PROVISIONED");
    assert.ok((await fsp.readdir(f.root)).every((name) => name.startsWith("state.sqlite")));
  } finally { t.mock.restoreAll(); }
});

test("effect and completion journal roll back together on a storage failure", async (t) => {
  const f = await fixture(t); const repo = await f.open(); let armed = false;
  const worker = f.service(repo, { beforeStep: async (step) => { if (step.kind === "WRITE_CONFIGURATION") armed = true; } });
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    if (armed && sql.startsWith("INSERT INTO provisioning_journal")) { armed = false; throw new Error("injected journal storage failure"); }
    return prepare.call(this, sql);
  });
  const result = await worker.apply.apply(await approve(worker.planner), "admin");
  assert.equal(result.result.state, "ROLLED_BACK");
  assert.equal(repo.provisioning.effects(result.operationId).length, 0);
  assert.ok(!repo.provisioning.journal(result.operationId).some((entry) => entry.step === "05-configuration" && entry.status === "completed"));
  assert.ok(repo.provisioning.journal(result.operationId).some((entry) => entry.step === "05-configuration" && entry.status === "failed"));
  t.mock.restoreAll();
});

test("v4 migration preserves existing operations and adds durable provisioning tables", async (t) => {
  const f = await fixture(t); const repo = await f.open();
  await repo.createOperation({ operationId: "legacy", providerId: "synthetic", type: "server.start", status: "completed", createdAt: f.now().toISOString() });
  await repo.close();
  const database = new DatabaseSync(path.join(f.root, "state.sqlite"));
  database.exec("DROP TABLE provisioning_plans; DROP TABLE runtime_attachments; DROP TABLE provisioning_external_intents; DROP TABLE provisioning_applies; DROP TABLE provisioning_claims; DROP TABLE provisioning_journal; DROP TABLE provisioning_effects; PRAGMA user_version=4;");
  database.close();
  const migrated = await f.open();
  assert.equal((await migrated.getOperation("legacy"))?.status, "completed");
  const worker = f.service(migrated);
  assert.equal((await worker.apply.apply(await approve(worker.planner), "admin")).result.state, "PROVISIONED");
});
