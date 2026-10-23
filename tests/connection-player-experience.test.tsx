import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { connectionAddresses, playerCountText, writeConnectionClipboard } from "../src/dashboard/connectionExperience";
import { ServerConnection } from "../src/components/ServerConnection";
import { ServerPlayers } from "../src/components/ServerPlayers";
import { getPlayerPresence, PlayerPresenceError } from "../src/dashboard/apiClient";
import { applyProviderEvent, createInitialDashboardState } from "../src/dashboard/state";
import type { DashboardState, ServerInventoryItem } from "../src/dashboard/types";
const server: ServerInventoryItem = { id: "shared", providerId: "minecraft", name: "Family", serverType: "Paper", status: "online", availability: true, lastStatusUpdate: "2026-10-23T10:00:00Z", endpoints: { java: "192.168.1.2:25565" } };
const endpoint = (host: string, bedrock = false) => ({ ...server, providerId: bedrock ? "minecraft-bedrock" : "minecraft", connectionEndpoints: [{ id: "play", protocol: bedrock ? "native-bds" : "minecraft-java", transport: bedrock ? "udp" as const : "tcp" as const, host, port: bedrock ? 19132 : 25565, display: "untrusted display is ignored", capabilities: ["play"] }] });
const markup = (s = server) => renderToStaticMarkup(<ServerConnection server={s} onRefresh={() => {}} />);

test("025B Java and Bedrock have edition-specific instructions and copy values", () => {
  assert.equal(connectionAddresses(endpoint("192.168.1.2"))[0].address, "192.168.1.2:25565");
  assert.equal(connectionAddresses(endpoint("192.168.1.2", true))[0].address, "192.168.1.2");
  const java = markup(endpoint("192.168.1.2")), bedrock = markup(endpoint("192.168.1.2", true));
  assert.match(java, /full server address/); assert.match(java, /Copy address/); assert.doesNotMatch(java, /Copy port/);
  assert.match(bedrock, /separate fields/); assert.match(bedrock, /Port 19132/); assert.match(bedrock, /Copy port/);
});
for (const [host, scope] of [
  ["127.0.0.1", "local"], ["localhost.", "local"], ["127.1", "local"], ["2130706433", "local"], ["0x7f000001", "local"],
  ["[::1]", "local"], ["0:0:0:0:0:0:0:1", "local"], ["::ffff:127.0.0.1", "local"],
  ["10.1.2.3", "lan"], ["172.16.1.2", "lan"], ["172.31.1.2", "lan"], ["192.168.1.2", "lan"], ["169.254.1.2", "lan"], ["fd00::1", "lan"], ["game.local", "lan"],
  ["play.example.com", "external"], ["203.0.113.10", "external"], ["2001:db8::1", "external"], ["172.32.1.2", "external"],
] as const) test(`025B ${host} is classified ${scope} without inventing an address`, () => {
  const info = connectionAddresses(endpoint(host))[0]; assert.ok(info); assert.equal(info.scope, scope);
  const html = markup(endpoint(host));
  if (scope === "local") { assert.match(html, /Only on the GameHub computer/); assert.doesNotMatch(html, /Local network<|public access verified/); }
  if (scope === "external") assert.match(html, /reachability unverified/);
});
for (const host of ["0.0.0.0", "::", "0:0:0:0:0:0:0:0", "::ffff:0.0.0.0", "255.255.255.255", "224.0.0.1", "ff02::1", "fe80::1", "fe80::1%12", "*", "999.1.2.3", "host/secret", "host?token=secret", "user@host", "https://example.com", "<script>", "host\nname", "bad_host"]) test(`025B unsafe/unusable host ${JSON.stringify(host)} has no copy action`, () => {
  assert.deepEqual(connectionAddresses(endpoint(host)), []); assert.doesNotMatch(markup(endpoint(host)), /Copy address|Copy port/); assert.match(markup(endpoint(host)), /Connection information unavailable/);
});
test("025B crossplay can expose separate Java and Bedrock endpoints; explicit unavailable data never falls back", () => {
  const combined = { ...server, connectionEndpoints: [...endpoint("192.168.1.2").connectionEndpoints, ...endpoint("192.168.1.2", true).connectionEndpoints] };
  assert.equal(connectionAddresses(combined).length, 2); assert.match(markup(combined), /Java Edition/); assert.match(markup(combined), /Bedrock Edition/);
  assert.deepEqual(connectionAddresses({ ...server, connectionEndpoints: [] }), []);
  assert.deepEqual(connectionAddresses({ ...endpoint("192.168.1.2"), connectionEndpoints: [{ ...endpoint("192.168.1.2").connectionEndpoints[0], capabilities: ["unavailable"] }] }), []);
  assert.deepEqual(connectionAddresses({ ...endpoint("192.168.1.2"), connectionEndpoints: [{ ...endpoint("192.168.1.2").connectionEndpoints[0], port: 65536 }] }), []);
});
test("025B stopped, transitional and unknown servers distinguish saved details from active connectivity", () => {
  assert.match(markup({ ...server, status: "offline" }), /Use these saved details once it is running/);
  assert.match(markup({ ...server, status: "starting" }), /Wait for Running/);
  assert.match(markup({ ...server, status: "unknown" }), /availability could not be confirmed/);
});
test("025B clipboard writes only the chosen value and falls back without raw diagnostics", async () => {
  const calls: string[] = []; const clipboard = { writeText: async (value: string) => { calls.push(value); } };
  assert.equal(await writeConnectionClipboard("192.168.1.2:25565", clipboard, true), true); assert.deepEqual(calls, ["192.168.1.2:25565"]);
  assert.equal(await writeConnectionClipboard("19132", clipboard, false), false); assert.equal(calls.length, 1);
  assert.equal(await writeConnectionClipboard("19132", undefined), false);
  assert.equal(await writeConnectionClipboard("19132", { writeText: async () => { throw new Error("token=secret C:\\private"); } }), false);
});
test("025B missing/invalid/stopped player counts are not guessed as zero, reconnect marks last report", () => {
  for (const players of [undefined, -1, 1.5, Number.NaN]) assert.equal(playerCountText({ ...server, players }, true), "Players: —");
  assert.equal(playerCountText({ ...server, players: 0 }, true), "Players: 0"); assert.equal(playerCountText({ ...server, players: 2 }, false), "Players: 2 (last reported)");
  assert.equal(playerCountText({ ...server, status: "offline", players: 2 }, true), "Players: —");
  assert.match(renderToStaticMarkup(<ServerPlayers server={server} connection="connected" />), /Player count unavailable/);
  assert.match(renderToStaticMarkup(<ServerPlayers server={{ ...server, players: 0 }} connection="connected" />), /No players reported/);
  assert.match(renderToStaticMarkup(<ServerPlayers server={{ ...server, players: 2 }} connection="connected" />), /visible only to a connected administrator/);
});
test("025B lifecycle transitions cannot recycle old player counts after stop/restart", () => {
  let state: DashboardState = { ...createInitialDashboardState(), servers: [{ ...server, players: 2, playersObservedAt: server.lastStatusUpdate }] };
  state = applyProviderEvent(state, { type: "server.status.changed", providerId: server.providerId, serverId: server.id, status: "offline", timestamp: server.lastStatusUpdate });
  assert.equal(state.servers[0].players, undefined);
  state = applyProviderEvent(state, { type: "server.status.changed", providerId: server.providerId, serverId: server.id, status: "online", timestamp: server.lastStatusUpdate });
  assert.equal(state.servers[0].players, undefined);
});
test("025B presence client binds exact provider/server and projects display names only", async t => {
  const value = { providerId: server.providerId, serverId: server.id, state: "available", observedAt: server.lastStatusUpdate, players: [{ displayName: "Alex", externalPlayerId: "private-id" }], namesComplete: true, privatePath: "C:\\private" };
  const urls: string[] = []; t.mock.method(globalThis, "fetch", async (url: string) => { urls.push(url); return Response.json(value); });
  assert.deepEqual((await getPlayerPresence(server.providerId, server.id)).players, [{ displayName: "Alex" }]); assert.doesNotMatch(JSON.stringify(await getPlayerPresence(server.providerId, server.id)), /private/);
  assert.equal(urls[0], "/api/providers/minecraft/servers/shared/players");
  await assert.rejects(() => getPlayerPresence("minecraft-bedrock", server.id), PlayerPresenceError);
  value.state = "unsupported"; await assert.rejects(() => getPlayerPresence(server.providerId, server.id), PlayerPresenceError);
});
test("025B presence client fails closed on authorization/network/malformed responses", async t => {
  for (const status of [401, 403, 503]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "token=secret" } }, { status }));
    await assert.rejects(() => getPlayerPresence(server.providerId, server.id), e => e instanceof PlayerPresenceError && !e.message.includes("secret"));
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private"); }); await assert.rejects(() => getPlayerPresence(server.providerId, server.id), PlayerPresenceError);
});
