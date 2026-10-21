import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { buildSetupWizardDrafts } from "../integration/provisioning/scripts/setup-wizard-drafts";
import { provisioningApiOptionsFromEnvironment, provisioningRouter, tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { managedFixture } from "./helpers/managed-create-fixture";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";

test("023C draft loads, preserves pinned lineage, and blocks discovery approval/preflight/apply without runtime effects", async t => {
  const java = await managedFixture(t), bedrock = await managedBedrockFixture(t);
  const source = { minecraft: java.policy, "minecraft-bedrock": bedrock.policy }, before = JSON.stringify(source);
  const drafts = buildSetupWizardDrafts(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(drafts.requests.length, 2);
  const file = path.join(java.base, "023c-draft.json"); await fs.writeFile(file, JSON.stringify(drafts.policies));
  const oldFile = process.env.GAMEHUB_PROVISIONING_POLICY_FILE;
  process.env.GAMEHUB_PROVISIONING_POLICY_FILE = file;
  t.after(() => { if (oldFile === undefined) delete process.env.GAMEHUB_PROVISIONING_POLICY_FILE; else process.env.GAMEHUB_PROVISIONING_POLICY_FILE = oldFile; });
  const loaded = await provisioningApiOptionsFromEnvironment();
  const token = "023C-test-only-admin-not-an-operator-approval";
  for (const f of [java, bedrock]) {
    const id = f.request.providerId, policy = loaded.policies[id], request = drafts.requests.find(r => r.providerId === id)!;
    const sourceRef = id === "minecraft" ? "approved" : "bedrock-raknet-approved", profileId = String(request.providerOptions!.profileRef);
    const profile = policy.managedCreate!.profiles[profileId];
    assert.deepEqual(Object.keys(policy.managedCreate!.profiles), [profileId]);
    assert.deepEqual(profile, { ...f.policy.managedCreate!.profiles[sourceRef], acceptanceRef: id === "minecraft" ? "java-023c-license" : "bedrock-023c-license" });
    assert.deepEqual(policy.managedCreate!.acceptances, {});
    assert.equal((await policy.endpointInventory!()).complete, false);
    assert.deepEqual(policy.setup!.profiles, {});
    assert.equal(request.storage.mode, "create"); assert.equal((request.storage as { directoryName: string }).directoryName, request.serverId);
    assert.equal(drafts.proposedSetup[id].profiles[profileId].directoryName, request.serverId);
    assert.ok(request.serverId!.includes("023c")); assert.ok(!request.serverId!.includes("022g"));
    const target = path.join(f.root, request.serverId!); await assert.rejects(fs.access(target));
    const oldTarget = path.join(f.root, id === "minecraft" ? "java-022g-live" : "bedrock-022g-live");
    await fs.mkdir(oldTarget); await fs.writeFile(path.join(oldTarget, "preserve.txt"), "existing runtime");
    const rootBefore = await fs.readdir(f.root), { manager, repository } = await f.open();
    const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => manager, () => ({ policies: { [id]: policy }, authorize: tokenAdminAuthorizer(token) })));
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/provisioning`;
    const call = (route: string, body?: unknown) => fetch(base + route, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const options = await (await call("/setup-options")).json(); assert.equal(options.providers[0].profiles[0].available, false); assert.equal(options.providers[0].profiles[0].requestDefaults, undefined);
    assert.ok(!JSON.stringify(options).includes(f.base));
    const planned = await (await call("/plans", request)).json(); assert.equal(planned.plan.validation.valid, true);
    const preflight = await call("/preflight", { planId: planned.plan.planId }); assert.equal(preflight.status, 422); assert.equal((await preflight.json()).error.code, "LICENSE_ACCEPTANCE_REQUIRED");
    const apply = await call("/applies", { planId: planned.plan.planId, digest: "0".repeat(64), approved: true }); assert.equal(apply.status, 422); assert.equal((await apply.json()).error.code, "APPROVAL_REQUIRED");
    assert.equal(manager.getManagedCreatePreview(planned.plan.planId), undefined);
    assert.deepEqual(repository.provisioning.claims(), []); assert.deepEqual(repository.provisioning.managedDefinitions(), []); assert.deepEqual(await manager.listOperations(), []);
    await assert.rejects(fs.access(target)); assert.deepEqual(await fs.readdir(f.root), rootBefore); assert.equal(await fs.readFile(path.join(oldTarget, "preserve.txt"), "utf8"), "existing runtime");
  }
  assert.equal(JSON.stringify(source), before);
});

test("023C draft builder rejects source drift or reused approval/profile references", async t => {
  const java = await managedFixture(t), bedrock = await managedBedrockFixture(t), source = { minecraft: java.policy, "minecraft-bedrock": bedrock.policy };
  bedrock.bundle.version = "unknown";
  assert.throws(() => buildSetupWizardDrafts(source), /Pinned approved/);
  bedrock.bundle.version = "1.26.51.1";
  java.policy.managedCreate!.acceptances["java-023c-license"] = java.policy.managedCreate!.acceptances["prior-license"];
  assert.throws(() => buildSetupWizardDrafts(source), /must be fresh/);
});
