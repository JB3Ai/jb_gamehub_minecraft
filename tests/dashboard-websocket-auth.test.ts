import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import WebSocket from "ws";
import { startServer } from "../server";
import { tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { websocketAuthorization, websocketProtocol } from "../packages/core/websocket-auth";
import { dashboardWebSocketProtocols } from "../src/dashboard/adminConnection";
import { managedFixture } from "./helpers/managed-create-fixture";

const key = "dashboard-test-admin-key-not-a-real-credential-0123456789";
test("WebSocket upgrade accepts browser authentication/reconnect and preserves REST rejection", async t => {
  const f = await managedFixture(t), previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  const server = await startServer(0, { minecraftServerDir: f.base, persistenceDbPath: path.join(f.base, "websocket.sqlite"), aiProvider: "fallback" },
    { policies: { minecraft: f.policy }, authorize: tokenAdminAuthorizer(key) });
  if (!server.listening) await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`, wsUrl = url.replace("http:", "ws:") + "/ws";
  try {
    const configuration = await fetch(url + "/api/websocket-options");
    assert.equal(configuration.headers.get("cache-control"), "no-store");
    assert.deepEqual(await configuration.json(), { authenticationRequired: true });
    for (const credential of [undefined, "wrong-credential"]) {
      const response = await fetch(url + "/api/provisioning/setup-options", { headers: credential ? { authorization: "Bearer " + credential } : {} });
      assert.equal(response.status, 401);
      assert.ok(!JSON.stringify(await response.json()).includes(key));
    }
    assert.equal((await fetch(url + "/api/provisioning/setup-options", { headers: { authorization: "Bearer " + key } })).status, 200);
    const protocols = dashboardWebSocketProtocols(key), encoded = protocols[1];
    // A second connection uses the identical valid mechanism; no cookie or REST auth change.
    for (let connection = 0; connection < 2; connection++) {
      const socket = new WebSocket(wsUrl, protocols);
      const [message] = await once(socket, "message");
      assert.equal(JSON.parse(String(message)).type, "connection.ready");
      assert.equal(socket.protocol, "jbgh-admin");
      assert.ok(!socket.url.includes(key) && !socket.url.includes(encoded));
      socket.close(); await once(socket, "close");
    }
    const legacy = new WebSocket(wsUrl, { headers: { authorization: "Bearer " + key } });
    await once(legacy, "message"); legacy.close(); await once(legacy, "close");
    for (const rejected of [undefined, dashboardWebSocketProtocols("wrong-credential"), ["jbgh-admin", "jbgh-auth.invalid!"], [encoded]]) {
      // Invalid syntax is checked by the decoder below; valid HTTP tokens reach server verification.
      if (rejected?.some(value => value.includes("!"))) continue;
      await new Promise<void>((resolve, reject) => {
        const socket = rejected ? new WebSocket(wsUrl, rejected) : new WebSocket(wsUrl);
        socket.on("error", error => { if (error.message.includes(key) || error.message.includes(encoded)) reject(new Error("Credential reflected in socket error")); });
        socket.once("unexpected-response", (request, response) => {
          try { assert.equal(response.statusCode, 401); response.resume(); request.destroy(); resolve(); } catch (error) { reject(error); }
        });
        socket.once("open", () => { socket.close(); reject(new Error("Unauthenticated socket accepted")); });
      });
    }
    const audit = await fetch(url + "/api/history/audit", { headers: { authorization: "Bearer " + key } });
    const evidence = JSON.stringify(await audit.json()) + logs.join("\n");
    assert.ok(!evidence.includes(key)); assert.ok(!evidence.includes(encoded));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test("WebSocket credentials fail closed and never become the negotiated protocol", () => {
  const protocols = dashboardWebSocketProtocols(key);
  const request = (header: string, origin = "http://localhost:3010") => ({ headers: { host: "localhost:3010", origin, "sec-websocket-protocol": header } }) as IncomingMessage;
  assert.equal(websocketAuthorization(request(protocols.join(", "))), "Bearer " + key);
  assert.equal(websocketProtocol(new Set(protocols)), "jbgh-admin");
  assert.equal(websocketProtocol(new Set([protocols[1]])), false);
  for (const header of ["", "jbgh-admin", protocols[1], protocols.join(",") + ",extra", "jbgh-admin,jbgh-auth.invalid!", "jbgh-admin,jbgh-auth." + "a".repeat(6000)]) assert.equal(websocketAuthorization(request(header)), undefined);
  assert.equal(websocketAuthorization(request(protocols.join(","), "http://foreign.invalid")), undefined);
  const queryOnly = { headers: { host: "localhost:3010" }, url: "/ws?token=" + key } as IncomingMessage;
  assert.equal(websocketAuthorization(queryOnly), undefined);
});
