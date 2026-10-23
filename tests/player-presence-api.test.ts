import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { playerPresenceRouter } from "../packages/core/player-presence-api";
import type { ProviderOnlinePlayer } from "../packages/provider-manager";

async function host(t: import("node:test").TestContext) {
  const f = { status: "online", supported: true, fail: false, found: true, throwAuth: false, queries: 0,
    players: [{ providerId: "minecraft", serverId: "shared", displayName: "Alex", externalPlayerId: "private-account", identityType: "minecraft" }] as ProviderOnlinePlayer[] };
  const provider = { getCapabilities: () => ({ "player.list": f.supported }), getServerStatus: async () => ({ status: f.status }), getOnlinePlayers: async () => { f.queries++; if (f.fail) throw new Error("token=secret D:\\private"); return f.players; } };
  const reads: string[] = [];
  const manager = { getServer: async (id: string, providerId: string) => { reads.push(providerId + "/" + id); return f.found ? { providerId, id, name: "Family" } : undefined; }, getProvider: () => provider };
  const options = { authorize: async (req: express.Request) => { if (f.throwAuth) throw new Error("private"); return req.get("authorization") === "Bearer fixture-admin" ? { actor: "parent", admin: true } : req.get("authorization") === "Bearer fixture-child" ? { actor: "child", admin: false } : undefined; } };
  const app = express(); app.use("/api", playerPresenceRouter(() => manager as any, () => options));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/providers/`, path = "minecraft/servers/shared/players";
  const get = (authorization = "Bearer fixture-admin", suffix = path) => fetch(base + suffix, { headers: { authorization } });
  return { f, provider, manager, reads, get, url: base + path };
}
test("025B player names require administrator authorization, including when no policy is configured", async t => {
  const h = await host(t);
  for (const [credential, status] of [["", 401], ["Bearer wrong", 401], ["Bearer fixture-child", 403]] as const) {
    const response = await h.get(credential); assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store"); assert.doesNotMatch(await response.text(), /Alex|private-account/);
  }
  assert.equal(h.f.queries, 0); assert.deepEqual(h.reads, []); h.f.throwAuth = true; assert.equal((await h.get()).status, 503);
});
test("025B read-only presence exposes names without account IDs, Family links or diagnostics", async t => {
  const h = await host(t), response = await h.get(); assert.equal(response.status, 200); const value = await response.json();
  assert.deepEqual(value.players, [{ displayName: "Alex" }]); assert.equal(value.namesComplete, true); assert.equal(value.state, "available"); assert.equal(value.providerId, "minecraft");
  assert.doesNotMatch(JSON.stringify(value), /private-account|identityType|childId|actor|runtimeRoot/); assert.deepEqual(h.reads, ["minecraft/shared"]);
  // The supplied manager has no audit, status-persistence, provisioning or lifecycle methods.
  assert.equal((await fetch(h.url, { method: "POST", headers: { authorization: "Bearer fixture-admin" } })).status, 404);
});
test("025B presence stays provider scoped even for a shared server ID", async t => {
  const h = await host(t); h.f.players = [{ ...h.f.players[0], providerId: "minecraft-bedrock", displayName: "Bedrock Alex" }];
  const response = await h.get("Bearer fixture-admin", "minecraft-bedrock/servers/shared/players"); const value = await response.json();
  assert.equal(value.providerId, "minecraft-bedrock"); assert.deepEqual(value.players, [{ displayName: "Bedrock Alex" }]); assert.deepEqual(h.reads, ["minecraft-bedrock/shared"]);
});
test("025B offline/unsupported/missing server results do not invent an empty live roster", async t => {
  const h = await host(t); h.f.status = "offline"; assert.equal((await (await h.get()).json()).state, "not-running"); assert.equal(h.f.queries, 0);
  h.f.status = "online"; h.f.supported = false; assert.equal((await (await h.get()).json()).state, "unsupported"); assert.equal(h.f.queries, 0);
  h.f.found = false; assert.equal((await h.get()).status, 404);
});
test("025B unsafe, cross-server and raw numeric/UUID identities are hidden and partial names are explicit", async t => {
  const h = await host(t); const template = h.f.players[0];
  h.f.players.push(...["1234567890123456", "12345678-1234-5678-1234-567812345678", "<script>", "D:\\private", "bad\nname", "token=secret"].map(displayName => ({ ...template, displayName })), { ...template, serverId: "other", displayName: "Not here" });
  const value = await (await h.get()).json(); assert.deepEqual(value.players, [{ displayName: "Alex" }]); assert.equal(value.namesComplete, false);
  assert.doesNotMatch(JSON.stringify(value), /12345678|script|private|Not here|secret/);
});
test("025B player query failure is sanitized and a stop during query discards the roster", async t => {
  const h = await host(t); h.f.fail = true; let response = await h.get(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|private/);
  h.f.fail = false; h.provider.getOnlinePlayers = async () => { h.f.status = "offline"; return h.f.players; };
  response = await h.get(); const value = await response.json(); assert.equal(value.state, "not-running"); assert.deepEqual(value.players, []);
});
test("025B response size is bounded and empty supported roster is distinguishable from unsupported", async t => {
  const h = await host(t); h.f.players = []; let value = await (await h.get()).json(); assert.equal(value.state, "available"); assert.equal(value.namesComplete, true); assert.deepEqual(value.players, []);
  h.f.players = Array.from({ length: 300 }, (_, i) => ({ providerId: "minecraft", serverId: "shared", displayName: "Player " + i, externalPlayerId: String(i), identityType: "minecraft" }));
  value = await (await h.get()).json(); assert.equal(value.players.length, 256); assert.equal(value.namesComplete, false);
});
test("025B an unresponsive provider produces a bounded unavailable response", async t => {
  const h = await host(t); h.provider.getOnlinePlayers = () => new Promise(() => {});
  const started = Date.now(), response = await h.get(); assert.equal(response.status, 503);
  assert.ok(Date.now() - started < 5000); assert.equal((await response.json()).error.code, "PLAYER_PRESENCE_UNAVAILABLE");
});
