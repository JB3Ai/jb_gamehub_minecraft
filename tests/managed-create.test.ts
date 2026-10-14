import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { ManagedFilesystem, hashFile, identity } from "../packages/core/managed-filesystem";
import { fileURLToPath } from "node:url";
import { bytesHash } from "../packages/core/managed-create";
import { ProvisioningApplyException, ProvisioningInterrupted } from "../packages/core/provisioning-apply-contracts";
import { ManagedCreationService } from "../packages/core/managed-create-service";
import { JavaProvisioningPlanner } from "../packages/minecraft-provider/provisioning";
import { JavaManagedCreation } from "../packages/minecraft-provider/managed-create";
import { managedFixture } from "./helpers/managed-create-fixture";

const code = (expected: string) => (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === expected;
test("ownership identity preserves 64-bit inode precision and rejects rounded numeric IDs", () => {
  assert.deepEqual(identity({ dev: 1n, ino: 9007199254740993n } as syncFs.BigIntStats), { device: "1", inode: "9007199254740993" });
  assert.throws(() => identity({ dev: 1, ino: Number(9007199254740993n) } as syncFs.Stats), code("UNSUPPORTED_FILESYSTEM_IDENTITY"));
});
test("approved file fingerprints match the filesystem's exact BigInt file IDs", () => {
  const location = fileURLToPath(new URL("../packages/core/managed-filesystem.ts", import.meta.url));
  const stat = syncFs.lstatSync(location, { bigint: true });
  assert.deepEqual(hashFile(location).identity, { device: String(stat.dev), inode: String(stat.ino) });
});
for (const kind of ["java", "synthetic"] as const) test(kind + " managed CREATE is durable, stopped, scoped and idempotent", async (t) => {
  const f = await managedFixture(t, kind); const { manager, repository } = await f.open();
  for (const method of ["spawn", "exec", "execFile", "fork"] as const) t.mock.method(childProcess, method, () => { throw new Error("CREATE must not launch a process"); });
  const original = await fs.readFile(f.source); const plan = await manager.planProvisioning(f.request);
  assert.deepEqual(await fs.readdir(f.root), []); assert.equal(repository.provisioning.claims().length, 0);
  const preview = await manager.previewManagedCreation(plan, f.policy); assert.deepEqual(await fs.readdir(f.root), []);
  const input = { planId: plan.planId, digest: preview.digest, approved: true as const };
  const result = await manager.applyManagedCreation(input, f.policy, "trusted-admin", f.options);
  assert.equal(result.result.state, "PROVISIONED"); assert.equal(result.result.outcome, "applied");
  assert.equal((await manager.getServer(f.request.serverId!, f.providerId))?.ownership, "MANAGED");
  assert.equal((await manager.getServerStatus(f.request.serverId!, f.providerId)).status, "offline");
  assert.ok(!(await manager.listOperations()).some((op) => op.type === "server.start"));
  assert.deepEqual(await fs.readFile(f.source), original);
  if (kind === "java") {
    assert.equal(bytesHash(await fs.readFile(path.join(f.target, "paper.jar"))), bytesHash(original));
    assert.equal(await fs.readFile(path.join(f.target, "server.properties"), "utf8"), "server-port=27051\nserver-ip=127.0.0.1\nlevel-name=managed-world\nenable-rcon=false\nenable-query=false\n");
    assert.equal(await fs.readFile(path.join(f.target, "eula.txt"), "utf8"), "eula=true\n");
    assert.deepEqual(await manager.getWorlds(f.request.serverId!, f.providerId), []);
  }
  assert.ok(!(await fs.readdir(f.target)).some((file) => file.startsWith(".jbgh-file-")));
  const journal = repository.provisioning.journal(result.operationId);
  assert.deepEqual(await manager.applyManagedCreation(input, f.policy, "trusted-admin", f.options), result);
  assert.deepEqual(repository.provisioning.journal(result.operationId), journal);
  await manager.shutdown(); const restarted = await f.open();
  await restarted.manager.recoverManagedCreation(result.operationId, f.policy, f.options);
  assert.equal((await restarted.manager.getServer(f.request.serverId!, f.providerId))?.ownership, "MANAGED");
  assert.equal((await restarted.manager.getServerStatus(f.request.serverId!, f.providerId)).status, "offline");
});

for (const boundary of ["claims", "intent:directory", "directory", "write-1", "publish-1", "clean-1", "write-2", "write-3", "definition", "activation", "before-final"]) {
  test("CREATE restart reconciles crash after " + boundary, async (t) => {
    const f = await managedFixture(t); const first = await f.open(); const plan = await first.manager.planProvisioning(f.request), preview = await first.manager.previewManagedCreation(plan, f.policy);
    const input = { planId: plan.planId, digest: preview.digest, approved: true as const };
    await assert.rejects(first.manager.applyManagedCreation(input, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === boundary) throw new ProvisioningInterrupted(boundary); } }), ProvisioningInterrupted);
    assert.equal(await first.manager.getServer(f.request.serverId!, f.providerId), undefined);
    await first.manager.shutdown(); f.expire(); const restarted = await f.open();
    const result = await restarted.manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options);
    assert.equal(result.result.state, "PROVISIONED"); assert.equal(restarted.repository.provisioning.managedDefinitions().length, 1);
    assert.equal((await restarted.manager.getServerStatus(f.request.serverId!, f.providerId)).status, "offline");
  });
}

for (const boundary of ["directory", "publish-1", "write-2", "write-3", "definition", "activation", "before-final"]) {
  test("CREATE compensation removes only owned effects after " + boundary, async (t) => {
    const f = await managedFixture(t); const { manager, repository } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
    const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === boundary) throw new Error("injected failure"); } });
    assert.equal(result.result.state, "ROLLED_BACK"); assert.deepEqual(await fs.readdir(f.root), []);
    assert.equal(repository.provisioning.claims(result.operationId).filter((claim) => claim.state === "active").length, 0);
    assert.equal(repository.provisioning.managedDefinitions().length, 0); assert.equal(await manager.getServer(f.request.serverId!, f.providerId), undefined);
    assert.ok((await fs.readFile(f.source)).length > 0);
  });
}

test("uncertain directory creation retains unknown storage and all claims", async (t) => {
  const f = await managedFixture(t); const { manager, repository } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterMutation: (intent) => { if (intent.kind === "directory") throw new ProvisioningInterrupted("receipt lost"); } }), ProvisioningInterrupted);
  f.expire(); const result = await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options);
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.ok(syncFs.existsSync(f.target)); assert.ok(repository.provisioning.claims(result.operationId).every((claim) => claim.state === "active"));
});
test("artifact publication without receipt is reconciled by recorded inode and hash", async (t) => {
  const f = await managedFixture(t); const { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterMutation: (intent) => { if (intent.id === "publish-1") throw new ProvisioningInterrupted("receipt lost"); } }), ProvisioningInterrupted);
  f.expire(); assert.equal((await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options)).result.state, "PROVISIONED");
});
test("an interrupted artifact stream recovers only inside its previously receipted temp", async (t) => {
  const f = await managedFixture(t); const { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, duringCopy: () => { throw new ProvisioningInterrupted("stream interrupted"); } }), ProvisioningInterrupted);
  f.expire(); assert.equal((await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options)).result.state, "PROVISIONED");
});
test("recovery rejects incompatible final bytes and retains changed owned data", async (t) => {
  const f = await managedFixture(t); const { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "publish-2") throw new ProvisioningInterrupted("paused"); } }), ProvisioningInterrupted);
  await fs.writeFile(path.join(f.target, "server.properties"), "foreign edit"); f.expire();
  assert.equal((await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options)).result.state, "PARTIALLY_ROLLED_BACK");
  assert.equal(await fs.readFile(path.join(f.target, "server.properties"), "utf8"), "foreign edit");
});
test("source drift after approval blocks all filesystem mutation", async (t) => {
  const f = await managedFixture(t); const { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await fs.appendFile(f.source, "changed source");
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", f.options), code("ARTIFACT_DRIFT"));
  assert.deepEqual(await fs.readdir(f.root), []); assert.equal(manager.listProvisioningClaims().length, 0);
});
test("foreign files prevent directory rollback and are never recursively removed", async (t) => {
  const f = await managedFixture(t); const { manager, repository } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "directory") { await fs.writeFile(path.join(f.target, "foreign.txt"), "must survive"); throw new Error("fail"); } } });
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.equal(await fs.readFile(path.join(f.target, "foreign.txt"), "utf8"), "must survive");
  assert.ok(repository.provisioning.claims(result.operationId).every((claim) => claim.state === "active"));
});
test("a modified owned configuration is retained during compensation", async (t) => {
  const f = await managedFixture(t); const { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "publish-2") { await fs.writeFile(path.join(f.target, "server.properties"), "operator change"); throw new Error("fail"); } } });
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.equal(await fs.readFile(path.join(f.target, "server.properties"), "utf8"), "operator change");
});

test("lease takeover fences stale filesystem mutation, receipts and compensation", async (t) => {
  const f = await managedFixture(t); const { manager, repository } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "claims") throw new ProvisioningInterrupted("paused"); } }), ProvisioningInterrupted);
  const original = repository.provisioning.get(`create_${plan.planId}`)!;
  const next = await f.open(); await assert.rejects(next.manager.recoverManagedCreation(original.operationId, f.policy, f.options), code("APPLY_IN_PROGRESS"));
  f.expire(); const time = f.options.now().toISOString(); const fresh = next.repository.provisioning.acquire(original.operationId, "new-worker", time, new Date(f.options.now().getTime() + 1000).toISOString());
  let mutated = false;
  assert.throws(() => repository.provisioning.managedGuard(original, time, time, () => { mutated = true; new ManagedFilesystem(preview).effect({ id: "directory", operationId: original.operationId, kind: "directory", relativePath: "" }, [], []); }), code("LEASE_LOST"));
  assert.equal(mutated, false); assert.equal(fresh.lease.token, 2); assert.deepEqual(await fs.readdir(f.root), []);
});

test("two database connections claim the complete resource set atomically", async (t) => {
  const f = await managedFixture(t); const first = await f.open(), second = await f.open(); const plan = await first.manager.planProvisioning(f.request), preview = await first.manager.previewManagedCreation(plan, f.policy);
  const otherPlan = await second.manager.planProvisioning({ ...f.request, serverId: "competitor", storage: { mode: "create", rootId: "root", directoryName: "other" } }), other = await second.manager.previewManagedCreation(otherPlan, f.policy);
  await assert.rejects(first.manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "claims") throw new ProvisioningInterrupted("hold"); } }), ProvisioningInterrupted);
  await assert.rejects(second.manager.applyManagedCreation({ planId: otherPlan.planId, digest: other.digest, approved: true }, f.policy, "operator", f.options), code("RESOURCE_CONFLICT"));
  assert.equal(second.repository.provisioning.claims(`create_${otherPlan.planId}`).length, 0);
  assert.equal(second.repository.provisioning.get(`create_${otherPlan.planId}`), undefined);
});
test("SQLite OS writer lock excludes a second process during a fenced primitive", async (t) => {
  const f = await managedFixture(t), { manager, repository } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "claims") throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  const operation = repository.provisioning.get(`create_${plan.planId}`)!;
  const script = "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1],{timeout:50}); try { db.exec('BEGIN IMMEDIATE'); process.exitCode=2; } catch(e) { if (!/locked|busy/i.test(e.message)) throw e; process.stdout.write('excluded'); } finally { db.close(); }";
  repository.provisioning.managedGuard(operation, f.options.now().toISOString(), new Date(f.options.now().getTime() + 1000).toISOString(), () => {
    const child = childProcess.spawnSync(process.execPath, ["-e", script, path.join(f.base, "state.sqlite")], { encoding: "utf8", timeout: 5000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, "excluded");
  });
});
test("a stale worker cannot publish a runtime after asynchronous construction", async (t) => {
  const f = await managedFixture(t), { manager, repository } = await f.open();
  let reached!: () => void, release!: () => void, published = false;
  const atActivation = new Promise<void>((resolve) => { reached = resolve; }), proceed = new Promise<void>((resolve) => { release = resolve; });
  const planner = new JavaProvisioningPlanner();
  const service = new ManagedCreationService(repository.provisioning, planner, new JavaManagedCreation(), {
    activate: async (_record, _verify, _admit, publish) => { reached(); await proceed; publish(() => { published = true; }); }, detach: (_id, fence) => fence(() => {}),
  }, f.options);
  const preview = await service.preview(await planner.plan(f.request), f.policy); repository.provisioning.saveManagedPreview(preview);
  const running = service.apply({ planId: preview.plan.planId, digest: preview.digest, approved: true }, f.policy, "operator"); await atActivation;
  f.expire(); const now = f.options.now(); repository.provisioning.acquire(`create_${preview.plan.planId}`, "replacement", now.toISOString(), new Date(now.getTime() + 1000).toISOString());
  release(); await assert.rejects(running, code("LEASE_LOST")); assert.equal(published, false);
  assert.equal(await manager.getServer(f.request.serverId!, f.providerId), undefined);
  f.expire(); assert.equal((await manager.recoverManagedCreation(`create_${preview.plan.planId}`, f.policy, f.options)).result.state, "PROVISIONED");
});
test("a crash during compensation resumes recorded removal intents safely", async (t) => {
  const f = await managedFixture(t), { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const unlink = syncFs.unlinkSync; let armed = false;
  t.mock.method(syncFs, "unlinkSync", (location: syncFs.PathLike) => { unlink(location); if (armed) { armed = false; throw new ProvisioningInterrupted("removal receipt lost"); } });
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "publish-2") { armed = true; throw new Error("begin rollback"); } } }), ProvisioningInterrupted);
  t.mock.restoreAll(); f.expire();
  assert.equal((await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options)).result.state, "ROLLED_BACK");
  assert.deepEqual(await fs.readdir(f.root), []);
});
test("revoking the prior license during apply blocks the EULA effect", async (t) => {
  const f = await managedFixture(t), { manager } = await f.open(); const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "publish-2") f.policy.managedCreate!.acceptances["prior-license"].revoked = true; } });
  assert.equal(result.result.state, "ROLLED_BACK"); assert.equal(syncFs.existsSync(path.join(f.target, "eula.txt")), false);
});
