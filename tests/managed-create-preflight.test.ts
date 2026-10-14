import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import path from "node:path";
import { managedFixture } from "./helpers/managed-create-fixture";
import { BedrockProvider } from "../packages/bedrock-provider";
import { MinecraftProvider } from "../packages/minecraft-provider";
import { DatabaseSync } from "node:sqlite";

test("planning/preflight read only and never bind, spawn, write, or claim", async (t) => {
  const f = await managedFixture(t), { manager, repository } = await f.open();
  const fail = () => { throw new Error("runtime mutation in preview"); };
  for (const key of ["mkdirSync", "writeFileSync", "copyFileSync", "renameSync", "unlinkSync", "rmSync"] as const) t.mock.method(syncFs, key, fail);
  t.mock.method(net, "createServer", fail); t.mock.method(childProcess, "spawn", fail);
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  assert.equal(preview.leaf, "fresh"); assert.equal(repository.provisioning.claims().length, 0); assert.deepEqual(await fs.readdir(f.root), []);
});
for (const label of ["unknown root", "relative policy root", "protected root", "existing empty target", "junction root", "unknown profile", "missing artifact", "artifact hash mismatch", "missing Java", "bad Java hash", "bad Java compatibility", "missing acceptance", "revoked acceptance", "wrong acceptance scope", "missing inventory", "endpoint collision", "wrong bind policy"]) {
  test("managed preflight rejects " + label, async (t) => {
    const f = await managedFixture(t), { manager } = await f.open();
    const profile = f.policy.managedCreate!.profiles.approved;
    switch (label) {
      case "unknown root": f.policy.managedRoots = {}; break;
      case "relative policy root": f.policy.managedRoots.root = "relative"; break;
      case "protected root": f.policy.protectedPaths = [f.root]; break;
      case "existing empty target": await fs.mkdir(f.target); break;
      case "junction root": await fs.symlink(f.root, path.join(f.base, "alias"), "junction"); f.policy.managedRoots.root = path.join(f.base, "alias"); break;
      case "unknown profile": f.policy.managedCreate!.profiles = {}; break;
      case "missing artifact": await fs.unlink(f.source); break;
      case "artifact hash mismatch": profile.artifacts[0].sha256 = "0".repeat(64); break;
      case "missing Java": f.policy.artifactLocations.java = path.join(f.base, "missing-java"); break;
      case "bad Java hash": profile.runtime!.sha256 = "0".repeat(64); break;
      case "bad Java compatibility": profile.runtime!.compatibility = "java-8"; break;
      case "missing acceptance": f.policy.managedCreate!.acceptances = {}; break;
      case "revoked acceptance": f.policy.managedCreate!.acceptances["prior-license"].revoked = true; break;
      case "wrong acceptance scope": f.policy.managedCreate!.acceptances["prior-license"].serverId = "other-server"; break;
      case "missing inventory": delete f.policy.endpointInventory; break;
      case "endpoint collision": f.policy.endpointInventory = async () => ({ complete: true, bindings: [{ hostId: "local", transport: "tcp", bindAddress: "0.0.0.0", port: 27051 }] }); break;
      case "wrong bind policy": profile.configuration.bindAddress = "0.0.0.0"; break;
    }
    await assert.rejects(manager.previewManagedCreation(await manager.planProvisioning(f.request), f.policy));
    assert.equal((await fs.readdir(f.root)).filter((name) => name !== "fresh").length, 0);
    assert.equal(manager.listProvisioningClaims().length, 0);
  });
}
for (const value of ["../escape", "D:\\escape", "/absolute", "CON", "aux.txt", "a/b", "a\\b", "a:stream", "trailing.", "two..dots"]) {
  test("unsafe directory/world inputs fail: " + value, async (t) => {
    const f = await managedFixture(t), { manager } = await f.open();
    await assert.rejects(manager.planProvisioning({ ...f.request, storage: { mode: "create", rootId: "root", directoryName: value } }));
    await assert.rejects(async () => {
      const plan = await manager.planProvisioning({ ...f.request, providerOptions: { profileRef: "approved", worldName: value } });
      await manager.previewManagedCreation(plan, f.policy);
    });
  });
}
for (const key of ["artifactPath", "javaPath", "artifactRef", "javaRuntimeRef", "sha256", "eula", "command", "rootPath"]) {
  test("profile-reference request rejects trusted-data injection: " + key, async (t) => {
    const f = await managedFixture(t), { manager } = await f.open();
    await assert.rejects(manager.planProvisioning({ ...f.request, providerOptions: { profileRef: "approved", [key]: "untrusted" } }));
  });
}
test("managed CREATE requires approved roots separate from artifact and adoption paths", async (t) => {
  const f = await managedFixture(t), { manager } = await f.open();
  f.policy.adoptionLocations.external = f.root;
  await assert.rejects(manager.previewManagedCreation(await manager.planProvisioning(f.request), f.policy));
});
test("existing server identity and native Bedrock CREATE stay unsupported", async (t) => {
  const f = await managedFixture(t), { manager } = await f.open();
  await assert.rejects(manager.previewManagedCreation(await manager.planProvisioning({ ...f.request, serverId: "legacy-java" }), f.policy));
  await manager.register(new BedrockProvider());
  assert.equal(manager.getCapabilities("minecraft-bedrock")["server.provision.create"], undefined);
  assert.equal(new MinecraftProvider({ serverDir: "unused" }).getCapabilities()["server.provision.apply"], undefined);
});
test("nested active physical-path claims block a new CREATE target", async (t) => {
  const f = await managedFixture(t), { manager, repository } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async () => { throw new (await import("../packages/core/provisioning-apply-contracts")).ProvisioningInterrupted(); } }));
  const second = { ...f.request, serverId: "nested", storage: { mode: "create" as const, rootId: "nested", directoryName: "child" } };
  await fs.mkdir(f.target); f.policy.managedRoots.nested = f.target;
  await assert.rejects(manager.previewManagedCreation(await manager.planProvisioning(second), f.policy));
  assert.equal(repository.provisioning.claims(`create_${plan.planId}`).filter((claim) => claim.state === "active").length, 3);
});
test("migration v8 preserves v7 adopted records and creates managed effect tables", async (t) => {
  const f = await managedFixture(t); const first = await f.open(); await first.manager.shutdown();
  const db = new DatabaseSync(path.join(f.base, "state.sqlite"));
  const adoptedData = JSON.stringify({ effectId: "pre-v8-adopted", operationId: "legacy-attachment", digest: "approved-v7", fencingToken: 1, attachedAt: "2026-10-12T10:00:00Z", descriptor: { serverId: "existing-adopted", providerId: "minecraft", runtimeRoot: path.join(f.base, "adopted"), ownership: "ADOPTED", destructiveOwnership: false } });
  db.prepare("INSERT INTO runtime_attachments(effect_id,server_id,data) VALUES (?,?,?)").run("pre-v8-adopted", "existing-adopted", adoptedData);
  db.exec("DROP TABLE provisioning_create_previews; DROP TABLE managed_runtime_definitions; DROP TABLE provisioning_file_intents; DROP TABLE provisioning_file_receipts; PRAGMA user_version=7;");
  db.close(); const migrated = await f.open();
  assert.deepEqual(migrated.repository.provisioning.attachmentRecords()[0], JSON.parse(adoptedData));
  const observed = new DatabaseSync(path.join(f.base, "state.sqlite"));
  const tables = observed.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const table of ["runtime_attachments", "provisioning_external_intents", "managed_runtime_definitions", "provisioning_file_intents", "provisioning_file_receipts"]) assert.ok(tables.includes(table));
  assert.equal(observed.prepare("PRAGMA user_version").get()?.user_version, 8); observed.close();
});
