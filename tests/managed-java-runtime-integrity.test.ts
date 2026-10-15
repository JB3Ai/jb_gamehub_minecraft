import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { JavaManagedCreation } from "../packages/minecraft-provider/managed-create";
import { ProvisioningApplyException, ProvisioningInterrupted } from "../packages/core/provisioning-apply-contracts";
import { managedFixture } from "./helpers/managed-create-fixture";

const generated = "server-port=27051\nserver-ip=127.0.0.1\nlevel-name=managed-world\nenable-rcon=false\nenable-query=false\n";
// Exact server.properties produced by the real JBGH-022G-B Paper first boot.
const paperRewrite = syncFs.readFileSync(new URL("./fixtures/managed-java/paper-first-boot.properties", import.meta.url), "utf8");
const validator = new JavaManagedCreation().runtimeFileValidator!({ name: "configuration", relativePath: "server.properties", content: generated })!;
const drift = (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === "ARTIFACT_DRIFT";

test("managed Java accepts the real Paper first-boot configuration rewrite", () => {
  assert.notEqual(paperRewrite, generated);
  assert.match(paperRewrite, /level-type=minecraft\\:normal/);
  validator(Buffer.from(paperRewrite));
});

test("managed Java accepts comments, reordering, whitespace and unrelated escaped defaults", () => {
  validator(Buffer.from("# rewritten timestamp\r\n! comment\r\n \t\r\n enable-query \t= false\r\n level-name = managed-world\r\n server-ip = 127.0.0.1\r\n enable-rcon = false\r\n server-port = 27051\r\nlevel-type=minecraft\\:normal\r\nmotd=escaped\\=value\r\n"));
});

const invalid: Array<[string, (text: string) => string | Uint8Array]> = [
  ["changed port", (text) => text.replace("server-port=27051", "server-port=27052")],
  ["changed bind", (text) => text.replace("server-ip=127.0.0.1", "server-ip=0.0.0.0")],
  ["changed world", (text) => text.replace("level-name=managed-world", "level-name=other-world")],
  ["enabled RCON", (text) => text.replace("enable-rcon=false", "enable-rcon=true")],
  ["enabled query", (text) => text.replace("enable-query=false", "enable-query=true")],
  ...["server-port", "server-ip", "level-name", "enable-rcon", "enable-query"].map((key): [string, (text: string) => string] => ["missing " + key, (text) => text.replace(new RegExp("^" + key + "=.*(?:\\r?\\n|$)", "m"), "")]),
  ["escaped protected value", (text) => text.replace("server-port=27051", "server-port=270\\51")],
  ["duplicate protected key", (text) => text + "server-ip=127.0.0.1\n"],
  ["duplicate unrelated key", (text) => text + "motd=first\nmotd=second\n"],
  ["malformed active line", (text) => text + "not-a-property\n"],
  ["continuation hiding a protected key", (text) => "motd=continued\\\n" + text],
  ["invalid UTF-8", () => new Uint8Array([0xff])],
  ["meaningful trailing value whitespace", (text) => text.replace("level-name=managed-world", "level-name=managed-world ")],
  ["non-Java whitespace hiding a protected key", (text) => text.replace("server-port=27051", "\u00a0server-port=27051")],
];
for (const [label, mutate] of invalid) test("managed Java rejects " + label + " as ARTIFACT_DRIFT", () => {
  const changed = mutate(paperRewrite);
  assert.throws(() => validator(typeof changed === "string" ? Buffer.from(changed) : changed), drift);
});

async function created(t: TestContext, kind: "java" | "synthetic" = "java") {
  const f = await managedFixture(t, kind), first = await f.open();
  const plan = await first.manager.planProvisioning(f.request), preview = await first.manager.previewManagedCreation(plan, f.policy);
  const operation = await first.manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", f.options);
  assert.equal(operation.result.state, "PROVISIONED");
  return { ...f, ...first, operation };
}

test("completed managed Java restores and reaches the launch boundary after normalization without changing receipts", async (t) => {
  const f = await created(t);
  const receipts = f.repository.provisioning.fileReceipts(f.operation.operationId);
  const definition = f.repository.provisioning.managedDefinitions();
  await fs.writeFile(path.join(f.target, "server.properties"), paperRewrite);
  await fs.mkdir(path.join(f.target, "logs")); await fs.mkdir(path.join(f.target, "managed-world"));
  await f.manager.shutdown(); const restored = await f.open();
  await restored.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  assert.equal((await restored.manager.getServer(f.request.serverId!, f.providerId))?.ownership, "MANAGED");
  assert.equal((await restored.manager.getServerStatus(f.request.serverId!, f.providerId)).status, "offline");
  const spawn = t.mock.method(childProcess, "spawn", () => { throw new Error("FIXTURE_LAUNCH_REACHED_WITHOUT_EXECUTION"); });
  syncBuiltinESMExports();
  t.after(() => { spawn.mock.restore(); syncBuiltinESMExports(); });
  const start = await restored.manager.startServer(f.request.serverId!, f.providerId);
  const result = await restored.manager.getOperation(start.operationId);
  assert.equal(result?.error?.message, "FIXTURE_LAUNCH_REACHED_WITHOUT_EXECUTION");
  assert.deepEqual(restored.repository.provisioning.fileReceipts(f.operation.operationId), receipts);
  assert.deepEqual(restored.repository.provisioning.managedDefinitions(), definition);
});

for (const [label, mutate] of invalid.slice(0, 6)) test("completed managed Java restore rejects " + label, async (t) => {
  const f = await created(t), changed = mutate(paperRewrite);
  await fs.writeFile(path.join(f.target, "server.properties"), changed);
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
  if (label === "changed port") {
    const start = await f.manager.startServer(f.request.serverId!, f.providerId);
    assert.match((await f.manager.getOperation(start.operationId))?.error?.message ?? "", /ARTIFACT_DRIFT/);
  }
});

for (const file of [".jbgh-owner.json", "paper.jar", "eula.txt"]) test("managed Java keeps " + file + " byte-exact", async (t) => {
  const f = await created(t);
  await fs.writeFile(path.join(f.target, "server.properties"), paperRewrite);
  await fs.appendFile(path.join(f.target, file), "\n# mutation\n");
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});

test("managed Java normalization does not bypass revoked EULA authorization", async (t) => {
  const f = await created(t);
  await fs.writeFile(path.join(f.target, "server.properties"), paperRewrite);
  f.policy.managedCreate!.acceptances["prior-license"].revoked = true;
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), (error: unknown) => error instanceof ProvisioningApplyException && error.detail.code === "LICENSE_ACCEPTANCE_REQUIRED");
});

test("managed Java rejects a hard-linked configuration despite valid protected content", async (t) => {
  const f = await created(t);
  await fs.writeFile(path.join(f.target, "server.properties"), paperRewrite);
  await fs.link(path.join(f.target, "server.properties"), path.join(f.base, "config-alias"));
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});

test("managed Java rejects non-file configuration and oversized protected content", async (t) => {
  const f = await created(t), location = path.join(f.target, "server.properties");
  await fs.writeFile(location, generated + "#".repeat(64 * 1024));
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
  await fs.unlink(location); await fs.mkdir(location);
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});

test("unfinished CREATE recovery still requires exact configuration bytes and preserves drift", async (t) => {
  const f = await managedFixture(t), { manager } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  await assert.rejects(manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "operator", { ...f.options, afterStep: async (step) => { if (step === "publish-2") throw new ProvisioningInterrupted(); } }), ProvisioningInterrupted);
  await fs.writeFile(path.join(f.target, "server.properties"), paperRewrite); f.expire();
  const result = await manager.recoverManagedCreation(`create_${plan.planId}`, f.policy, f.options);
  assert.equal(result.result.state, "PARTIALLY_ROLLED_BACK");
  assert.equal(await fs.readFile(path.join(f.target, "server.properties"), "utf8"), paperRewrite);
});

test("synthetic completed-runtime content remains byte-exact", async (t) => {
  const f = await created(t, "synthetic");
  await fs.appendFile(path.join(f.target, "runtime.json"), "\n");
  await assert.rejects(f.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options), drift);
});
