import test from "node:test";
import assert from "node:assert/strict";
import { initialSetupState, setupWizardReducer, setupRequestFromState } from "./useSetupWizard";
import type { SetupWizardState } from "./types";
import type { SetupOptionsResponse, ProvisioningPlanResponse, ProvisioningPreflightResponse } from "../dashboard/provisioningTypes";

const options: SetupOptionsResponse = { providers: ["minecraft", "minecraft-bedrock"].map((providerId: "minecraft" | "minecraft-bedrock") => ({ providerId, label: providerId === "minecraft" ? "Minecraft Java" : "Minecraft Bedrock", profiles: [{ profileRef: providerId + "-fixture-choice", revision: "9", label: "Family default", defaults: { worldName: "Default World" }, available: true,
  requestDefaults: { hostId: "fixture-host", rootId: "fixture-root", endpoints: [{ id: "fixture-game", protocol: "fixture-protocol", transport: "udp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 29801 } }] } }] })) };
function configured(): SetupWizardState {
  let state = setupWizardReducer(initialSetupState(), { type: "OPTIONS_LOADED", options, generation: 1 });
  state = setupWizardReducer(state, { type: "SELECT_PROVIDER", providerId: "minecraft", serverId: "family-stable", generation: 2 });
  return setupWizardReducer(state, { type: "UPDATE_CONFIGURATION", patch: { displayName: "Family Server", worldName: "Family World" }, generation: 3 });
}
function checking() {
  let state = configured(); const request = setupRequestFromState(state);
  const plan: ProvisioningPlanResponse = { digest: "outer-plan-digest", plan: { schemaVersion: 1, planId: "plan-fixture", providerId: request.providerId, serverId: request.serverId, displayName: request.displayName, mode: "create", status: "planned", request, validation: { valid: true, errors: [] } } };
  state = setupWizardReducer(state, { type: "PLAN_STARTED", generation: 4 });
  state = setupWizardReducer(state, { type: "PLAN_CREATED", generation: 4, plan });
  const preflight: ProvisioningPreflightResponse = { status: "PASS", issues: [], creation: { digest: "a".repeat(64), ownership: "MANAGED", profileId: request.providerOptions.profileRef, serverId: request.serverId, directoryName: "family-stable", files: [], endpoints: request.endpoints, worldName: request.providerOptions.worldName, startup: "remain-stopped", deferredValidations: ["first-boot"] } };
  return { state, plan, preflight };
}
function review() { const f = checking(); return setupWizardReducer(f.state, { type: "PREFLIGHT_PASSED", generation: 4, preflight: f.preflight }); }
function applying() { return setupWizardReducer(setupWizardReducer(review(), { type: "APPROVAL_CHANGED", approved: true, generation: 4 }), { type: "APPLY_STARTED", generation: 5 }); }
const applied = { operationId: "op-created", providerId: "minecraft" as const, serverId: "family-stable", ownership: "MANAGED" as const, state: "PROVISIONED", outcome: "applied", residuals: [] };
test("apply requires review and explicit approval, locks navigation, and completes only a matching clean result", () => {
  const state = review(); assert.equal(setupWizardReducer(state, { type: "APPLY_STARTED", generation: 5 }), state);
  const running = applying(); assert.equal(running.step, "provisioning");
  for (const type of ["BACK", "RESET", "PLAN_STARTED", "CREDENTIAL_CHANGED", "APPLY_STARTED"] as const) assert.equal(setupWizardReducer(running, { type, generation: 6 }), running);
  const complete = setupWizardReducer(running, { type: "APPLY_SUCCEEDED", generation: 5, result: applied });
  assert.equal(complete.step, "complete"); assert.equal(complete.apply, applied); assert.equal(complete.preflight, running.preflight);
  assert.equal(setupWizardReducer(complete, { type: "APPLY_STARTED", generation: 6 }), complete);
  assert.deepEqual(setupWizardReducer(complete, { type: "COMPLETE", generation: 6 }), initialSetupState(6));
});
test("policy removed before apply requires recheck and keeps the reviewed evidence", () => {
  const state = applying(), failed = setupWizardReducer(state, { type: "APPLY_FAILED", code: "POLICY_UNAVAILABLE", status: 422, generation: 5 });
  assert.equal(failed.applyFailure, "recheck"); assert.equal(failed.plan, state.plan); assert.equal(failed.preflight, state.preflight); assert.equal(failed.approved, false);
});
for (const kind of ["rolled-back", "partial", "stale", "network", "http", "wrong-provider", "wrong-server", "unknown-state", "success-with-residuals"] as const) test("apply failure preserves evidence and safe recovery: " + kind, () => {
  const state = applying(); let result = { ...applied };
  if (kind === "rolled-back") result = { ...result, state: "ROLLED_BACK", outcome: "failed" };
  if (kind === "partial") result = { ...result, state: "PARTIALLY_ROLLED_BACK", outcome: "failed" };
  if (kind === "wrong-provider") result.providerId = "minecraft-bedrock" as any;
  if (kind === "wrong-server") result.serverId = "other";
  if (kind === "unknown-state") result.state = "FUTURE_STATE";
  if (kind === "success-with-residuals") result.residuals = [{ code: "RETAINED" }] as any;
  const failed = setupWizardReducer(state, ["stale", "network", "http"].includes(kind) ? { type: "APPLY_FAILED", generation: 5, code: kind === "stale" ? "APPROVAL_MISMATCH" : "NETWORK_ERROR", status: kind === "stale" ? 409 : kind === "http" ? 503 : 0 } : { type: "APPLY_SUCCEEDED", generation: 5, result });
  assert.equal(failed.step, "error"); assert.equal(failed.approved, false); assert.equal(failed.plan, state.plan); assert.equal(failed.preflight, state.preflight); assert.equal(failed.configuration, state.configuration);
  assert.equal(failed.applyFailure, kind === "rolled-back" ? "rolled-back" : kind === "partial" ? "partial" : kind === "stale" ? "recheck" : "unknown");
  assert.equal(setupWizardReducer(failed, { type: "APPLY_STARTED", generation: 6 }), failed);
  if (failed.applyFailure === "unknown" || failed.applyFailure === "partial") assert.equal(setupWizardReducer(failed, { type: "BACK", generation: 6 }), failed);
});
test("setup uses discovered references and stable identity; edits invalidate review without losing input", () => {
  const f = checking(), reviewed = setupWizardReducer(f.state, { type: "PREFLIGHT_PASSED", generation: 4, preflight: f.preflight });
  assert.equal(reviewed.step, "review"); assert.notEqual(reviewed.plan!.digest, reviewed.preflight!.creation!.digest);
  const back = setupWizardReducer(reviewed, { type: "BACK", generation: 5 });
  assert.equal(back.step, "configure"); assert.deepEqual(back.configuration, reviewed.configuration); assert.equal(back.plan, undefined); assert.equal(back.preflight, undefined);
  const choose = setupWizardReducer(back, { type: "BACK", generation: 6 });
  const again = setupWizardReducer(choose, { type: "SELECT_PROVIDER", providerId: "minecraft", serverId: "family-stable", generation: 7 });
  assert.deepEqual(again.configuration, back.configuration);
  const request = setupRequestFromState(again); assert.equal(request.hostId, "fixture-host"); assert.equal(request.storage.rootId, "fixture-root"); assert.equal(request.providerOptions.profileRef, "minecraft-fixture-choice"); assert.equal(request.serverId, "family-stable"); assert.equal(request.storage.mode, "create");
  assert.deepEqual(options.providers[0].profiles[0].requestDefaults!.endpoints, request.endpoints);
});
test("late async results cannot restore stale plan/review after edit, provider switch or close", () => {
  const f = checking();
  const edited = setupWizardReducer(f.state, { type: "UPDATE_CONFIGURATION", patch: { worldName: "Changed World" }, generation: 5 });
  assert.deepEqual(setupWizardReducer(edited, { type: "PREFLIGHT_PASSED", generation: 4, preflight: f.preflight }), edited);
  const switched = setupWizardReducer(edited, { type: "SELECT_PROVIDER", providerId: "minecraft-bedrock", serverId: "family-stable", generation: 6 });
  assert.equal(switched.configuration.providerId, "minecraft-bedrock");
  assert.deepEqual(setupWizardReducer(switched, { type: "PLAN_CREATED", generation: 4, plan: f.plan }), switched);
  const closed = setupWizardReducer(switched, { type: "RESET", generation: 7 });
  assert.deepEqual(closed, initialSetupState(7)); assert.deepEqual(setupWizardReducer(closed, { type: "OPTIONS_LOADED", generation: 1, options }), closed);
});
for (const defect of ["wrong-world", "wrong-server", "wrong-profile", "bad-digest", "wrong-startup", "wrong-endpoints", "blocking-issue"] as const) test("review fails closed for " + defect, () => {
  const f = checking(), response = structuredClone(f.preflight);
  if (defect === "wrong-world") response.creation!.worldName = "Other";
  if (defect === "wrong-server") response.creation!.serverId = "other";
  if (defect === "wrong-profile") response.creation!.profileId = "other";
  if (defect === "bad-digest") response.creation!.digest = "";
  if (defect === "wrong-startup") (response.creation as any).startup = "start-now";
  if (defect === "wrong-endpoints") response.creation!.endpoints[0].port.value++;
  if (defect === "blocking-issue") response.issues = [{ code: "BLOCKED", severity: "blocking" }];
  const state = setupWizardReducer(f.state, { type: "PREFLIGHT_PASSED", generation: 4, preflight: response }); assert.equal(state.step, "error"); assert.equal(state.preflight, undefined); assert.deepEqual(state.configuration, f.state.configuration);
});
test("failed preflight and authentication retry preserve configuration and cannot approve or apply", () => {
  const f = checking();
  const failed = setupWizardReducer(f.state, { type: "PREFLIGHT_FAILED", generation: 4, preflight: { status: "FAIL", issues: [{ code: "ENDPOINT_OCCUPIED", severity: "blocking" }] } });
  assert.equal(failed.step, "configure"); assert.deepEqual(failed.configuration, f.state.configuration);
  const error = setupWizardReducer(failed, { type: "ERROR", generation: 5, error: { code: "UNAUTHENTICATED", message: "Reconnect" } });
  const credential = setupWizardReducer(error, { type: "CREDENTIAL_CHANGED", generation: 6 });
  assert.deepEqual(credential.configuration, failed.configuration); assert.equal(credential.options, undefined); assert.equal(credential.plan, undefined); assert.equal(credential.preflight, undefined);
  assert.deepEqual(setupWizardReducer(error, { type: "APPLY", generation: 6 } as any), { ...error, generation: 5 });
});
test("unavailable profiles cannot be selected and empty fields never form a request", () => {
  const unavailable = structuredClone(options); unavailable.providers[0].profiles[0].available = false;
  const state = setupWizardReducer(initialSetupState(), { type: "OPTIONS_LOADED", generation: 1, options: unavailable });
  assert.deepEqual(setupWizardReducer(state, { type: "SELECT_PROVIDER", providerId: "minecraft", serverId: "none", generation: 2 }), state);
  assert.throws(() => setupRequestFromState(state));
});
