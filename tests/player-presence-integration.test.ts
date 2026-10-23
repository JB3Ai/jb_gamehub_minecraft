import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "../server";
import { tokenAdminAuthorizer } from "../packages/core/provisioning-api";
import { managedFixture } from "./helpers/managed-create-fixture";

test("025B mounted presence route remains authenticated and leaves SQLite untouched", async t => {
  const fixture = await managedFixture(t), previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  const key = "025B-integration-fixture-not-an-operator-key-0123456789", databasePath = path.join(fixture.base, "presence.sqlite");
  const server = await startServer(0, { minecraftServerDir: fixture.base, persistenceDbPath: databasePath, aiProvider: "fallback" }, { policies: { minecraft: fixture.policy }, authorize: tokenAdminAuthorizer(key) });
  if (!server.listening) await once(server, "listening");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const snapshot = () => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => {
    const name = String(row.name); assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/); return [name, db.prepare(`SELECT * FROM "${name}"`).all()];
  }));
  try {
    const before = snapshot(), base = `http://127.0.0.1:${(server.address() as any).port}`;
    const url = base + "/api/providers/synthetic/servers/synthetic-main/players";
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status, 401);
    const response = await fetch(url, { headers: { authorization: "Bearer " + key } }); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const value = await response.json(); assert.equal(value.state, "not-running"); assert.deepEqual(value.players, []);
    assert.doesNotMatch(JSON.stringify(value), /runtimeRoot|externalPlayerId|childId|0123456789/);
    assert.deepEqual(snapshot(), before);
  } finally {
    db.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
