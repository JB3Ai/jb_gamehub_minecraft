import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { provisioningRouter, tokenAdminAuthorizer, type ProvisioningApiOptions } from "../packages/core/provisioning-api";
import { managedFixture } from "./helpers/managed-create-fixture";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";
import { createProvisioningPlan, getProvisioningSetupOptions, preflightProvisioning, ProvisioningClientError } from "../src/dashboard/apiClient";
import { initialSetupState, setupWizardReducer, setupRequestFromState } from "../src/setup/useSetupWizard";

const token = "023A-fixture-admin-not-a-real-credential-0123456789";
async function inventory(location: string): Promise<unknown> {
  const stat = await fs.lstat(location);
  if (stat.isFile()) return createHash("sha256").update(await fs.readFile(location)).digest("hex");
  const rows = [];
  for (const name of (await fs.readdir(location)).sort()) rows.push([name, await inventory(path.join(location, name))]);
  return rows;
}
for (const kind of ["java", "bedrock"] as const) test(`${kind} setup discovery and real HTTP client reach preflight/review with no apply or runtime effects`, async t => {
  const f = kind === "java" ? await managedFixture(t) : await managedBedrockFixture(t), { manager, repository } = await f.open();
  const providerId = f.request.providerId as "minecraft" | "minecraft-bedrock";
  const profileRef = kind + "-household-option", oldRef = String(f.request.providerOptions!.profileRef);
  const profile = f.policy.managedCreate!.profiles[oldRef];
  delete f.policy.managedCreate!.profiles[oldRef]; f.policy.managedCreate!.profiles[profileRef] = profile;
  f.policy.managedCreate!.acceptances[profile.acceptanceRef!].profileId = profileRef;
  const policy: ProvisioningApiOptions["policies"][string] = { ...f.policy, setup: { profiles: { [profileRef]: { rootId: "root", endpoints: f.request.endpoints, label: "Family setup" } } } };
  const beforePolicy = JSON.stringify(policy), beforeRoot = await inventory(f.root), beforeSource = await inventory(f.source);
  const authorize = tokenAdminAuthorizer(token), app = express(); app.use(express.json());
  app.use("/api/provisioning", provisioningRouter(() => manager, () => ({ policies: { [providerId]: policy }, authorize: req => req.get("authorization") === "Bearer viewer" ? { actor: "viewer", admin: false } : authorize(req) })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const nativeFetch = globalThis.fetch, paths: string[] = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => {
    const route = String(input); assert.match(route, /^\/api\/provisioning\/(setup-options|plans|preflight)$/);
    paths.push(route); return nativeFetch(url + route, init);
  });
  const denied = await nativeFetch(url + "/api/provisioning/setup-options"); assert.equal(denied.status, 401);
  assert.equal((await nativeFetch(url + "/api/provisioning/setup-options?token=" + token)).status, 401);
  assert.equal((await nativeFetch(url + "/api/provisioning/setup-options", { headers: { authorization: "Bearer viewer" } })).status, 403);
  await assert.rejects(getProvisioningSetupOptions({ token: "wrong" }), (error: ProvisioningClientError) => error.status === 401 && !error.message.includes("wrong"));
  const connection = { token }, options = await getProvisioningSetupOptions(connection), responseText = JSON.stringify(options);
  for (const secret of [f.base, token, "actor", "termsRef", "acceptedAt", "acceptances", "sha256", "bundleLocations", "protectedPaths", "filesystem"]) assert.ok(!responseText.includes(secret), secret);
  assert.equal(options.providers.length, 1); assert.equal(options.providers[0].providerId, providerId);
  assert.equal(options.providers[0].profiles[0].profileRef, profileRef); assert.equal(options.providers[0].profiles[0].available, true);
  const discovery = t.mock.method(manager, "previewManagedCreation", () => { throw new Error("discovery must not inspect files"); });
  await getProvisioningSetupOptions(connection); discovery.mock.restore();
  let state = setupWizardReducer(initialSetupState(), { type: "OPTIONS_LOADED", options, generation: 1 });
  state = setupWizardReducer(state, { type: "SELECT_PROVIDER", providerId, serverId: "family-fixture", generation: 2 });
  state = setupWizardReducer(state, { type: "UPDATE_CONFIGURATION", patch: { displayName: "Family Server", worldName: "Family World" }, generation: 3 });
  const request = setupRequestFromState(state), plan = await createProvisioningPlan(request, connection);
  state = setupWizardReducer(state, { type: "PLAN_STARTED", generation: 4 });
  state = setupWizardReducer(state, { type: "PLAN_CREATED", generation: 4, plan });
  const preflight = await preflightProvisioning(plan.plan.planId, connection);
  assert.equal(preflight.status, "PASS"); assert.equal(preflight.creation!.worldName, "Family World");
  state = setupWizardReducer(state, { type: "PREFLIGHT_PASSED", generation: 4, preflight }); assert.equal(state.step, "review");
  assert.deepEqual(await inventory(f.root), beforeRoot); assert.deepEqual(await inventory(f.source), beforeSource); assert.equal(JSON.stringify(policy), beforePolicy);
  assert.deepEqual(await manager.listOperations(), []); assert.deepEqual(repository.provisioning.claims(), []); assert.deepEqual(repository.provisioning.managedDefinitions(), []);
  assert.ok(paths.every(route => !/applies|attachments|start|recover/.test(route)));
  delete policy.setup;
  const unavailable = await getProvisioningSetupOptions(connection); assert.equal(unavailable.providers[0].profiles[0].available, false); assert.equal(unavailable.providers[0].profiles[0].requestDefaults, undefined);
  policy.setup = { profiles: { [profileRef]: { rootId: "missing-root", endpoints: f.request.endpoints } } };
  assert.equal((await getProvisioningSetupOptions(connection)).providers[0].profiles[0].available, false);
  policy.setup.profiles[profileRef].rootId = "root";
  policy.setup.profiles[profileRef].label = f.base;
  profile.configuration.worldName = f.base;
  const safeDefaults = await getProvisioningSetupOptions(connection);
  assert.equal(safeDefaults.providers[0].profiles[0].defaults.worldName, undefined);
  assert.ok(!JSON.stringify(safeDefaults).includes(f.base));
});

test("setup client rejects malformed success and never reflects raw server diagnostics", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ providers: [{ providerId: "minecraft", profiles: [] }] }), { status: 200 }));
  await assert.rejects(getProvisioningSetupOptions({ token }), (error: ProvisioningClientError) => error.code === "INVALID_RESPONSE");
  for (const malformed of [{ providers: [null] }, { providers: [{ providerId: "minecraft", label: "Java", profiles: [null] }] }]) {
    globalThis.fetch = async () => new Response(JSON.stringify(malformed), { status: 200 });
    await assert.rejects(getProvisioningSetupOptions({ token }), (error: ProvisioningClientError) => error.code === "INVALID_RESPONSE");
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "ARTIFACT_DRIFT", message: "private C:\\secret\\artifact" } }), { status: 409 });
  await assert.rejects(getProvisioningSetupOptions({ token }), (error: ProvisioningClientError) => error.status === 409 && !error.message.includes("secret"));
});

// Include colocated state/UI regressions in the repository's normal npm test glob.
import "../src/setup/useSetupWizard.test";
import "../src/components/NewServerModal.test";
