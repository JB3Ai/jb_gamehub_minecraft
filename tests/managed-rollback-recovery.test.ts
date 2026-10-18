import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { bytesHash } from "../packages/core/managed-create";
import type { ManagedCreationOptions } from "../packages/core/managed-create-service";
import { ProvisioningApplyException, ProvisioningInterrupted } from "../packages/core/provisioning-apply-contracts";
import { provisioningRouter, tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";

const failure = (code: string) => (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === code;
async function diskFull(t: TestContext) {
  const f = await managedBedrockFixture(t);
  const file = f.bundle.files.find((file) => file.classification === "immutable-runtime")!;
  const bytes = Buffer.alloc(192 * 1024, 0x61);
  await fs.writeFile(path.join(f.source, file.relativePath), bytes);
  file.size = bytes.length; file.sha256 = bytesHash(bytes); f.repin();
  const { manager, repository } = await f.open(), plan = await manager.planProvisioning(f.request);
  const preview = await manager.previewManagedCreation(plan, f.policy);
  const partial = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "original-creator", { ...f.options, duringCopy: () => { throw Object.assign(new Error("simulated disk full"), { code: "ENOSPC" }); } });
  assert.equal(partial.result.state, "PARTIALLY_ROLLED_BACK");
  assert.equal(manager.listProvisioningClaims(partial.operationId).filter((claim) => claim.state === "active").length, 4);
  assert.equal((await fs.stat(path.join(f.target, ".jbgh-file-4"))).size, 64 * 1024);
  const approval = { digest: partial.digest, approved: true as const };
  const retry = (options: ManagedCreationOptions = f.options) => manager.retryManagedRollback(partial.operationId, approval, f.policy, "recovery-operator", options);
  return { ...f, manager, repository, partial, approval, retry };
}

test("explicit disk-full rollback recovery removes proven effects and releases all four claims", async (t) => {
  const f = await diskFull(t), before = f.repository.provisioning.fileReceipts(f.partial.operationId);
  assert.equal((await f.manager.recoverManagedCreation(f.partial.operationId, f.policy, f.options)).result.state, "PARTIALLY_ROLLED_BACK");
  assert.deepEqual(f.repository.provisioning.fileReceipts(f.partial.operationId), before);
  f.expire(); const result = await f.retry();
  assert.equal(result.result.state, "ROLLED_BACK", JSON.stringify(result.rollbackErrors));
  assert.equal(result.actor, "original-creator"); assert.equal(result.rollbackRecovery?.actor, "recovery-operator");
  assert.ok(result.lease.token > f.partial.lease.token);
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal(f.manager.listProvisioningClaims(result.operationId).filter((claim) => claim.state === "active").length, 0);
  assert.deepEqual(f.manager.listManagedRuntimes(), []);
  for (const file of f.bundle.files) assert.equal(bytesHash(await fs.readFile(path.join(f.source, file.relativePath))), file.sha256);
  const journal = f.manager.listProvisioningJournal(result.operationId);
  assert.ok(journal.some((entry) => entry.step === "ROLLBACK_RECOVERY"));
  const receipts = f.repository.provisioning.fileReceipts(result.operationId);
  assert.equal((await f.retry()).result.state, "ROLLED_BACK");
  assert.deepEqual(f.repository.provisioning.fileReceipts(result.operationId), receipts);
});

for (const mutation of ["foreign file", "changed published file", "changed scratch", "linked scratch", "replaced scratch", "source drift"] as const) test("explicit rollback retains claims and unverified content: " + mutation, async (t) => {
  const f = await diskFull(t), scratch = path.join(f.target, ".jbgh-file-4");
  let retained = scratch;
  if (mutation === "foreign file") { retained = path.join(f.target, "assets", "foreign.txt"); await fs.writeFile(retained, "foreign"); }
  if (mutation === "changed published file") { retained = path.join(f.target, "server.properties"); await fs.appendFile(retained, "foreign=true\n"); }
  if (mutation === "changed scratch") await fs.writeFile(scratch, "unverified");
  if (mutation === "linked scratch") await fs.link(scratch, path.join(f.base, "alias"));
  if (mutation === "replaced scratch") { await fs.rename(scratch, path.join(f.base, "original-scratch")); await fs.writeFile(scratch, "replacement"); }
  if (mutation === "source drift") await fs.appendFile(path.join(f.source, f.bundle.files[0].relativePath), "drift");
  const before = await fs.readFile(retained), entries = await fs.readdir(f.target);
  f.expire(); const result = await f.retry();
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK");
  assert.equal(f.manager.listProvisioningClaims(result.operationId).filter((claim) => claim.state === "active").length, 4);
  assert.deepEqual(await fs.readFile(retained), before); assert.deepEqual(await fs.readdir(f.target), entries);
});

test("rollback retry requires approval, matching digest and an expired lease; stale workers are fenced", async (t) => {
  const f = await diskFull(t), op = f.partial;
  await assert.rejects(f.manager.retryManagedRollback(op.operationId, { ...f.approval, approved: false as unknown as true }, f.policy, "admin", f.options), failure("APPROVAL_REQUIRED"));
  await assert.rejects(f.manager.retryManagedRollback(op.operationId, { ...f.approval, digest: "wrong" }, f.policy, "admin", f.options), failure("APPROVAL_MISMATCH"));
  await assert.rejects(f.retry(), failure("APPLY_IN_PROGRESS"));
  assert.deepEqual(f.manager.getProvisioningOperation(op.operationId), op);
  f.expire(); const now = f.options.now();
  const acquired = f.repository.provisioning.acquireRollback(op.operationId, op.digest, "admin", "worker-2", now.toISOString(), new Date(now.getTime() + 1000).toISOString());
  const other = await f.open();
  await assert.rejects(other.manager.retryManagedRollback(op.operationId, f.approval, f.policy, "admin", f.options), failure("APPLY_IN_PROGRESS"));
  let mutation = false;
  assert.throws(() => f.repository.provisioning.managedGuard(op, now.toISOString(), new Date(now.getTime() + 1000).toISOString(), () => { mutation = true; }), failure("LEASE_LOST"));
  assert.equal(mutation, false);
  assert.equal(acquired.result.state, "ROLLING_BACK");
  // Ordinary recovery must not continue an interrupted explicit destructive action.
  f.expire(); const receipts = f.repository.provisioning.fileReceipts(op.operationId);
  assert.equal((await other.manager.recoverManagedCreation(op.operationId, f.policy, f.options)).result.state, "ROLLING_BACK");
  assert.deepEqual(f.repository.provisioning.fileReceipts(op.operationId), receipts);
  assert.equal((await other.manager.retryManagedRollback(op.operationId, f.approval, f.policy, "admin", f.options)).result.state, "ROLLED_BACK");
});

test("interrupted compensation resumes only uncompensated effects after explicit reapproval", async (t) => {
  const f = await diskFull(t); f.expire();
  await assert.rejects(f.retry({ ...f.options, afterStep: async (step) => { if (step === "undo-temp-4") throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  assert.ok(!syncFs.existsSync(path.join(f.target, ".jbgh-file-4")));
  const receipt = f.repository.provisioning.fileReceipts(f.partial.operationId).find((receipt) => receipt.intentId === "undo-temp-4");
  assert.ok(receipt?.compensated);
  f.expire(); const reopened = await f.open();
  assert.equal((await reopened.manager.recoverManagedCreation(f.partial.operationId, f.policy, f.options)).result.state, "ROLLING_BACK");
  const result = await reopened.manager.retryManagedRollback(f.partial.operationId, f.approval, f.policy, "admin", f.options);
  assert.equal(result.result.state, "ROLLED_BACK");
  assert.deepEqual(f.repository.provisioning.fileReceipts(result.operationId).find((item) => item.intentId === "undo-temp-4"), receipt);
});

test("ownership ambiguity after a directory syscall remains partial on explicit retry", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "admin", { ...f.options, afterMutation: (intent) => { if (intent.id === "directory-0") throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  f.expire(); const partial = await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options);
  assert.equal(partial.result.state, "PARTIALLY_ROLLED_BACK"); f.expire();
  const result = await manager.retryManagedRollback(partial.operationId, { approved: true, digest: partial.digest }, f.policy, "admin", f.options);
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK");
  assert.ok(syncFs.existsSync(path.join(f.target, "assets")));
  assert.equal(manager.listProvisioningClaims(partial.operationId).filter((claim) => claim.state === "active").length, 4);
});

test("explicit recovery refuses successful CREATE and compensation cannot release outstanding receipts", async (t) => {
  const f = await diskFull(t); f.expire(); const now = f.options.now();
  const op = f.repository.provisioning.acquireRollback(f.partial.operationId, f.partial.digest, "admin", "worker", now.toISOString(), new Date(now.getTime() + 1000).toISOString());
  const result = f.repository.provisioning.finishRollback(op, now.toISOString(), []);
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK");
  assert.equal(f.manager.listProvisioningClaims(op.operationId).filter((claim) => claim.state === "active").length, 4);
  const clean = await managedBedrockFixture(t), { manager } = await clean.open(), plan = await manager.planProvisioning(clean.request), preview = await manager.previewManagedCreation(plan, clean.policy);
  const created = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, clean.policy, "admin", clean.options); clean.expire();
  await assert.rejects(manager.retryManagedRollback(created.operationId, { approved: true, digest: created.digest }, clean.policy, "admin", clean.options), failure("ROLLBACK_STATE_CONFLICT"));
  assert.ok(syncFs.existsSync(path.join(clean.target, "bedrock_server.exe")));
});

test("newly protected targets cannot be retried destructively", async (t) => {
  const f = await diskFull(t); f.expire(); f.policy.protectedPaths!.push(f.target);
  await assert.rejects(f.retry(), failure("PROTECTED_PATH"));
  assert.deepEqual(f.manager.getProvisioningOperation(f.partial.operationId), f.partial);
  assert.equal(f.manager.listProvisioningClaims(f.partial.operationId).filter((claim) => claim.state === "active").length, 4);
});

test("explicit recovery API authenticates, binds approval and returns only safe rollback results", async (t) => {
  const f = await diskFull(t); f.expire();
  const token = "explicit-admin-recovery-test-token-0123456789";
  const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => f.manager, () => ({ authorize: tokenAdminAuthorizer(token), policies: { "minecraft-bedrock": f.policy } })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/provisioning/operations/${f.partial.operationId}/recover`;
  const call = (body: unknown, credential = token) => fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + credential }, body: JSON.stringify(body) });
  assert.equal((await call(f.approval, "bad")).status, 401);
  assert.equal((await call({ digest: f.approval.digest })).status, 400);
  assert.equal((await call({ ...f.approval, approved: false })).status, 400);
  assert.equal((await call({ ...f.approval, actor: "forged" })).status, 400);
  assert.equal((await call({ ...f.approval, digest: "wrong" })).status, 409);
  const response = await call(f.approval); assert.equal(response.status, 200);
  const text = await response.text(), result = JSON.parse(text);
  assert.equal(result.state, "ROLLED_BACK"); assert.equal(result.retainedClaims, 0); assert.deepEqual(result.residuals, []);
  for (const secret of [f.base, f.source, token, "test-only-terms"]) assert.ok(!text.includes(secret));
  assert.equal(f.manager.getProvisioningOperation(result.operationId)?.rollbackRecovery?.actor, "provisioning-admin");
});
