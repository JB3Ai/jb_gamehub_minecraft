import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { provisioningRouter, tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { managedFixture } from "./helpers/managed-create-fixture";
import { startServer } from "../server";
import path from "node:path";
import fs from "node:fs/promises";

const token = "explicit-admin-test-token-012345678901234567890";
test("approved CREATE API authenticates and uses safe projections, separate from adoption", async (t) => {
  const f = await managedFixture(t), { manager } = await f.open();
  const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => manager, () => ({ authorize: tokenAdminAuthorizer(token), policies: { minecraft: f.policy } })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/provisioning`;
  const call = (route: string, body?: unknown, credential = token) => fetch(root + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", authorization: "Bearer " + credential }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const safe = async (response: Response) => { const text = await response.text(); for (const privateValue of [f.base, f.source, f.java, token, "operator-reviewed-terms"]) assert.ok(!text.includes(privateValue), "private data in HTTP response"); return JSON.parse(text); };
  assert.equal((await call("/plans", f.request, "bad")).status, 401);
  for (const extra of [{ artifactPath: f.source }, { providerOptions: { profileRef: "approved", eula: true } }, { storage: { mode: "create", rootId: f.root } }]) {
    const response = await call("/plans", { ...f.request, ...extra }); assert.equal(response.status, 400); await safe(response);
  }
  const planned = await safe(await call("/plans", f.request));
  const checked = await safe(await call("/preflight", { planId: planned.plan.planId }));
  assert.equal(checked.creation.ownership, "MANAGED"); assert.ok(!checked.attachment);
  const input = { planId: planned.plan.planId, digest: checked.creation.digest, approved: true };
  assert.equal((await call("/applies", input, "bad")).status, 401);
  assert.equal((await call("/applies", { ...input, approved: false })).status, 400);
  assert.equal((await call("/applies", { ...input, actor: "forged" })).status, 400);
  assert.equal((await call("/applies", { ...input, digest: "wrong" })).status, 409);
  assert.equal((await call("/attachments", input)).status, 400);
  const applied = await call("/applies", input); assert.equal(applied.status, 200); const result = await safe(applied);
  assert.equal(result.state, "PROVISIONED"); assert.equal(result.ownership, "MANAGED");
  assert.deepEqual(await safe(await call("/applies", input)), result);
  const detail = await safe(await call(`/plans/${planned.plan.planId}`)); assert.equal(detail.creation.digest, checked.creation.digest);
  const adopt = await safe(await call("/plans", { ...f.request, serverId: "adopt-plan", storage: { mode: "adopt", locationRef: "existing" }, providerOptions: { javaRuntimeRef: "java" } }));
  assert.equal((await call("/applies", { ...input, planId: adopt.plan.planId })).status, 422);
  assert.ok(!(await manager.listOperations()).some((operation) => operation.type === "server.start"));
});

test("server bootstrap restores MANAGED routing and closes legacy URL auth bypass", async (t) => {
  const previousEnvironment = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  t.after(() => { if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment; });
  const f = await managedFixture(t); const options = { authorize: tokenAdminAuthorizer(token), policies: { minecraft: f.policy } };
  const config = { minecraftServerDir: path.join(f.base, "legacy"), persistenceDbPath: path.join(f.base, "http.sqlite"), aiProvider: "fallback" as const };
  let server = await startServer(0, config, options); if (!server.listening) await once(server, "listening");
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  try {
  let root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (route: string, body?: unknown, auth = true) => fetch(root + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: "Bearer " + token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const plan = await (await call("/api/provisioning/plans", f.request)).json();
  const preview = await (await call("/api/provisioning/preflight", { planId: plan.plan.planId })).json();
  const response = await call("/api/provisioning/applies", { planId: plan.plan.planId, digest: preview.creation.digest, approved: true });
  assert.equal(response.status, 200); assert.equal((await response.json()).state, "PROVISIONED");
  for (const action of ["start", "stop", "restart"]) assert.equal((await call(`/api/servers/${f.request.serverId}/${action}`, {}, false)).status, 401);
  assert.equal((await call(`/api/providers/minecraft/servers/${f.request.serverId}/status`, undefined, false)).status, 401);
  assert.equal((await (await call(`/api/providers/minecraft/servers/${f.request.serverId}/status`)).json()).status, "offline");
  // Simulate later world metadata without starting a runtime; legacy URLs must still hide the private root.
  await fs.mkdir(path.join(f.target, "managed-world")); await fs.writeFile(path.join(f.target, "managed-world", "level.dat"), "fixture world metadata");
  const worldResponse = await call(`/api/servers/${f.request.serverId}/worlds`), worldText = await worldResponse.text();
  assert.ok(!worldText.includes(f.base)); assert.ok(JSON.parse(worldText).worlds.some((world: { id: string }) => world.id === "managed-world"));
  await close(); server = await startServer(0, config, options); if (!server.listening) await once(server, "listening");
  root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const status = await call(`/api/providers/minecraft/servers/${f.request.serverId}/status`); assert.equal(status.status, 200); assert.equal((await status.json()).status, "offline");
  assert.equal((await call("/api/operations", undefined, false)).status, 401);
  } finally { await close(); }
});
