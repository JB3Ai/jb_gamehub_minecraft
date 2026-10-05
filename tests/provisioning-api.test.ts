import WebSocket from "ws";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import express from "express";
import { provisioningRouter, tokenAdminAuthorizer, type ProvisioningApiOptions } from "../packages/core/provisioning-api";
import { SqlitePersistenceRepository } from "../packages/core/sqlite-repository";
import { InMemoryProviderManager } from "../packages/provider-manager";
import { MinecraftProvider } from "../packages/minecraft-provider";
import { BedrockProvider } from "../packages/bedrock-provider";
import { SyntheticProvider } from "../packages/synthetic-provider";
import { attachedFixture } from "./helpers/attached-runtime-fixture";

const token = "test-admin-token-012345678901234567890123";
for (const kind of ["java", "bedrock"] as const) test(`${kind} authenticated API creates plans, preflights, attaches and retrieves after restart`, async (t) => {
  const f = await attachedFixture(t, kind); const filePath = path.join(f.base, "api.sqlite");
  let repository = new SqlitePersistenceRepository({ filePath }); let manager = new InMemoryProviderManager({ repository });
  const initialize = async () => { await manager.initialize(); await manager.register(kind === "java" ? new MinecraftProvider({ serverDir: f.root }) : new BedrockProvider()); await manager.register(new SyntheticProvider()); };
  await initialize();
  const auth = tokenAdminAuthorizer(token);
  const options: ProvisioningApiOptions = { policies: { [f.providerId]: f.policy }, authorize: (req) => req.get("authorization") === "Bearer viewer" ? { actor: "viewer", admin: false } : auth(req) };
  const app = express(); app.use(express.json()); app.use("/api/provisioning", provisioningRouter(() => manager, () => options));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/provisioning`;
  const call = (route: string, body?: unknown, credential = token) => fetch(url + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call("/plans", f.request, "")).status, 401);
    assert.equal((await call("/plans", f.request, "wrong")).status, 401);
    assert.equal((await call("/plans", f.request, "viewer")).status, 403);
    const created = await call("/plans", f.request); assert.equal(created.status, 201); const planned = await created.json();
    assert.equal((await call(`/plans/${planned.plan.planId}`)).status, 200);
    const preflight = await call("/preflight", { planId: planned.plan.planId }); assert.equal(preflight.status, 200); const checked = await preflight.json();
    assert.ok(!JSON.stringify(checked).includes(f.base));
    const input = { planId: planned.plan.planId, approved: true, digest: checked.attachment.digest };
    assert.equal((await call("/attachments", { ...input, actor: "forged" })).status, 400);
    assert.equal((await call("/attachments", { ...input, digest: "bad" })).status, 400);
    const attached = await call("/attachments", input); assert.equal(attached.status, 200); const record = await attached.json();
    assert.equal(record.ownership, "ADOPTED"); assert.ok(!JSON.stringify(record).includes(f.base));
    assert.deepEqual(await (await call("/attachments", input)).json(), record);
    const conflictPlan = await (await call("/plans", { ...f.request, serverId: "competing-server" })).json();
    const conflictCheck = await (await call("/preflight", { planId: conflictPlan.plan.planId })).json();
    assert.equal((await call("/attachments", { planId: conflictPlan.plan.planId, approved: true, digest: conflictCheck.attachment.digest })).status, 409);
    assert.equal((await call("/attachments", { planId: "missing", approved: true, digest: "bad" })).status, 404);
    assert.equal((await call("/plans", { ...f.request, providerId: "missing" })).status, 422);
    const unsupported = await (await call("/plans", { ...f.request, providerId: "synthetic", providerOptions: {} })).json();
    assert.equal((await call("/preflight", { planId: unsupported.plan.planId })).status, 422);
    const denied = await manager.listAudits(); assert.ok(denied.some((item) => item.actor === "viewer" && item.result === "failed"));
    assert.ok(!JSON.stringify(denied).includes(token));
    await manager.shutdown(); repository = new SqlitePersistenceRepository({ filePath }); manager = new InMemoryProviderManager({ repository }); await initialize();
    assert.equal((await call(`/plans/${planned.plan.planId}`)).status, 200);
    assert.deepEqual(await (await call(`/attachments/${record.id}`)).json(), record);
    assert.equal((await call(`/attachments/${record.id}/reconcile`, {})).status, 200);
    const listed = await (await call("/attachments")).json(); assert.equal(listed.attachments.length, 1);
    assert.equal(await fs.readFile(path.join(f.root, "server.properties"), "utf8"), `level-name=one-world\nserver-port=${kind === "java" ? 25571 : 19201}\n${kind === "bedrock" ? "server-portv6=19202\n" : ""}`);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await manager.shutdown(); }
});

test("server.ts protects legacy attached lifecycle URLs and restores attachment routing", async (t) => {
  const { startServer } = await import("../server");
  const f = await attachedFixture(t, "bedrock", "http", 23401); const previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const options: ProvisioningApiOptions = { authorize: tokenAdminAuthorizer(token), policies: { [f.providerId]: f.policy } };
  const config = { minecraftServerDir: f.root, persistenceDbPath: path.join(f.base, "http.sqlite"), aiProvider: "fallback" as const };
  let server = await startServer(0, config, options); if (!server.listening) await once(server, "listening");
  const close = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  let rootUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (route: string, body?: unknown, credential = token) => fetch(rootUrl + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  try {
    const planned = await (await call("/api/provisioning/plans", f.request)).json();
    const checked = await (await call("/api/provisioning/preflight", { planId: planned.plan.planId })).json();
    assert.equal((await call("/api/provisioning/attachments", { planId: planned.plan.planId, approved: true, digest: checked.attachment.digest })).status, 200);
    for (const action of ["start", "stop", "restart"]) assert.equal((await call(`/api/servers/${f.request.serverId}/${action}`, {}, "")).status, 401);
    assert.equal((await call(`/api/providers/${f.providerId}/servers/${f.request.serverId}/start`, {}, "")).status, 401);
    assert.equal((await call("/api/operations", undefined, "")).status, 401);
    assert.equal((await call("/api/history/audit", undefined, "")).status, 401);
    await new Promise<void>((resolve, reject) => {
      const deniedSocket = new WebSocket(rootUrl.replace("http:", "ws:") + "/ws");
      deniedSocket.on("error", () => {});
      deniedSocket.once("unexpected-response", (request, response) => {
        try { assert.equal(response.statusCode, 401); response.resume(); request.destroy(); resolve(); } catch (error) { reject(error); }
      });
      deniedSocket.once("open", () => { deniedSocket.close(); reject(new Error("Unauthenticated socket accepted")); });
    });
    const allowedSocket = new WebSocket(rootUrl.replace("http:", "ws:") + "/ws", { headers: { authorization: `Bearer ${token}` } });
    const [message] = await once(allowedSocket, "message"); assert.equal(JSON.parse(String(message)).type, "connection.ready");
    allowedSocket.close(); await once(allowedSocket, "close");
    const listed = await (await call("/api/servers")).json(); assert.ok(listed.servers.some((server: { id: string; ownership?: string }) => server.id === f.request.serverId && server.ownership === "ADOPTED"));
    await close(); server = await startServer(0, config, options); if (!server.listening) await once(server, "listening"); rootUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const status = await call(`/api/providers/${f.providerId}/servers/${f.request.serverId}/status`); assert.equal(status.status, 200); assert.equal((await status.json()).status, "offline");
    const worlds = await (await call(`/api/providers/${f.providerId}/servers/${f.request.serverId}/worlds`)).json(); assert.ok(worlds.worlds.some((world: { id: string }) => world.id === "http-world")); assert.ok(!JSON.stringify(worlds).includes(f.root));
  } finally { await close(); if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
