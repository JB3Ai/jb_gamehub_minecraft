import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationalHome } from "../src/components/OperationalHome";
import { OperationalDashboard } from "../src/components/OperationalDashboard";
import { connectionInfo, inventoryKey, recentActivity, relativeTime, serverIdentity, unresolvedOperation } from "../src/dashboard/homeModel";
import { applyProviderEvent, createInitialDashboardState, upsertServer } from "../src/dashboard/state";
import type { DashboardState, OperationRecord, ServerInventoryItem } from "../src/dashboard/types";

const server: ServerInventoryItem = { id: "same", providerId: "minecraft", name: "Family Java", serverType: "paper", status: "offline", availability: false, lastStatusUpdate: "2026-10-22T12:00:00Z", endpoints: { java: "192.168.1.10:27061" } };
const bedrock: ServerInventoryItem = { ...server, providerId: "minecraft-bedrock", name: "Family Bedrock", endpoints: { java: "", bedrock: "192.168.1.10:29242" } };
const base = (): DashboardState => ({ ...createInitialDashboardState(), loading: false, servers: [server, bedrock], wsConnection: "connected", commandsAuthorized: true });
const props = { onCommand() {}, onRefresh() {}, onCreate() {}, onDetails() {}, onActivity() {}, onConnect() {} };
const html = (state = base()) => renderToStaticMarkup(<OperationalHome {...props} state={state} />);
const op: OperationRecord = { operationId: "fixture", type: "server.start", providerId: "minecraft", serverId: "same", status: "completed", createdAt: "2026-10-22T12:00:00Z" };

test("025A Home is default; advanced panels stay available without rendering their implementation details", () => {
  const markup = renderToStaticMarkup(<OperationalDashboard state={base()} worlds={[]} onSelectServer={() => {}} onCommand={() => {}} onRefresh={() => {}} onValidateWorld={() => {}} onCleanupHistory={() => {}} />);
  assert.match(markup, /Daily operations home/); assert.match(markup, /nav-pill is-active[^>]*>Home/);
  for (const panel of ["SERVERS", "STATUS", "OPERATIONS", "WORLDS", "CONTENT-LIBRARY", "EVENTS", "ANALYTICS", "FAMILY", "REWARDS", "AI-STUDIO"]) assert.ok(markup.includes(panel));
  assert.doesNotMatch(markup, /Operation ID|Current Lifecycle State|REST for commands/);
});
test("025A empty home offers Create Server and stopped servers are healthy", () => {
  const loading = html({ ...base(), servers: [], loading: true });
  assert.match(loading, /Finding your servers/); assert.doesNotMatch(loading, /GameHub has no servers yet/);
  assert.match(html({ ...base(), servers: [] }), /Create your first server/);
  assert.match(html({ ...base(), servers: [] }), />Create Server</);
  assert.doesNotMatch(html(), /home-attention/); assert.match(html(), /Stopped/);
});
for (const [status, label, action, disabled] of [
  ["offline", "Stopped", "Start Server", false], ["online", "Running", "Stop Server", false],
  ["starting", "Starting…", "Starting…", true], ["stopping", "Stopping…", "Stopping…", true],
  ["unknown", "Status unavailable", "Check status", true], ["error", "Status unavailable", "Check status", true],
] as const) test(`025A ${status} renders ${label} with safe action`, () => {
  const markup = html({ ...base(), servers: [{ ...server, status }] });
  assert.ok(markup.includes(label)); assert.ok(markup.includes(action));
  if (disabled) assert.match(markup, /disabled=""/);
  if (status !== "online") assert.doesNotMatch(markup, /Restart Server/);
});
test("025A restart is a secondary online-only action, player count is never invented", () => {
  const markup = html({ ...base(), servers: [{ ...server, status: "online", players: 2 }] });
  assert.match(markup, /Players: 2/); assert.match(markup, /<summary>More actions<\/summary>/); assert.match(markup, /Restart Server/);
  assert.match(html(), /Players: —/);
});
test("025A unresolved matching operation locks only its provider/server card", () => {
  const state = { ...base(), operations: [{ ...op, status: "running" as const }] };
  assert.equal(unresolvedOperation(state.operations, inventoryKey(server)), true);
  assert.equal(unresolvedOperation(state.operations, inventoryKey(bedrock)), false);
  assert.match(html(state), /Working…/);
  assert.notEqual(serverIdentity(inventoryKey(server)), serverIdentity(inventoryKey(bedrock)));
});
test("025A Java and Bedrock connection information is safe and provider appropriate", () => {
  assert.match(html(), /192.168.1.10:27061/); assert.match(html(), /Port 29242/);
  assert.equal(connectionInfo(server)?.local, false);
  assert.equal(connectionInfo({ ...server, endpoints: { java: "127.0.0.1:27061" } })?.local, true);
  assert.match(html({ ...base(), servers: [{ ...server, endpoints: { java: "127.0.0.1:27061" } }] }), /Only on the GameHub computer/);
});
for (const host of ["0.0.0.0", "::", "*", "bad/path", "<script>"]) test(`025A unsafe/wildcard host ${host} is not player connection metadata`, () => {
  const item = { ...server, connectionEndpoints: [{ id: "game", protocol: "java-paper", transport: "tcp" as const, host, port: 27061, display: "do-not-use" }] };
  assert.equal(connectionInfo(item), undefined); assert.match(html({ ...base(), servers: [item] }), /Connection information unavailable/);
});
test("025A IPv6 and unavailable endpoint handling does not derive LAN addresses", () => {
  assert.equal(connectionInfo({ ...server, endpoints: { java: "[::1]:27061" } })?.local, true);
  assert.equal(connectionInfo({ ...server, endpoints: { java: "not configured" } }), undefined);
  assert.equal(connectionInfo({ ...server, endpoints: { java: "192.168.1.10:99999" } }), undefined);
});
test("025A friendly recent activity filters validation/noisy events and hides raw diagnostics", () => {
  const state = { ...base(), operations: [op, { ...op, operationId: "noise", type: "world.validate" as const }, { ...op, operationId: "fail", type: "server.stop" as const, status: "failed" as const, error: { code: "PRIVATE", message: "C:\\private token=secret" } }] };
  const activity = recentActivity(state); assert.equal(activity.length, 2); assert.ok(activity.some(a => a.message === "Family Java could not stop"));
  assert.doesNotMatch(html(state), /PRIVATE|token=secret|C:\\private|noise/); assert.match(html(state), /needs attention/);
});
test("025A recent activity is bounded and time descriptions retain exact timestamps", () => {
  assert.equal(recentActivity({ ...base(), operations: [{ ...op, type: "server.provision.apply", result: { state: "PROVISIONED" } }] })[0].message, "Family Java created");
  assert.equal(recentActivity({ ...base(), operations: [{ ...op, type: "server.provision.apply", result: { state: "ROLLED_BACK" } }] }).length, 0);
  assert.equal(recentActivity({ ...base(), operations: Array.from({ length: 10 }, (_, i) => ({ ...op, operationId: String(i) })) }).length, 5);
  const now = Date.parse("2026-10-22T12:00:00Z");
  assert.equal(relativeTime("2026-10-22T11:57:00Z", now), "3 minutes ago"); assert.equal(relativeTime("2026-10-21T12:00:00Z", now), "Yesterday");
  assert.equal(relativeTime("bad", now), "Time unavailable");
  assert.match(html({ ...base(), operations: [op] }), /dateTime="2026-10-22T12:00:00Z"/);
});
test("025A WebSocket status updates only the exact provider identity; disconnect does not falsify state", () => {
  const next = applyProviderEvent(base(), { type: "server.status.changed", timestamp: "2026-10-22T12:00:05Z", providerId: "minecraft-bedrock", serverId: "same", status: "online" });
  assert.equal(next.servers[0].status, "offline"); assert.equal(next.servers[1].status, "online");
  const disconnected = { ...next, wsConnection: "reconnecting" as const };
  assert.match(html(disconnected), /Reconnecting…/); assert.match(html(disconnected), /Running/); assert.doesNotMatch(html(disconnected), /home-attention/);
  const ambiguous = applyProviderEvent(base(), { type: "server.status.changed", timestamp: op.createdAt, serverId: "same", status: "online" });
  assert.ok(ambiguous.servers.every(s => s.status === "offline"));
  assert.equal(upsertServer(base().servers, { ...bedrock, status: "online" })[0].status, "offline");
});
test("025A retry and administrator attention expose safe messages only", () => {
  const markup = html({ ...base(), error: "private C:\\policy.json token=secret", commandsAuthorized: false });
  assert.match(markup, /Retry/); assert.match(markup, /Connect administrator/); assert.doesNotMatch(markup, /token=secret|policy.json/);
});
