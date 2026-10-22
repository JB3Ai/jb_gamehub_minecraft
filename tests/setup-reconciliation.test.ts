import { readySetupState } from "./helpers/wizard-readiness";
import test from "node:test";
import assert from "node:assert/strict";
import { ProvisioningClientError, reconcileProvisioning } from "../src/dashboard/apiClient";
import { initialSetupState, setupWizardReducer } from "../src/setup/useSetupWizard";
import type { ReconciledSetup, SetupOptionsResponse } from "../src/dashboard/provisioningTypes";

const planId = "plan_" + "a".repeat(64), token = "fixture-read-only-reconciliation-key";
function fixture() {
  const endpoints = [{ id: "game", protocol: "java-paper", transport: "tcp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 27061 } }];
  const request = { schemaVersion: 1, providerId: "minecraft", serverId: "reviewed-server", displayName: "Family server", hostId: "local", storage: { mode: "create", rootId: "root", directoryName: "reviewed-target" }, endpoints, providerOptions: { profileRef: "approved", worldName: "Family World" } };
  const plan = { plan: { schemaVersion: 1, planId, providerId: request.providerId, serverId: request.serverId, displayName: request.displayName, mode: "create", status: "planned", request, validation: { valid: true, errors: [] } }, digest: "outer-digest",
    creation: { digest: "b".repeat(64), ownership: "MANAGED", profileId: "approved", serverId: request.serverId, directoryName: "reviewed-target", worldName: "Family World", endpoints, files: [], startup: "remain-stopped", deferredValidations: ["first-boot"] } };
  // Deliberately unrelated to a presumed create_<planId> naming convention.
  const operation = { operationId: "opaque-durable-operation", providerId: request.providerId, serverId: request.serverId, type: "server.provision.apply", status: "completed", result: { planId, providerId: request.providerId, serverId: request.serverId, state: "PROVISIONED", outcome: "applied", issues: [] } };
  const inventory = { servers: [{ id: request.serverId, providerId: request.providerId, ownership: "MANAGED", status: "offline" }] };
  const options = { providers: [{ providerId: request.providerId, label: "Java", profiles: [{ profileRef: "approved", revision: "1", label: "Reviewed", available: true, defaults: { worldName: "Family World" }, storage: { rootId: "root", directoryName: "reviewed-target" }, requestDefaults: { hostId: "local", serverId: request.serverId, endpoints } }] }] } as SetupOptionsResponse;
  return { plan, operation, inventory, options };
}
test("lost apply response reconciles exact stored plan and opaque operation with GET only", async t => {
  const f = fixture(), calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    calls.push(input); assert.equal(init.method, "GET"); assert.equal(new Headers(init.headers).get("authorization"), "Bearer " + token); assert.equal(init.body, undefined);
    return Response.json(input.includes("/plans/") ? f.plan : input.includes("/operations?") ? { operations: [f.operation] } : input.includes("/operations/") ? f.operation : f.inventory);
  });
  const result = await reconcileProvisioning(planId, { token });
  assert.equal(result.apply.operationId, f.operation.operationId); assert.equal(calls.length, 4);
  assert.ok(!calls.some(url => /applies|preflight/.test(url)));
  let state = setupWizardReducer(readySetupState(), { type: "OPTIONS_LOADED", options: f.options, generation: 1 });
  state = setupWizardReducer(state, { type: "RECONCILE_STARTED", generation: 2 });
  state = setupWizardReducer(state, { type: "RECONCILED", result, generation: 2 });
  assert.equal(state.step, "complete"); assert.equal(state.approved, false); assert.equal(state.configuration.displayName, "Family server");
  assert.deepEqual(setupWizardReducer(state, { type: "COMPLETE", generation: 3 }), initialSetupState(3));
});

for (const change of ["missing", "ambiguous", "provider", "server", "plan", "type", "running", "rollback", "partial", "error", "issues", "unmanaged", "online", "target", "world"] as const) test(`reconciliation fails closed: ${change}`, async t => {
  const f = fixture();
  const history: any = { operations: [structuredClone(f.operation)] };
  if (change === "missing") history.operations = [];
  if (change === "ambiguous") history.operations.push(structuredClone(f.operation));
  if (change === "provider") f.operation.providerId = "minecraft-bedrock";
  if (change === "server") f.operation.serverId = "foreign-server";
  if (change === "plan") f.operation.result.planId = "plan_" + "c".repeat(64);
  if (change === "type") f.operation.type = "server.start";
  if (change === "running") f.operation.status = "running";
  if (change === "rollback") f.operation.result.state = "ROLLED_BACK";
  if (change === "partial") f.operation.result.state = "PARTIALLY_ROLLED_BACK";
  if (change === "error") (f.operation as any).error = { code: "FAILURE", message: "private diagnostics" };
  if (change === "issues") (f.operation.result.issues as any[]).push({ code: "RETAINED" });
  if (change === "unmanaged") f.inventory.servers[0].ownership = "ATTACHED";
  if (change === "online") f.inventory.servers[0].status = "online";
  if (change === "target") f.plan.creation.directoryName = "foreign-target";
  if (change === "world") f.plan.creation.worldName = "foreign-world";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { assert.equal(init.method, "GET"); return Response.json(input.includes("/plans/") ? f.plan : input.includes("/operations?") ? history : input.includes("/operations/") ? f.operation : f.inventory); });
  await assert.rejects(reconcileProvisioning(planId, { token }), (error: ProvisioningClientError) => ["OUTCOME_UNCONFIRMED", "INVALID_RESPONSE"].includes(error.code) && !error.message.includes("private"));
});

test("reconciliation scope mismatch and late result cannot overwrite approved current state", () => {
  const f = fixture(), result: ReconciledSetup = { plan: f.plan as any, preflight: { status: "PASS", issues: [], creation: f.plan.creation as any }, apply: { operationId: f.operation.operationId, providerId: "minecraft", serverId: f.operation.serverId, state: "PROVISIONED", outcome: "applied", ownership: "MANAGED", residuals: [] } };
  let state = setupWizardReducer(readySetupState(), { type: "OPTIONS_LOADED", options: f.options, generation: 1 });
  state = setupWizardReducer(state, { type: "RECONCILE_STARTED", generation: 2 });
  const edited = structuredClone(result); edited.plan.plan.request.storage.directoryName = "changed";
  assert.equal(setupWizardReducer(state, { type: "RECONCILED", result: edited, generation: 2 }).error?.code, "SETUP_SCOPE_MISMATCH");
  const closed = setupWizardReducer(state, { type: "RESET", generation: 3 });
  assert.equal(setupWizardReducer(closed, { type: "RECONCILED", result, generation: 2 }), closed);
});

test("reconciliation HTTP/network rejection is safe and never retries", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: { code: "UNAUTHENTICATED", message: "private key" } }, { status: 401 }); });
  await assert.rejects(reconcileProvisioning(planId, { token }), (e: ProvisioningClientError) => e.status === 401 && !e.message.includes("private")); assert.equal(calls, 1);
  await assert.rejects(reconcileProvisioning("invalid", { token })); assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; throw new Error("private network diagnostic"); };
  await assert.rejects(reconcileProvisioning(planId, { token }), (e: ProvisioningClientError) => e.code === "NETWORK_ERROR" && !e.message.includes("private")); assert.equal(calls, 2);
});
