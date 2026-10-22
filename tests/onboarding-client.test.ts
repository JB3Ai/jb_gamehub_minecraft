import test from "node:test";
import assert from "node:assert/strict";
import { getOnboarding, completeOnboarding, parseOnboarding, OnboardingClientError } from "../src/setup/onboarding";
import { initialSetupState, setupWizardReducer } from "../src/setup/useSetupWizard";
import { readySetupState } from "./helpers/wizard-readiness";
const ready = { schemaVersion: 1 as const, status: "READY" as const, configurationRevision: 1, currentConfigurationRevision: 1, configurationChanged: false, completedAt: "2026-10-22T12:00:00Z" };
test("durable READY skips host steps and late completion cannot restore stale state", () => {
  const state = setupWizardReducer(initialSetupState(), { type: "ONBOARDING_READY", generation: 1, onboarding: ready });
  assert.equal(state.step, "setup-complete"); assert.equal(state.approved, false); assert.equal(state.plan, undefined);
  const reset = setupWizardReducer(state, { type: "RESET", generation: 2 });
  assert.equal(setupWizardReducer(reset, { type: "ONBOARDING_READY", generation: 1, onboarding: ready }), reset);
  const completing = setupWizardReducer({ ...readySetupState(), step: "configure-host", hostSaved: true }, { type: "ONBOARDING_COMPLETE_STARTED", generation: 1 });
  assert.equal(completing.step, "completing-onboarding");
  for (const type of ["RESET", "CREDENTIAL_CHANGED", "HOST_SAVE_STARTED", "APPLY_STARTED"] as const) assert.equal(setupWizardReducer(completing, { type, generation: 2 }), completing);
});
test("onboarding client validates state, keeps credentials out of errors and never retries completion", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls++; assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture"); if (init.method === "POST") assert.deepEqual(JSON.parse(String(init.body)), { configurationRevision: 1 }); return Response.json(ready); });
  assert.equal((await getOnboarding({ token: "fixture" })).status, "READY"); assert.equal((await completeOnboarding(1, { token: "fixture" })).status, "READY"); assert.equal(calls, 2);
  globalThis.fetch = async () => { calls++; throw new Error("secret and C:/path"); };
  await assert.rejects(completeOnboarding(1, { token: "fixture" }), error => error instanceof OnboardingClientError && !/secret|path/.test(error.message)); assert.equal(calls, 3);
  globalThis.fetch = async () => Response.json({ error: { code: "CONFIGURATION_STALE", message: "secret" } }, { status: 409 });
  await assert.rejects(completeOnboarding(1, { token: "fixture" }), error => error instanceof OnboardingClientError && error.code === "CONFIGURATION_STALE");
  assert.throws(() => parseOnboarding({ ...ready, completedAt: "invalid" })); assert.throws(() => parseOnboarding({ ...ready, configurationChanged: true }));
});
