import test from "node:test";
import assert from "node:assert/strict";
import { hostConfigurationView, readinessReport } from "./helpers/wizard-readiness";
import { hostSettingsFromView, getHostConfiguration, saveHostConfiguration, parseHostConfiguration, HostConfigurationClientError } from "../src/setup/hostConfiguration";
import { initialSetupState, setupWizardReducer } from "../src/setup/useSetupWizard";

function configuring() {
  let state = setupWizardReducer(initialSetupState(), { type: "READINESS_STARTED", generation: 0 });
  state = setupWizardReducer(state, { type: "READINESS_LOADED", generation: 0, report: readinessReport() });
  state = setupWizardReducer(state, { type: "HOST_LOAD_STARTED", generation: 1 });
  return setupWizardReducer(state, { type: "HOST_LOADED", generation: 1, view: hostConfigurationView() });
}
test("host review/save is separate from CREATE, preserves edits on Back and requires a matching saved revision", () => {
  const state = configuring(); assert.equal(state.step, "configure-host"); assert.equal(state.approved, false);
  const reviewed = setupWizardReducer(state, { type: "HOST_REVIEW", generation: 1 }); assert.equal(reviewed.step, "review-host");
  assert.deepEqual(setupWizardReducer(reviewed, { type: "HOST_BACK", generation: 1 }).hostDraft, state.hostDraft);
  const saving = setupWizardReducer(reviewed, { type: "HOST_SAVE_STARTED", generation: 2 });
  for (const type of ["HOST_SAVE_STARTED", "HOST_BACK", "RESET", "CREDENTIAL_CHANGED", "APPLY_STARTED"] as const) assert.equal(setupWizardReducer(saving, { type, generation: 3 }), saving);
  const saved = setupWizardReducer(saving, { type: "HOST_SAVED", generation: 2, view: hostConfigurationView(1) });
  assert.equal(saved.hostSaved, true); assert.equal(saved.approved, false); assert.equal(saved.plan, undefined);
  const wrong = hostConfigurationView(1); wrong.record!.javaPort++;
  const rejected = setupWizardReducer(saving, { type: "HOST_SAVED", generation: 2, view: wrong }); assert.equal(rejected.hostSaved, false); assert.equal(rejected.hostReloadRequired, true);
});
test("host stale/network errors require Reload, retain form input, and ignore old results after edits/reset", () => {
  const state = configuring(), changed = setupWizardReducer(state, { type: "HOST_EDIT", generation: 2, patch: { javaPort: 27061 } });
  assert.equal(changed.hostSaved, false);
  assert.equal(setupWizardReducer(changed, { type: "HOST_LOADED", generation: 1, view: hostConfigurationView(1) }), changed);
  const failed = setupWizardReducer(changed, { type: "HOST_ERROR", generation: 3, reloadRequired: true, error: { code: "CONFIGURATION_STALE", message: "Reload." } });
  assert.equal(failed.hostDraft?.javaPort, 27061); assert.equal(setupWizardReducer(failed, { type: "HOST_REVIEW", generation: 3 }), failed);
  const loading = setupWizardReducer(failed, { type: "HOST_LOAD_STARTED", generation: 4 });
  const loaded = setupWizardReducer(loading, { type: "HOST_LOADED", generation: 4, view: hostConfigurationView(1) });
  assert.equal(loaded.hostDraft?.javaPort, 27061); assert.equal(loaded.hostView?.revision, 1); assert.equal(loaded.hostReloadRequired, false);
  const reset = setupWizardReducer(loaded, { type: "RESET", generation: 5 });
  assert.equal(setupWizardReducer(reset, { type: "HOST_LOADED", generation: 4, view: hostConfigurationView(1) }), reset);
});
test("client sends only reviewed IDs, approval and revision; GET and POST schema failures never leak raw diagnostics", async t => {
  const view = hostConfigurationView(), draft = hostSettingsFromView(view); let writes = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-key");
    if (init.method === "GET") return Response.json(view);
    writes++; const body = JSON.parse(String(init.body)); assert.equal(body.expectedRevision, 0); assert.equal(body.catalogDigest, view.catalogDigest); assert.equal(body.approved, true); assert.deepEqual(body.storage, { rootId: "root" }); assert.ok(!JSON.stringify(body).includes("path"));
    return Response.json(hostConfigurationView(1));
  });
  assert.equal((await getHostConfiguration({ token: "fixture-key" })).revision, 0);
  assert.equal((await saveHostConfiguration(draft, view, { token: "fixture-key" })).revision, 1); assert.equal(writes, 1);
  globalThis.fetch = async () => Response.json({ error: { code: "CONFIGURATION_STALE", message: "private token and D:/secret" } }, { status: 409 });
  await assert.rejects(saveHostConfiguration(draft, view, { token: "fixture-key" }), error => error instanceof HostConfigurationClientError && error.code === "CONFIGURATION_STALE" && !error.message.includes("private"));
  globalThis.fetch = async () => { throw new Error("token and path"); };
  await assert.rejects(saveHostConfiguration(draft, view, { token: "fixture-key" }), error => error instanceof HostConfigurationClientError && error.code === "SAVE_UNCONFIRMED");
  assert.throws(() => parseHostConfiguration({ ...view, revision: 1 }), /Host configuration/);
});
