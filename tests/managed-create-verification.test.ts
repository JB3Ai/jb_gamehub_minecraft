import test from "node:test";
import assert from "node:assert/strict";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";
import { ManagedFilesystem } from "../packages/core/managed-filesystem";
import { ProvisioningApplyException, ProvisioningInterrupted } from "../packages/core/provisioning-apply-contracts";
import fs from "node:fs/promises";
import path from "node:path";

test("long managed manifest verification retains the apply lease", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  let clock = f.options.now().getTime(), verification = false;
  const original = ManagedFilesystem.prototype.inspect;
  t.mock.method(ManagedFilesystem.prototype, "inspect", function (...args: Parameters<typeof original>) {
    if (verification) clock += 200; // Each individual read fits a 1s lease; the whole manifest exceeds it.
    return original.apply(this, args);
  });
  const last = 4 + f.bundle.files.filter(file => file.classification === "immutable-runtime").length - 1;
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", {
    ...f.options, now: () => new Date(clock), afterStep: async (step) => { if (step === `clean-${last}`) verification = true; },
  });
  assert.equal(result.result.state, "PROVISIONED");
});

test("verification cannot revive an expired fence or release its claims", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  let clock = f.options.now().getTime(), verification = false, expired = false;
  const original = ManagedFilesystem.prototype.inspect;
  t.mock.method(ManagedFilesystem.prototype, "inspect", function (...args: Parameters<typeof original>) {
    const result = original.apply(this, args);
    if (verification && !expired) { clock += 2000; expired = true; }
    return result;
  });
  const last = 4 + f.bundle.files.filter(file => file.classification === "immutable-runtime").length - 1;
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", {
    ...f.options, now: () => new Date(clock), afterStep: async (step) => { if (step === `clean-${last}`) verification = true; },
  }), (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST");
  assert.equal(manager.getProvisioningOperation(`create_${plan.planId}`)?.result.state, "APPLYING");
  assert.equal(manager.listProvisioningClaims(`create_${plan.planId}`).filter(claim => claim.state === "active").length, 4);
});

for (const drift of [false, true]) test("fully receipted bundle recovery " + (drift ? "rejects changed bytes" : "verifies without replaying creation receipts"), async (t) => {
  const f = await managedBedrockFixture(t), { manager, repository } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const last = 4 + f.bundle.files.filter(file => file.classification === "immutable-runtime").length - 1;
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", {
    ...f.options, afterStep: async step => { if (step === `clean-${last}`) throw new ProvisioningInterrupted(); },
  }), ProvisioningInterrupted);
  const operationId = `create_${plan.planId}`, receipts = repository.provisioning.fileReceipts(operationId);
  if (drift) await fs.appendFile(path.join(f.target, "vendor.dll"), "foreign mutation");
  f.expire(); const result = await manager.recoverManagedCreation(operationId, f.policy, f.options);
  assert.equal(result.result.state, drift ? "PARTIALLY_ROLLED_BACK" : "PROVISIONED");
  if (!drift) assert.deepEqual(repository.provisioning.fileReceipts(operationId), receipts);
  else {
    assert.match(await fs.readFile(path.join(f.target, "vendor.dll"), "utf8"), /foreign mutation/);
    assert.equal(manager.listProvisioningClaims(operationId).filter(claim => claim.state === "active").length, 4);
  }
});
