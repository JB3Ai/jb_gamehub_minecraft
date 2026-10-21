import test from "node:test";
import assert from "node:assert/strict";
import { getDashboardAccessKey, setDashboardAccessKey, subscribeAdminConnection, dashboardWebSocketProtocols } from "../src/dashboard/adminConnection";
import { getProviders, getProvisioningSetupOptions } from "../src/dashboard/apiClient";
import { DashboardEventStream } from "../src/dashboard/eventStream";

test("verified page connection supplies existing REST bearer headers and clears on disconnect", async t => {
  const key = "fixture-dashboard-connection-not-a-real-key";
  t.after(() => setDashboardAccessKey(""));
  let changes = 0; const unsubscribe = subscribeAdminConnection(() => changes++);
  const calls: Array<{ url: string; authorization: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({ providers: [] });
  });
  setDashboardAccessKey(key); setDashboardAccessKey(key); assert.equal(changes, 1);
  await getProviders(); assert.equal(calls.at(-1)!.authorization, "Bearer " + key);
  await getProvisioningSetupOptions({ token: "explicit-other-key" }); assert.equal(calls.at(-1)!.authorization, "Bearer explicit-other-key");
  setDashboardAccessKey(""); await getProviders(); assert.equal(calls.at(-1)!.authorization, null);
  assert.equal(getDashboardAccessKey(), ""); assert.equal(changes, 2); unsubscribe();
  assert.ok(calls.every(call => !call.url.includes(key)));
});

test("dashboard reconnect retains header authentication and disconnect cancels retries", t => {
  const key = "fixture-websocket-reconnect-not-a-real-key", sockets: FakeSocket[] = [];
  class FakeSocket {
    onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (message: { data: string }) => void;
    constructor(readonly url: string, readonly protocols?: string | string[]) { sockets.push(this); }
    close() { this.onclose?.(); }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const states: string[] = [];
  const stream = new DashboardEventStream("ws://localhost:3010/ws", () => {}, state => states.push(state), key);
  stream.connect(); assert.equal(sockets.length, 1); sockets[0].onopen?.(); sockets[0].onclose?.();
  t.mock.timers.tick(1000); assert.equal(sockets.length, 2);
  assert.deepEqual(sockets[0].protocols, dashboardWebSocketProtocols(key)); assert.deepEqual(sockets[1].protocols, sockets[0].protocols);
  assert.ok(sockets.every(socket => socket.url === "ws://localhost:3010/ws"));
  stream.disconnect(); t.mock.timers.tick(30000); assert.equal(sockets.length, 2);
  assert.equal(states.at(-1), "disconnected");
});
