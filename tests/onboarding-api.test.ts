import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { onboardingRouter } from "../packages/core/onboarding-api";
import { tokenAdminAuthorizer, type ProvisioningApiOptions } from "../packages/core/provisioning-api";
import type { ReadinessProbes } from "../packages/core/host-readiness";
import { managedFixture } from "./helpers/managed-create-fixture";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";
import { startServer } from "../server";
import { DatabaseSync } from "node:sqlite";

const token = "024A-fixture-admin-key-not-real-0123456789";
function probes(): ReadinessProbes {
  return { host: async () => ({ platform: "win32", architecture: "x64", elevated: false, capabilityChecksAvailable: true, inventory: { complete: true, bindings: [] } }),
    storage: async () => ({ exists: true, access: "allowed-advisory", availableBytes: 4n * 1024n ** 3n }), runtimes: async () => [] };
}
async function listen(t: import("node:test").TestContext, manager: any, options: ProvisioningApiOptions, inspect: ReadinessProbes | ((selected?: string) => ReadinessProbes)) {
  const app = express(); app.use(express.json()); app.use("/api/setup", onboardingRouter(() => manager, () => options, typeof inspect === "function" ? inspect : () => inspect));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/setup/readiness`;
  return { base, get: () => fetch(base, { headers: { authorization: "Bearer " + token } }) };
}
test("readiness requires existing admin authorization before invoking any probe", async t => {
  const f = await managedFixture(t), { manager } = await f.open(); let invoked = 0;
  const inspect = probes(); inspect.host = async () => { invoked++; throw new Error("must not reach probe"); };
  const options: ProvisioningApiOptions = { policies: { minecraft: f.policy }, authorize: tokenAdminAuthorizer(token) };
  const { base } = await listen(t, manager, options, inspect);
  for (const credential of [undefined, "invalid"]) assert.equal((await fetch(base, { headers: credential ? { authorization: "Bearer " + credential } : {} })).status, 401);
  options.authorize = () => ({ actor: "viewer", admin: false }); assert.equal((await fetch(base)).status, 403);
  options.authorize = () => { throw new Error("private C:/policy"); }; assert.equal((await fetch(base)).status, 503);
  assert.equal(invoked, 0);
});

test("readiness uses trusted refs only, rejects client paths/mutations, and refreshes observations on retry", async t => {
  let auditDb: DatabaseSync | undefined; t.after(() => auditDb?.close());
  const f = await managedFixture(t), { manager } = await f.open(), inspect = probes(); let bytes = 1n, observations = 0;
  inspect.storage = async location => { assert.equal(location, f.root); observations++; return { exists: true, access: "allowed-advisory", availableBytes: bytes }; };
  const options = { policies: { minecraft: { ...f.policy, setup: { profiles: { approved: { rootId: "root", directoryName: "fresh", endpoints: f.request.endpoints } } } } }, authorize: tokenAdminAuthorizer(token) };
  const { base, get } = await listen(t, manager, options, inspect);
  const db = auditDb = new DatabaseSync(path.join(f.base, "state.sqlite"), { readOnly: true });
  const auditBefore = db.prepare("SELECT count(*) AS count FROM audit_log").get();
  const first = await get(); assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store"); assert.equal((await first.json()).status, "BLOCKED");
  bytes = 4n * 1024n ** 3n; const second = await get(), report = await second.json(); assert.equal(report.status, "WARNING"); assert.equal(observations, 2);
  assert.equal(report.authorizationGranted, false); assert.ok(report.checks.some((c: any) => c.code === "ENDPOINT_OBSERVED_FREE"));
  for (const secret of [f.root, f.source, token, "artifactLocations", "acceptances"]) assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal((await fetch(base + "?path=C:/unreviewed", { headers: { authorization: "Bearer " + token } })).status, 400);
  assert.equal((await fetch(base, { method: "POST", headers: { authorization: "Bearer " + token } })).status, 405);
  assert.equal(observations, 2); assert.deepEqual(await fs.readdir(f.root), []);
  assert.deepEqual(db.prepare("SELECT count(*) AS count FROM audit_log").get(), auditBefore, "Readiness must not even persist an authorization audit row");
});

test("concurrent checks share only the in-flight observation; later retries execute again", async t => {
  const f = await managedFixture(t), { manager } = await f.open(), inspect = probes(); let started!: () => void, release!: () => void, calls = 0;
  const began = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const host = await inspect.host(); inspect.host = async () => { calls++; started(); await gate; return host; };
  const { get } = await listen(t, manager, { policies: { minecraft: f.policy }, authorize: tokenAdminAuthorizer(token) }, inspect);
  const first = get(); await began; const second = get(); await new Promise(resolve => setTimeout(resolve, 30)); release();
  assert.equal((await first).status, 200); assert.equal((await second).status, 200); assert.equal(calls, 1);
  await get(); assert.equal(calls, 2);
});

test("a remote-host policy cannot be inspected as if its paths and ports were local", async t => {
  const f = await managedFixture(t), { manager } = await f.open(), inspect = probes(); let called = false;
  inspect.host = async () => { called = true; throw new Error("unexpected local probe"); };
  const { get } = await listen(t, manager, { policies: { minecraft: { ...f.policy, hostId: "remote" } }, authorize: tokenAdminAuthorizer(token) }, inspect);
  const response = await get(); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "READINESS_UNAVAILABLE"); assert.equal(called, false);
});

for (const kind of ["java", "bedrock"] as const) test(`readiness preserves existing ${kind} managed runtime, ownership, claims, sources and policy`, async t => {
  const f = kind === "java" ? await managedFixture(t) : await managedBedrockFixture(t), { manager } = await f.open();
  const plan = await manager.planProvisioning(f.request); manager.saveProvisioningPlan(plan);
  const preview = await manager.previewManagedCreation(plan, f.policy), operation = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy);
  assert.equal(operation.result.state, "PROVISIONED");
  const before = JSON.stringify({ operation: manager.getProvisioningOperation(operation.operationId), definitions: manager.listManagedRuntimes(), claims: manager.listProvisioningClaims() }), policyBefore = JSON.stringify(f.policy);
  const files: Array<[string, Buffer]> = [];
  async function capture(directory: string) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const name = path.join(directory, entry.name); if (entry.isDirectory()) await capture(name); else files.push([name, await fs.readFile(name)]); } }
  await capture(f.target); const source = kind === "java" ? f.source : path.join(f.source, "bedrock_server.exe"), sourceBefore = await fs.readFile(source);
  const { get } = await listen(t, manager, { policies: { [f.request.providerId]: f.policy }, authorize: tokenAdminAuthorizer(token) }, probes());
  assert.equal((await get()).status, 200);
  assert.equal(JSON.stringify({ operation: manager.getProvisioningOperation(operation.operationId), definitions: manager.listManagedRuntimes(), claims: manager.listProvisioningClaims() }), before);
  assert.equal(JSON.stringify(f.policy), policyBefore); for (const [name, content] of files) assert.deepEqual(await fs.readFile(name), content);
  assert.deepEqual(await fs.readFile(source), sourceBefore); assert.equal((await manager.getServerStatus(f.request.serverId, f.request.providerId)).status, "offline");
  const report = await (await get()).json(); assert.equal(report.configuration.managedRuntimeCount, 1); assert.equal(report.configuration.preserveExisting, true);
});

test("provider-specific concurrent checks never share another provider's prerequisite verdict", async t => {
  const f = await managedFixture(t), { manager } = await f.open();
  const { base } = await listen(t, manager, { policies: { minecraft: f.policy }, authorize: tokenAdminAuthorizer(token) }, selected => ({ ...probes(), runtimes: async () => [{ id: "runtime.selected", category: "runtime", code: "JAVA_REQUIRED_NOT_DISCOVERED", status: selected === "minecraft" ? "BLOCKED" : "WARNING" }] }));
  const [java, bedrock] = await Promise.all(["minecraft", "minecraft-bedrock"].map(async provider => (await fetch(base + "?provider=" + provider, { headers: { authorization: "Bearer " + token } })).json()));
  assert.equal(java.status, "BLOCKED"); assert.equal(bedrock.status, "WARNING");
});

test("real GameHub exposes authenticated readiness without changing public REST discovery", async t => {
  const f = await managedFixture(t), previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const server = await startServer(0, { minecraftServerDir: f.base, persistenceDbPath: path.join(f.base, "api.sqlite"), aiProvider: "fallback" }, { policies: { minecraft: f.policy }, authorize: tokenAdminAuthorizer(token) });
  if (!server.listening) await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    assert.equal((await fetch(base + "/api/setup/readiness")).status, 401);
    const response = await fetch(base + "/api/setup/readiness", { headers: { authorization: "Bearer " + token } });
    assert.equal(response.status, 200); const report = await response.json();
    assert.equal(report.readOnly, true); assert.equal(report.authorizationGranted, false); assert.ok(["WARNING", "BLOCKED"].includes(report.status));
    assert.ok(!JSON.stringify(report).includes(f.base)); assert.ok(!JSON.stringify(report).includes(token));
    assert.equal((await fetch(base + "/api/providers")).status, 200);
    assert.deepEqual(await fs.readdir(f.root), []);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
