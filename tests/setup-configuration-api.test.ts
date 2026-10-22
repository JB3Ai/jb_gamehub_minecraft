import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { configurationHost as host, token } from "./helpers/configuration-api";

test("GET/POST configuration require administrator authorization and never expose trusted paths", async t => {
  const h = await host(t);
  for (const method of ["GET", "POST"]) assert.equal((await fetch(h.url, { method })).status, 401);
  h.options.authorize = () => ({ actor: "viewer", admin: false }); assert.equal((await h.post(h.request())).status, 403);
  h.options.authorize = tokenAdminAuthorizer(token);
  const response = await fetch(h.url, { headers: h.headers }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text(); for (const secret of [h.f.base, h.f.root, token, "acceptances", "artifactLocations"]) assert.ok(!body.includes(secret));
  assert.equal(h.repository.setupConfiguration.read(), undefined);
});
for (const kind of ["java", "bedrock"] as const) test(`${kind} settings save preserves managed definition, ownership, claims, operation, source and runtime tree`, async t => {
  const h = await host(t, kind), f = h.f;
  const plan = await h.manager.planProvisioning(f.request); h.manager.saveProvisioningPlan(plan);
  const preview = await h.manager.previewManagedCreation(plan, f.policy), operation = await h.manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy);
  assert.equal(operation.result.state, "PROVISIONED");
  const before = JSON.stringify({ operations: await h.repository.listOperations(), definitions: h.manager.listManagedRuntimes(), claims: h.manager.listProvisioningClaims(), operation: h.manager.getProvisioningOperation(operation.operationId), policy: f.policy });
  const files: Array<[string, Buffer]> = [];
  async function capture(directory: string) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const location = path.join(directory, entry.name); if (entry.isDirectory()) await capture(location); else files.push([location, await fs.readFile(location)]); } }
  await capture(f.target);
  const source = kind === "java" ? f.source : path.join(f.source, "bedrock_server.exe"), bytes = await fs.readFile(source);
  const response = await h.post(h.request()); assert.equal(response.status, 200); const saved = await response.json(); assert.equal(saved.revision, 1); assert.equal(saved.onboardingComplete, false); assert.equal(saved.record.updatedBy, undefined);
  assert.equal(JSON.stringify({ operations: await h.repository.listOperations(), definitions: h.manager.listManagedRuntimes(), claims: h.manager.listProvisioningClaims(), operation: h.manager.getProvisioningOperation(operation.operationId), policy: f.policy }), before);
  assert.deepEqual(await fs.readFile(source), bytes); for (const [location, contents] of files) assert.deepEqual(await fs.readFile(location), contents);
  assert.equal((await h.manager.getServerStatus(f.request.serverId, f.request.providerId)).status, "offline");
});
test("identical save at current revision is idempotent; stale and invalid writes preserve the saved revision", async t => {
  const h = await host(t), first = h.request(); assert.equal((await h.post(first)).status, 200);
  const repeated = await (await h.post(h.request())).json(); assert.equal(repeated.unchanged, true); assert.equal(repeated.revision, 1);
  assert.equal((await h.post(first)).status, 409);
  for (const patch of [{ ports: { java: 0, bedrock: 19132 } }, { storage: { rootId: "../outside" } }, { java: { runtimeId: "missing" } }, { approved: false }, { catalogDigest: "c".repeat(64) }, { path: "C:/unreviewed" }]) assert.ok((await h.post({ ...h.request(), ...patch })).status >= 400);
  const before = h.repository.setupConfiguration.read(); h.probes.fileHash = async () => "d".repeat(64);
  assert.equal((await h.post(h.request())).status, 422); assert.deepEqual(h.repository.setupConfiguration.read(), before);
});
test("two requests loaded at the same revision cannot silently overwrite one another", async t => {
  const h = await host(t), request = h.request();
  const responses = await Promise.all([h.post(request), h.post({ ...request, ports: { java: 25566, bedrock: 19132 } })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(h.repository.setupConfiguration.read()?.revision, 1);
});
