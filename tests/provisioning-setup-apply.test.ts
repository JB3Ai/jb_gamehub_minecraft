import { readySetupState } from "./helpers/wizard-readiness";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { provisioningRouter, tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { managedFixture } from "./helpers/managed-create-fixture";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";
import { applyProvisioning, createProvisioningPlan, getProvisioningSetupOptions, preflightProvisioning, reconcileProvisioning, ProvisioningClientError } from "../src/dashboard/apiClient";
import { initialSetupState, setupWizardReducer, setupRequestFromState } from "../src/setup/useSetupWizard";

const token = "023B-fixture-admin-not-a-real-credential-0123456789";
for (const kind of ["java", "bedrock"] as const) test(`${kind} wizard performs exact approved HTTP apply and completes MANAGED/stopped`, async t => {
  const f = kind === "java" ? await managedFixture(t) : await managedBedrockFixture(t), { manager } = await f.open();
  const id = f.request.providerId as "minecraft" | "minecraft-bedrock", ref = String(f.request.providerOptions!.profileRef);
  const sourceBefore = await fs.readFile(kind === "java" ? f.source : path.join(f.source, "bedrock_server.exe"));
  const policy = { ...f.policy, setup: { profiles: { [ref]: { rootId: "root", directoryName: "family-created", endpoints: f.request.endpoints } } } }, policyBefore = JSON.stringify(policy);
  const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => manager, () => ({ policies: { [id]: policy }, authorize: tokenAdminAuthorizer(token) })));
  app.get("/api/operations", async (req, res) => { res.json({ operations: await manager.listOperations({ providerId: id, serverId: String(req.query.serverId), limit: 500 }) }); });
  app.get("/api/operations/:id", async (req, res) => { res.json(await manager.getOperation(req.params.id)); });
  app.get("/api/servers", async (_req, res) => { res.json({ servers: await Promise.all((await manager.listServers()).map(async server => ({ ...server, status: (await manager.getServerStatus(server.id, server.providerId)).status }))) }); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port, nativeFetch = globalThis.fetch, calls: Array<{ route: string; body: any }> = [];
  t.mock.method(globalThis, "fetch", (input: any, init?: RequestInit) => { const route = String(input); assert.match(route, /^\/api\/(provisioning\/(setup-options|plans|preflight|applies)|operations|servers)(\/|\?|$)/); calls.push({ route, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return nativeFetch(url + route, init); });
  const connection = { token }, options = await getProvisioningSetupOptions(connection);
  let state = setupWizardReducer(readySetupState(), { type: "OPTIONS_LOADED", options, generation: 1 });
  state = setupWizardReducer(state, { type: "SELECT_PROVIDER", providerId: id, serverId: "family-created", generation: 2 });
  state = setupWizardReducer(state, { type: "UPDATE_CONFIGURATION", patch: { displayName: "Family Server", worldName: "Family World" }, generation: 3 });
  const plan = await createProvisioningPlan(setupRequestFromState(state), connection);
  state = setupWizardReducer(state, { type: "PLAN_STARTED", generation: 4 }); state = setupWizardReducer(state, { type: "PLAN_CREATED", plan, generation: 4 });
  const preflight = await preflightProvisioning(plan.plan.planId, connection);
  state = setupWizardReducer(state, { type: "PREFLIGHT_PASSED", preflight, generation: 4 }); assert.equal(state.step, "review");
  const tuple = { planId: plan.plan.planId, digest: preflight.creation!.digest, approved: true as const };
  // A stale approval is rejected before any operation/target exists.
  await assert.rejects(applyProvisioning({ ...tuple, digest: "0".repeat(64) }, connection), (error: ProvisioningClientError) => error.code === "APPROVAL_MISMATCH");
  assert.deepEqual(await fs.readdir(f.root), []);
  state = setupWizardReducer(state, { type: "APPROVAL_CHANGED", approved: true, generation: 4 }); state = setupWizardReducer(state, { type: "APPLY_STARTED", generation: 5 });
  const result = await applyProvisioning(tuple, connection); state = setupWizardReducer(state, { type: "APPLY_SUCCEEDED", result, generation: 5 });
  assert.equal(state.step, "complete"); assert.equal(result.state, "PROVISIONED"); assert.equal(result.outcome, "applied"); assert.deepEqual(result.residuals, []);
  assert.equal((await manager.getServer(result.serverId, id))?.ownership, "MANAGED"); assert.equal((await manager.getServerStatus(result.serverId, id)).status, "offline");
  const applies = calls.filter(c => c.route.endsWith("/applies")); assert.equal(applies.length, 2); assert.deepEqual(applies[1].body, tuple);
  for (const file of preflight.creation!.files) { const data = await fs.readFile(path.join(f.root, preflight.creation!.directoryName, file.relativePath)); assert.equal(createHash("sha256").update(data).digest("hex"), file.sha256); }
  assert.deepEqual(await fs.readFile(kind === "java" ? f.source : path.join(f.source, "bedrock_server.exe")), sourceBefore); assert.equal(JSON.stringify(policy), policyBefore);
  assert.ok(!(await fs.readdir(path.join(f.root, preflight.creation!.directoryName))).includes("worlds"));
  const readsBefore = calls.length, reconciled = await reconcileProvisioning(plan.plan.planId, connection);
  assert.equal(reconciled.apply.operationId, result.operationId); assert.equal(reconciled.apply.state, "PROVISIONED");
  assert.equal(calls.filter(c => c.route.endsWith("/applies")).length, 2, "Read-only reconciliation cannot apply again");
  assert.ok(calls.slice(readsBefore).every(c => c.body === undefined));
});

test("apply client handles HTTP, network, malformed response and terminal rollback without retries or raw diagnostics", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("private network failure"); });
  const input = { planId: "plan", digest: "a".repeat(64), approved: true as const };
  await assert.rejects(applyProvisioning(input, { token }), (e: ProvisioningClientError) => e.code === "NETWORK_ERROR" && !e.message.includes("private")); assert.equal(calls, 1);
  for (const status of [401, 403, 409, 503]) {
    calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { code: "PLAN_STALE", message: "private C:\\runtime" } }), { status }); };
    await assert.rejects(applyProvisioning(input, { token }), (e: ProvisioningClientError) => e.status === status && !e.message.includes("runtime")); assert.equal(calls, 1);
  }
  const result = { operationId: "operation", providerId: "minecraft", serverId: "family", ownership: "MANAGED", state: "ROLLED_BACK", outcome: "failed", residuals: [] };
  for (const state of ["ROLLED_BACK", "PARTIALLY_ROLLED_BACK"]) { globalThis.fetch = async () => Response.json({ ...result, state }); assert.equal((await applyProvisioning(input, { token })).state, state); }
  for (const response of [{ ...result, residuals: null }, { ...result, ownership: "ATTACHED" }, { ...result, operationId: "" }, { ...result, providerId: "unknown" }, { ...result, error: {} }]) {
    globalThis.fetch = async () => Response.json(response); await assert.rejects(applyProvisioning(input, { token }), (e: ProvisioningClientError) => e.code === "INVALID_RESPONSE");
  }
});
