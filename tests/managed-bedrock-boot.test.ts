import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";
import { ProvisioningApplyException } from "../packages/core/provisioning-apply-contracts";
import { ManagedBootCoordinator } from "../packages/core/managed-boot";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { once } from "node:events";
import { provisioningRouter, tokenAdminAuthorizer } from "../packages/core/provisioning-api";

const failure = (code: string) => (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === code;
async function created(t: TestContext) {
  const f = await managedBedrockFixture(t), { manager, repository, provider } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const operation = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "fixture-admin", f.options);
  assert.equal(operation.result.state, "PROVISIONED");
  const definition = manager.listManagedRuntimes()[0];
  const coordinator = new ManagedBootCoordinator(repository.provisioning, provider.managedCreation!, preview, definition, f.options.now, "fixture-worker");
  return { ...f, manager, repository, operation, preview, definition, coordinator };
}

test("managed boot approval is digest-bound, durable and separate from CREATE receipts", async (t) => {
  const f = await created(t), receipts = f.repository.provisioning.fileReceipts(f.operation.operationId);
  const preview = await f.manager.previewManagedBoot(f.operation.operationId, f.policy);
  assert.equal(f.repository.provisioning.getManagedBoot(f.operation.operationId), undefined);
  await assert.rejects(f.manager.authorizeManagedBoot(f.operation.operationId, { digest: "wrong", approved: true }, f.policy, "operator"), failure("APPROVAL_MISMATCH"));
  await assert.rejects(f.manager.authorizeManagedBoot(f.operation.operationId, { digest: preview.digest, approved: false as unknown as true }, f.policy, "operator"), failure("APPROVAL_REQUIRED"));
  const authorization = await f.manager.authorizeManagedBoot(f.operation.operationId, { digest: preview.digest, approved: true }, f.policy, "operator");
  assert.equal(authorization.actor, "operator"); assert.equal(authorization.creationDigest, f.operation.digest);
  assert.equal(authorization.attempt, undefined);
  assert.deepEqual(f.manager.listManagedRuntimes()[0], f.definition);
  assert.deepEqual(f.repository.provisioning.fileReceipts(f.operation.operationId), receipts);
  await f.manager.shutdown(); const reopened = await f.open();
  assert.deepEqual(reopened.repository.provisioning.getManagedBoot(f.operation.operationId), authorization);
  await reopened.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  assert.equal((await reopened.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
});

test("approval alone does not authorize pre-launch runtime output", async (t) => {
  const f = await created(t), preview = await f.manager.previewManagedBoot(f.operation.operationId, f.policy);
  await f.manager.authorizeManagedBoot(f.operation.operationId, { digest: preview.digest, approved: true }, f.policy, "operator");
  await fs.mkdir(path.join(f.target, "worlds"));
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), failure("ARTIFACT_DRIFT"));
});

async function launched(t: TestContext) {
  const f = await created(t), preview = await f.manager.previewManagedBoot(f.operation.operationId, f.policy);
  await f.manager.authorizeManagedBoot(f.operation.operationId, { digest: preview.digest, approved: true }, f.policy, "operator");
  const control = f.coordinator.control(), attempt = control.begin();
  control.record(attempt, "RUNNING", { pid: 12345 });
  const world = path.join(f.target, "worlds", "managed-bedrock-world");
  await fs.mkdir(path.join(world, "db"), { recursive: true });
  await fs.writeFile(path.join(world, "level.dat"), "fixture world metadata");
  await fs.writeFile(path.join(world, "db", "CURRENT"), "MANIFEST-000001\n");
  return { ...f, control, attempt, world };
}

test("launch intent admits selected-world state; clean stop permits another explicit attempt", async (t) => {
  const f = await launched(t), receipts = f.repository.provisioning.fileReceipts(f.operation.operationId);
  assert.throws(() => f.control.begin(), failure("BOOT_RECOVERY_REQUIRED"));
  f.control.record(f.attempt, "READY", { startupSignal: true, endpoints: true, world: true });
  f.control.record(f.attempt, "STOPPED", { exitCode: 0, portsClosed: true });
  await f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  assert.deepEqual(f.repository.provisioning.fileReceipts(f.operation.operationId), receipts);
  assert.equal((await f.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
  const next = f.control.begin(); assert.ok(next.fence > f.attempt.fence);
  assert.throws(() => f.control.record(f.attempt, "READY", {}), failure("BOOT_FENCE_LOST"));
});

for (const relative of ["worlds/other-world/level.dat", "worlds/managed-bedrock-world/db/foreign.dll", "worlds/managed-bedrock-world/foreign.txt", "logs/unapproved.log", "config/foreign.json", "development_behavior_packs/script.js"]) test("boot output policy rejects " + relative, async (t) => {
  const f = await launched(t), location = path.join(f.target, relative);
  await fs.mkdir(path.dirname(location), { recursive: true }); await fs.writeFile(location, "unverified");
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), failure("ARTIFACT_DRIFT"));
  assert.equal(await fs.readFile(location, "utf8"), "unverified");
  assert.equal(f.manager.listProvisioningClaims(f.operation.operationId).filter(claim => claim.state === "active").length, 4);
});

test("authorized state never exempts immutable artifacts or protected managed values", async (t) => {
  const f = await launched(t), location = path.join(f.target, "server.properties"), original = await fs.readFile(location, "utf8");
  await fs.writeFile(location, "# normal rewrite\n\n" + original.trim().split("\n").reverse().join("\n") + "\n");
  await f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  await fs.writeFile(location, original.replace("server-port=29232", "server-port=19132"));
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), failure("ARTIFACT_DRIFT"));
});

test("v10 boot migration preserves the v9 G-C1 definition and receipts without launch permission", async (t) => {
  const f = await created(t), receipts = f.repository.provisioning.fileReceipts(f.operation.operationId);
  await f.manager.shutdown();
  const db = new DatabaseSync(path.join(f.base, "state.sqlite"));
  db.exec("DROP TABLE onboarding_state; DROP TABLE setup_configuration; DROP TABLE managed_runtime_boot_authorizations; PRAGMA user_version=9;"); db.close();
  const reopened = await f.open();
  assert.deepEqual(reopened.repository.provisioning.managedDefinitions()[0], f.definition);
  assert.deepEqual(reopened.repository.provisioning.fileReceipts(f.operation.operationId), receipts);
  assert.equal(reopened.repository.provisioning.getManagedBoot(f.operation.operationId), undefined);
  await reopened.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  const start = await reopened.manager.startServer(f.request.serverId!, "minecraft-bedrock");
  assert.equal(start.status, "failed");
  assert.match((await reopened.manager.getOperation(start.operationId))!.error!.message, /FIRST_BOOT_DEFERRED/);
});

test("another definition cannot reuse approval and another worker cannot acquire an active attempt", async (t) => {
  const first = await created(t), second = await created(t);
  const preview = await first.manager.previewManagedBoot(first.operation.operationId, first.policy);
  await first.manager.authorizeManagedBoot(first.operation.operationId, { digest: preview.digest, approved: true }, first.policy, "operator");
  await assert.rejects(second.manager.authorizeManagedBoot(second.operation.operationId, { digest: preview.digest, approved: true }, second.policy, "operator"), failure("APPROVAL_MISMATCH"));
  first.coordinator.control().begin();
  const other = await first.open(), coordinator = new ManagedBootCoordinator(other.repository.provisioning, first.manager.getProvider("minecraft-bedrock").managedCreation!, first.preview, first.definition, first.options.now, "other-worker");
  assert.throws(() => coordinator.control().begin(), failure("BOOT_RECOVERY_REQUIRED"));
  await other.manager.recoverManagedCreation(first.operation.operationId, first.policy, first.options);
  assert.equal((await other.manager.getServerStatus(first.request.serverId!, "minecraft-bedrock")).status, "error");
});

for (const kind of ["hardlink", "junction"]) test("runtime output rejects " + kind + " and preserves foreign data", async (t) => {
  const f = await launched(t), outside = path.join(f.base, "foreign"); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "data"), "preserve foreign data");
  if (kind === "hardlink") await fs.link(path.join(outside, "data"), path.join(f.world, "db", "000001.ldb"));
  else { await fs.rename(path.join(f.world, "db"), path.join(f.base, "original-db")); await fs.symlink(outside, path.join(f.world, "db"), "junction"); }
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), failure("ARTIFACT_DRIFT"));
  assert.equal(await fs.readFile(path.join(outside, "data"), "utf8"), "preserve foreign data");
});

test("managed boot API requires admin and exact approval; projections keep source data private", async (t) => {
  const f = await created(t), token = "managed-boot-test-admin-token-01234567890123456789";
  const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => f.manager, () => ({ authorize: tokenAdminAuthorizer(token), policies: { "minecraft-bedrock": f.policy } })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/provisioning/operations/${f.operation.operationId}`;
  const call = (route: string, body: unknown, credential = token) => fetch(url + route, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + credential }, body: JSON.stringify(body) });
  assert.equal((await call("/boot-preview", {}, "wrong")).status, 401);
  const response = await call("/boot-preview", {}), text = await response.text(), preview = JSON.parse(text);
  assert.equal(response.status, 200); assert.equal(preview.policyId, "bds-1.26.51.1-managed-boot-v1");
  for (const secret of [f.base, "sourcePath", "rootIdentity", "configurationDefaults", token]) assert.ok(!text.includes(secret));
  const approval = { digest: preview.digest, approved: true };
  assert.equal((await call("/boot-authorizations", approval, "wrong")).status, 401);
  assert.equal((await call("/boot-authorizations", { ...approval, approved: false })).status, 400);
  assert.equal((await call("/boot-authorizations", { ...approval, actor: "forged" })).status, 400);
  assert.equal((await call("/boot-authorizations", { ...approval, policy: {} })).status, 400);
  assert.equal((await call("/boot-authorizations", { ...approval, digest: "wrong" })).status, 409);
  const approved = await call("/boot-authorizations", approval); assert.equal(approved.status, 200);
  assert.equal((await approved.json()).authorized, true);
  assert.equal(f.repository.provisioning.getManagedBoot(f.operation.operationId)?.actor, "provisioning-admin");
  assert.equal(f.repository.provisioning.getManagedBoot(f.operation.operationId)?.attempt, undefined);
});
