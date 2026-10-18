import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import dgram from "node:dgram";
import net from "node:net";
import express from "express";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { bytesHash, creationHash } from "../packages/core/managed-create";
import { BedrockManagedCreation } from "../packages/bedrock-provider/managed-create";
import { BedrockProvider } from "../packages/bedrock-provider";
import { ProvisioningApplyException, ProvisioningInterrupted } from "../packages/core/provisioning-apply-contracts";
import { probeManagedEndpoint } from "../packages/core/managed-create-service";
import { provisioningRouter, tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";
import { managedFixture } from "./helpers/managed-create-fixture";
import { safeBundlePath } from "../packages/core/managed-bundle";
import { safeLeaf } from "../packages/core/managed-filesystem";

const failure = (code: string) => (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === code;
const drift = failure("ARTIFACT_DRIFT");
async function created(t: TestContext) {
  const f = await managedBedrockFixture(t), opened = await f.open();
  const plan = await opened.manager.planProvisioning(f.request), preview = await opened.manager.previewManagedCreation(plan, f.policy);
  const operation = await opened.manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", f.options);
  assert.equal(operation.result.state, "PROVISIONED", JSON.stringify(operation.error));
  return { ...f, ...opened, plan, preview, operation };
}

test("Bedrock bundle accepts vendor __brarchive components without widening managed names", async (t) => {
  assert.equal(safeBundlePath("behavior_packs/vanilla/__brarchive/recipes.brarchive"), true);
  assert.equal(safeLeaf("__brarchive"), false);
  const f = await managedBedrockFixture(t), relativePath = "assets/__brarchive/recipes.brarchive", content = "non-executable vendor archive fixture\n";
  await fs.mkdir(path.join(f.source, "assets/__brarchive")); await fs.writeFile(path.join(f.source, relativePath), content);
  f.bundle.files.push({ relativePath, size: Buffer.byteLength(content), sha256: bytesHash(Buffer.from(content)), classification: "immutable-runtime" });
  f.bundle.files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0); f.repin();
  const { manager } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const operation = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", f.options);
  assert.equal(operation.result.state, "PROVISIONED", JSON.stringify(operation.error));
  assert.equal(await fs.readFile(path.join(f.target, relativePath), "utf8"), content);
  await manager.shutdown(); const reopened = await f.open(); await reopened.manager.recoverManagedCreation(operation.operationId, f.policy, f.options);
  assert.equal((await reopened.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
  for (const value of ["__runtime", "__world"]) await assert.rejects(reopened.manager.planProvisioning({ ...f.request, storage: { mode: "create", rootId: "root", directoryName: value } }));
  await assert.rejects(reopened.manager.planProvisioning({ ...f.request, providerOptions: { profileRef: "bedrock-raknet-approved", worldName: "__world" } }));
});

test("Bedrock underscore paths retain traversal, reserved-name and ambiguous-path rejection", () => {
  for (const value of ["../__brarchive/x", "assets/../__brarchive/x", "assets//__brarchive/x", "assets/./__brarchive/x", "assets/__brarchive/CON", "assets/__brarchive/nul.json", "assets/__brarchive/x:stream", "assets/__brarchive/trailing.", "assets/__brarchive/trailing ", "assets/__brarchive/two..dots", "assets/__brarchive/.hidden", "D:/__brarchive/x", "/__brarchive/x", "assets\\__brarchive\\x"]) assert.equal(safeBundlePath(value), false, value);
});

test("Bedrock CREATE preview is read-only and binds a compact pinned bundle snapshot", async (t) => {
  const f = await managedBedrockFixture(t), { manager, repository } = await f.open();
  for (const key of ["mkdirSync", "writeFileSync", "copyFileSync", "renameSync", "unlinkSync", "rmSync"] as const) t.mock.method(syncFs, key, () => { throw new Error("filesystem mutation in preflight"); });
  t.mock.method(childProcess, "spawn", () => { throw new Error("process launch in preflight"); });
  t.mock.method(dgram, "createSocket", () => { throw new Error("UDP bind in preflight"); });
  t.mock.method(net, "createServer", () => { throw new Error("TCP bind in preflight"); });
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  assert.equal(manager.getCapabilities("minecraft-bedrock")["server.provision.create"], true);
  assert.equal(preview.bundle?.version, "1.26.51.1"); assert.equal(preview.bundle?.fileCount, f.bundle.files.length);
  assert.equal(preview.bundle?.manifestDigest, creationHash(f.bundle)); assert.equal(preview.files.length, 4);
  assert.ok(f.bundle.files.length > 16); assert.equal(preview.files.some((file) => file.relativePath.startsWith("assets/")), false);
  const snapshot = repository.provisioning.getManagedBundle(preview.bundle!.snapshotId)!;
  assert.equal(creationHash(snapshot), preview.bundle!.snapshotId);
  assert.deepEqual(repository.provisioning.claims(), []); assert.deepEqual(await fs.readdir(f.root), []);
});

test("Bedrock CREATE applies every manifested file, stays MANAGED/offline, and never launches BDS", async (t) => {
  let launches = 0;
  const spawn = t.mock.method(childProcess, "spawn", () => { launches++; throw new Error("CREATE must not launch BDS"); }); syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  const f = await created(t);
  assert.equal(f.operation.result.outcome, "applied"); assert.equal((await f.manager.getServer(f.request.serverId!, "minecraft-bedrock"))?.ownership, "MANAGED");
  assert.equal((await f.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
  assert.deepEqual(await f.manager.getWorlds(f.request.serverId!, "minecraft-bedrock"), []);
  assert.equal(syncFs.existsSync(path.join(f.target, "worlds")), false); assert.equal(syncFs.existsSync(path.join(f.target, "eula.txt")), false);
  for (const file of f.bundle.files.filter((file) => file.classification === "immutable-runtime")) {
    assert.equal(bytesHash(await fs.readFile(path.join(f.target, file.relativePath))), file.sha256);
    assert.equal(bytesHash(await fs.readFile(path.join(f.source, file.relativePath))), file.sha256);
  }
  const config = await fs.readFile(path.join(f.target, "server.properties"), "utf8");
  for (const value of ["transport=raknet", "server-port=29232", "server-portv6=29233", "level-name=managed-bedrock-world", "enable-lan-visibility=false", "online-mode=true", "allow-list=true"]) assert.ok(config.split("\n").includes(value));
  assert.equal(config.includes("Bedrock level"), false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.target, "allowlist.json"), "utf8")), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.target, "permissions.json"), "utf8")), []);
  assert.deepEqual(await fs.readdir(path.join(f.target, "assets/empty")), []);
  assert.equal((await fs.readdir(f.target)).some((name) => name.startsWith(".jbgh-file-")), false);
  const intents = f.repository.provisioning.fileIntents(f.operation.operationId);
  assert.ok(intents.some((intent) => intent.kind === "directory" && intent.relativePath === "assets/definitions"));
  assert.equal(f.repository.provisioning.claims(f.operation.operationId).filter((claim) => claim.state === "active").length, 4);
  assert.equal(f.repository.provisioning.managedDefinitions()[0].descriptor.manifest.filter((artifact) => artifact.name === "runtime").length, 1);
  const journal = f.repository.provisioning.journal(f.operation.operationId);
  assert.deepEqual(await f.manager.applyManagedCreation({ planId: f.plan.planId, digest: f.preview.digest, approved: true }, f.policy, "test-admin", f.options), f.operation);
  assert.deepEqual(f.repository.provisioning.journal(f.operation.operationId), journal);
  await f.manager.shutdown(); const reopened = await f.open();
  await reopened.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  assert.equal((await reopened.manager.getServer(f.request.serverId!, "minecraft-bedrock"))?.ownership, "MANAGED");
  assert.equal((await reopened.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
  const start = await reopened.manager.startServer(f.request.serverId!, "minecraft-bedrock");
  assert.match((await reopened.manager.getOperation(start.operationId))?.error?.message ?? "", /FIRST_BOOT_DEFERRED/);
  assert.equal(launches, 0);
});

const rejected = ["target exists", "protected root", "source overlap", "bundle hash drift", "missing bundle file", "missing source directory", "unapproved selected file", "case collision", "unsafe nested path", "hard-linked source", "source junction", "file limit", "aggregate limit", "missing inventory", "partial inventory", "IPv4 collision", "IPv6 collision", "missing license", "revoked license", "wrong bundle license", "wrong provider license", "wrong server license", "future license", "latest build", "NetherNet", "wrong platform", "missing compatibility", "missing transport", "missing IPv6", "LAN extra endpoint", "copied source world", "mutable binary"] as const;
for (const label of rejected) test("Bedrock preflight rejects " + label + " without claims or target mutation", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), policy = f.policy.managedCreate!, profile = policy.profiles["bedrock-raknet-approved"], acceptance = policy.acceptances["bds-license"];
  switch (label) {
    case "target exists": await fs.mkdir(f.target); break;
    case "protected root": f.policy.managedRoots.root = f.protectedRoot; break;
    case "source overlap": f.policy.managedRoots.root = f.source; break;
    case "bundle hash drift": await fs.appendFile(path.join(f.source, "vendor.dll"), "DRIFT"); break;
    case "missing bundle file": await fs.unlink(path.join(f.source, "vendor.dll")); break;
    case "missing source directory": await fs.rmdir(path.join(f.source, "assets/empty")); break;
    case "unapproved selected file": await fs.writeFile(path.join(f.source, "assets/foreign.dll"), "not approved"); break;
    case "case collision": f.bundle.files.push({ ...f.bundle.files[0], relativePath: f.bundle.files[0].relativePath.toUpperCase() }); f.bundle.files.sort((a, b) => a.relativePath < b.relativePath ? -1 : 1); f.repin(); break;
    case "unsafe nested path": f.bundle.files[0].relativePath = "assets/../outside.dll"; f.repin(); break;
    case "hard-linked source": await fs.link(path.join(f.source, "vendor.dll"), path.join(f.base, "alias.dll")); break;
    case "source junction": await fs.symlink(f.source, path.join(f.base, "source-alias"), "junction"); policy.bundleLocations!["bundle-source"] = path.join(f.base, "source-alias"); break;
    case "file limit": f.bundle.limits.maxFiles = 2; f.repin(); break;
    case "aggregate limit": f.bundle.limits.maxTotalBytes = 1; f.repin(); break;
    case "missing inventory": delete f.policy.endpointInventory; break;
    case "partial inventory": f.policy.endpointInventory = async () => ({ complete: false, bindings: [] }); break;
    case "IPv4 collision": f.policy.endpointInventory = async () => ({ complete: true, bindings: [{ hostId: "local", bindAddress: "127.0.0.1", port: 29232, transport: "udp" }] }); break;
    case "IPv6 collision": f.policy.endpointInventory = async () => ({ complete: true, bindings: [{ hostId: "local", bindAddress: "::1", port: 29233, transport: "udp" }] }); break;
    case "missing license": delete policy.acceptances["bds-license"]; break;
    case "revoked license": acceptance.revoked = true; break;
    case "wrong bundle license": acceptance.bundleDigest = "0".repeat(64); break;
    case "wrong provider license": acceptance.providerId = "minecraft"; break;
    case "wrong server license": acceptance.serverId = "other-server"; break;
    case "future license": acceptance.acceptedAt = "2999-01-01T00:00:00Z"; break;
    case "latest build": f.bundle.version = "latest"; f.repin(); break;
    case "NetherNet": f.bundle.transport = "nethernet"; f.repin(); break;
    case "wrong platform": f.bundle.platform = "linux"; f.repin(); break;
    case "missing compatibility": delete profile.configuration.compatibility; break;
    case "missing transport": delete profile.configuration.transport; break;
    case "missing IPv6": f.request.endpoints.pop(); break;
    case "LAN extra endpoint": profile.configuration.additionalDefaults = { "enable-lan-visibility": "true" }; break;
    case "copied source world": f.bundle.files.push({ relativePath: "worlds/Bedrock level/level.dat", size: 18, sha256: "0".repeat(64), classification: "immutable-runtime" }); f.repin(); break;
    case "mutable binary": f.bundle.files.find((file) => file.relativePath === "vendor.dll")!.classification = "protected-config"; f.repin(); break;
  }
  await assert.rejects(manager.previewManagedCreation(await manager.planProvisioning(f.request), f.policy));
  assert.equal(manager.listProvisioningClaims().length, 0);
  assert.deepEqual(await fs.readdir(f.root), label === "target exists" ? ["fresh"] : []);
  assert.deepEqual(await fs.readdir(f.protectedRoot), []);
});

test("Bedrock source drift after approval fails before target creation", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await fs.appendFile(path.join(f.source, "vendor.dll"), "drift");
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", f.options), drift);
  assert.deepEqual(await fs.readdir(f.root), []); assert.deepEqual(manager.listProvisioningClaims(), []);
});

test("Bedrock bundle/profile approval is pinned and cannot be silently re-approved at apply", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  f.policy.managedCreate!.profiles["bedrock-raknet-approved"].configuration.worldName = "changed-approved-world";
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", f.options), failure("PLAN_STALE"));
  assert.deepEqual(await fs.readdir(f.root), []); assert.deepEqual(manager.listProvisioningClaims(), []);
});

test("Bedrock managed bundle snapshot drift is detected before filesystem mutation", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const db = new DatabaseSync(path.join(f.base, "state.sqlite"));
  db.prepare("UPDATE managed_runtime_bundles SET data=? WHERE id=?").run("{}", preview.bundle!.snapshotId); db.close();
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", f.options), /snapshot drift/);
  assert.deepEqual(await fs.readdir(f.root), []);
});

test("Bedrock resource claims fence both UDP endpoints and the managed path atomically", async (t) => {
  const f = await managedBedrockFixture(t), { manager, repository } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", { ...f.options, afterStep: async (step) => { if (step === "claims") throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  const claims = manager.listProvisioningClaims(`create_${plan.planId}`).filter((claim) => claim.state === "active");
  assert.equal(claims.length, 4);
  for (const port of [29232, 29233]) assert.ok(claims.some((claim) => claim.resourceKey === JSON.stringify(["endpoint", "local", "udp", String(port)])));
  const other = { ...f.request, serverId: "other-bedrock", storage: { mode: "create" as const, rootId: "root", directoryName: "other" } };
  f.policy.managedCreate!.acceptances["bds-license"].serverId = "other-bedrock";
  await assert.rejects(manager.previewManagedCreation(await manager.planProvisioning(other), f.policy), failure("RESOURCE_CONFLICT"));
  const operation = repository.provisioning.get(`create_${plan.planId}`)!;
  f.expire(); const now = f.options.now();
  repository.provisioning.acquire(operation.operationId, "new-worker", now.toISOString(), new Date(now.getTime() + 1000).toISOString());
  let effect = false;
  assert.throws(() => repository.provisioning.managedGuard(operation, now.toISOString(), now.toISOString(), () => { effect = true; }), failure("LEASE_LOST"));
  assert.equal(effect, false); assert.deepEqual(await fs.readdir(f.root), []);
});

for (const boundary of ["claims", "intent:directory-0", "directory-0", "directory-2", "temp-4", "write-4", "publish-4", "clean-4", "definition", "activation", "before-final"]) test("Bedrock interrupted CREATE recovers at " + boundary, async (t) => {
  const f = await managedBedrockFixture(t), opened = await f.open(), plan = await opened.manager.planProvisioning(f.request), preview = await opened.manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(opened.manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", { ...f.options, afterStep: async (step) => { if (step === boundary) throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  assert.equal(await opened.manager.getServer(f.request.serverId!, "minecraft-bedrock"), undefined);
  await opened.manager.shutdown(); f.expire(); const reopened = await f.open();
  const result = await reopened.manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options);
  assert.equal(result.result.state, "PROVISIONED", JSON.stringify(result.error));
  assert.equal((await reopened.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
});

for (const boundary of ["directory-0", "directory-2", "publish-4", "definition", "activation", "before-final"]) test("Bedrock compensation removes only owned nested effects after " + boundary, async (t) => {
  const f = await managedBedrockFixture(t), { manager, repository } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", { ...f.options, afterStep: async (step) => { if (step === boundary) throw new Error("injected failure"); } });
  assert.equal(result.result.state, "ROLLED_BACK", JSON.stringify(result.rollbackErrors)); assert.deepEqual(await fs.readdir(f.root), []);
  assert.equal(repository.provisioning.claims(result.operationId).filter((claim) => claim.state === "active").length, 0);
  assert.equal(repository.provisioning.managedDefinitions().length, 0);
  for (const file of f.bundle.files) assert.equal(bytesHash(await fs.readFile(path.join(f.source, file.relativePath))), file.sha256);
});

test("Bedrock ambiguous nested directory receipt retains storage and all claims", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", { ...f.options, afterMutation: (intent) => { if (intent.id === "directory-0") throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  f.expire(); const result = await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options);
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.ok(syncFs.existsSync(path.join(f.target, "assets")));
  assert.equal(manager.listProvisioningClaims(result.operationId).filter((claim) => claim.state === "active").length, 4);
});

for (const mutation of ["foreign nested file", "changed owned file"] as const) test("Bedrock rollback preserves " + mutation, async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const relative = mutation === "foreign nested file" ? "assets/definitions/foreign.dll" : "assets/definitions/a.json";
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", { ...f.options, afterStep: async (step) => { if (step === "publish-4") { await fs.writeFile(path.join(f.target, relative), "preserve for review"); throw new Error("fail"); } } });
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.equal(await fs.readFile(path.join(f.target, relative), "utf8"), "preserve for review");
  assert.equal(manager.listProvisioningClaims(result.operationId).filter((claim) => claim.state === "active").length, 4);
});

test("Bedrock completed semantic configuration restores without changing manifests or receipts", async (t) => {
  const f = await created(t), receipts = f.repository.provisioning.fileReceipts(f.operation.operationId), definitions = f.repository.provisioning.managedDefinitions();
  const configPath = path.join(f.target, "server.properties"), original = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, "# BDS timestamp rewrite\r\n! comment\r\n\r\n" + original.trim().split("\n").reverse().map((line) => line.replace("=", " = ")).join("\r\n") + "\r\ndifficulty=easy\r\n");
  await fs.writeFile(path.join(f.target, "allowlist.json"), "[\r\n]\r\n");
  await f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  assert.deepEqual(f.repository.provisioning.fileReceipts(f.operation.operationId), receipts);
  assert.deepEqual(f.repository.provisioning.managedDefinitions(), definitions);
});

for (const relative of [".jbgh-owner.json", "bedrock_server.exe", "vendor.dll", "assets/definitions/a.json"]) test("Bedrock immutable " + relative + " stays byte-exact", async (t) => {
  const f = await created(t); await fs.appendFile(path.join(f.target, relative), "mutation");
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});
for (const relative of ["worlds", "logs", "unapproved.dll", "assets/definitions/foreign.json"]) test("stopped Bedrock does not authorize runtime output " + relative, async (t) => {
  const f = await created(t);
  if (relative.includes(".")) await fs.writeFile(path.join(f.target, relative), "foreign"); else await fs.mkdir(path.join(f.target, relative));
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});

test("Bedrock completed runtime rejects hard-linked immutable aliases and leftover private scratch", async (t) => {
  const f = await created(t), runtime = path.join(f.target, "bedrock_server.exe"), alias = path.join(f.base, "binary-alias");
  await fs.link(runtime, alias);
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
  await fs.unlink(alias); await fs.writeFile(path.join(f.target, ".jbgh-file-0"), "unreceipted scratch");
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});

test("Bedrock replacement of a nested parent is rejected and foreign contents survive compensation", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const outside = path.join(f.base, "foreign-assets"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "keep.txt"), "foreign");
  const result = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", { ...f.options, afterStep: async (step) => {
    if (step === "directory-0") { await fs.rmdir(path.join(f.target, "assets")); await fs.symlink(outside, path.join(f.target, "assets"), "junction"); }
  } });
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK"); assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "foreign");
  assert.equal(manager.listProvisioningClaims(result.operationId).filter((claim) => claim.state === "active").length, 4);
});

test("Bedrock generated properties reject every protected change and unsupported content", async (t) => {
  const f = await managedBedrockFixture(t), profile = f.policy.managedCreate!.profiles["bedrock-raknet-approved"], adapter = new BedrockManagedCreation();
  const file = adapter.manifest(f.request, profile, f.policy.managedCreate!.acceptances["bds-license"], f.bundle).files[0], validate = adapter.runtimeFileValidator!(file)!;
  for (const line of file.content!.trim().split("\n")) {
    assert.throws(() => validate(Buffer.from(file.content!.replace(line, line + "changed"))), drift, line);
    assert.throws(() => validate(Buffer.from(file.content!.replace(line + "\n", ""))), drift, "missing " + line);
  }
  for (const extra of ["not-a-property\n", "transport=raknet\n", "unreviewed-default=true\n", "difficulty=hard\n", "difficulty=easy\ndifficulty=easy\n", "server-ip=127.0.0.1\n", "escape=abc\\\n"]) assert.throws(() => validate(Buffer.from(file.content! + extra)), drift);
  assert.throws(() => validate(Buffer.from(file.content!.replace("transport=raknet", "transport=rak\\net"))), drift);
  assert.throws(() => validate(new Uint8Array([0xff])), drift);
  assert.throws(() => validate(Buffer.from("\ufeff" + file.content!)), drift);
  for (const policy of adapter.manifest(f.request, profile, f.policy.managedCreate!.acceptances["bds-license"], f.bundle).files.slice(1)) {
    const check = adapter.runtimeFileValidator!(policy)!;
    for (const content of ["{}", "[{}]", "null", "[", "[1]", "\ufeff[]"]) assert.throws(() => check(Buffer.from(content)), drift);
  }
});

test("Windows Bedrock source protection is built in even without a policy protectedPaths entry", () => {
  const paths = new BedrockProvider({ serverDir: path.resolve("protected-fixture") }).managedProtectedPaths();
  assert.ok(paths.includes(path.resolve("protected-fixture")));
  if (process.platform === "win32") assert.ok(paths.includes("D:\\MinecraftBedrockServer"));
});

test("UDP probes reject occupied sockets and close successful probes; CREATE never uses TCP for UDP", async (t) => {
  for (const [type, address] of [["udp4", "127.0.0.1"], ["udp6", "::1"]] as const) {
    const occupied = dgram.createSocket({ type, reuseAddr: false, ipv6Only: type === "udp6" }); occupied.bind(0, address); await once(occupied, "listening");
    const port = occupied.address().port;
    try { await assert.rejects(probeManagedEndpoint(port, address, "udp"), failure("ENDPOINT_OCCUPIED")); }
    finally { await new Promise<void>((resolve) => occupied.close(resolve)); }
    t.mock.method(net, "createServer", () => { throw new Error("TCP probe for UDP"); });
    await probeManagedEndpoint(port, address, "udp");
    const proof = dgram.createSocket(type); proof.bind(port, address); await once(proof, "listening"); await new Promise<void>((resolve) => proof.close(resolve));
  }
});

test("v9 migration preserves a completed v8 Java managed definition and receipts", async (t) => {
  const f = await managedFixture(t), opened = await f.open(), plan = await opened.manager.planProvisioning(f.request), preview = await opened.manager.previewManagedCreation(plan, f.policy);
  const result = await opened.manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "test-admin", f.options);
  const definitions = opened.repository.provisioning.managedDefinitions(), receipts = opened.repository.provisioning.fileReceipts(result.operationId);
  await opened.manager.shutdown(); const db = new DatabaseSync(path.join(f.base, "state.sqlite"));
  db.exec("DROP TABLE managed_runtime_boot_authorizations; DROP TABLE managed_runtime_bundles; PRAGMA user_version=8;"); db.close();
  const migrated = await f.open(); await migrated.manager.recoverManagedCreation(result.operationId, f.policy, f.options);
  assert.deepEqual(migrated.repository.provisioning.managedDefinitions(), definitions); assert.deepEqual(migrated.repository.provisioning.fileReceipts(result.operationId), receipts);
});

test("Bedrock CREATE API exposes bundle summary, requires explicit approval and restores stopped routing", async (t) => {
  const f = await managedBedrockFixture(t), { manager } = await f.open(), token = "test-only-admin-token-022gc1-01234567890123456789";
  const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => manager, () => ({ authorize: tokenAdminAuthorizer(token), policies: { "minecraft-bedrock": f.policy } })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  // API uses production UDP probes; reserve ephemeral ports to select unused test endpoints.
  const sockets = [dgram.createSocket("udp4"), dgram.createSocket({ type: "udp6", ipv6Only: true })];
  for (const [index, socket] of sockets.entries()) { socket.bind(0, index ? "::" : "0.0.0.0"); await once(socket, "listening"); (f.request.endpoints[index] as { port: { mode: "fixed"; value: number } }).port.value = socket.address().port; }
  for (const socket of sockets) await new Promise<void>((resolve) => socket.close(resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/provisioning`;
  const call = (route: string, body?: unknown, auth = token) => fetch(url + route, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + auth, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const safe = async (response: Response) => {
    const text = await response.text(); for (const secret of [f.base, f.source, token, "test-only-operator", "test-only-terms", "sourceIdentity", "sourcePath", "snapshotId"]) assert.ok(!text.includes(secret), "private detail in API");
    return JSON.parse(text);
  };
  assert.equal((await call("/plans", f.request, "bad")).status, 401);
  const planned = await safe(await call("/plans", f.request)), checked = await safe(await call("/preflight", { planId: planned.plan.planId }));
  assert.equal(checked.status, "PASS"); assert.equal(checked.creation.startup, "remain-stopped"); assert.equal(checked.creation.bundle.version, "1.26.51.1");
  assert.equal(checked.creation.bundle.fileCount, f.bundle.files.length); assert.equal(checked.creation.files.length, 4);
  const input = { planId: planned.plan.planId, digest: checked.creation.digest, approved: true };
  assert.equal((await call("/applies", { ...input, approved: false })).status, 400);
  assert.equal((await call("/applies", { ...input, digest: "wrong" })).status, 409);
  const applied = await safe(await call("/applies", input)); assert.equal(applied.state, "PROVISIONED"); assert.equal(applied.ownership, "MANAGED");
  assert.equal((await manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
  for (const endpoint of f.request.endpoints) if (endpoint.transport === "udp" && endpoint.port.mode === "fixed") await probeManagedEndpoint(endpoint.port.value, endpoint.bindAddress, "udp");
});
