import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configurationHost } from "./helpers/configuration-api";
import { SqlitePersistenceRepository } from "../packages/core/sqlite-repository";

const onboardingUrl = (configurationUrl: string) => configurationUrl.replace(/configuration$/, "onboarding");
test("fresh onboarding GET is read-only INCOMPLETE and completion requires administrator authorization", async t => {
  const h = await configurationHost(t), url = onboardingUrl(h.url);
  assert.equal((await fetch(url)).status, 401);
  h.options.authorize = () => ({ actor: "viewer", admin: false });
  assert.equal((await fetch(url + "/complete", { method: "POST", headers: h.headers, body: JSON.stringify({ configurationRevision: 1 }) })).status, 403);
  h.options.authorize = () => ({ actor: "admin", admin: true });
  const initial = await (await fetch(url, { headers: h.headers })).json(); assert.equal(initial.status, "INCOMPLETE"); assert.equal(initial.configurationRevision, 0);
  const result = await fetch(url + "/complete", { method: "POST", headers: h.headers, body: JSON.stringify({ configurationRevision: 1 }) });
  assert.equal(result.status, 409); assert.equal((await result.json()).error.code, "ONBOARDING_NOT_READY");
  assert.equal(h.repository.setupConfiguration.onboarding().status, "INCOMPLETE");
});
test("warning readiness completes once, survives reopen and later settings never reset READY", async t => {
  let reopened: SqlitePersistenceRepository | undefined, db: DatabaseSync | undefined;
  t.after(async () => { await reopened?.close(); db?.close(); });
  const h = await configurationHost(t), url = onboardingUrl(h.url); assert.equal((await h.post(h.request())).status, 200);
  const before = JSON.stringify({ operations: await h.repository.listOperations(), claims: h.manager.listProvisioningClaims(), definitions: h.manager.listManagedRuntimes(), policy: h.options.policies });
  const complete = () => fetch(url + "/complete", { method: "POST", headers: h.headers, body: JSON.stringify({ configurationRevision: 1 }) });
  const first = await complete(); assert.equal(first.status, 200); const ready = await first.json(); assert.equal(ready.status, "READY"); assert.equal(ready.completedBy, undefined);
  assert.deepEqual(await (await complete()).json(), ready);
  db = new DatabaseSync(path.join(h.f.base, "state.sqlite"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='setup.onboarding.completed'").get()?.n, 1);
  reopened = new SqlitePersistenceRepository({ filePath: path.join(h.f.base, "state.sqlite") }); await reopened.initialize(); assert.equal(reopened.setupConfiguration.onboarding().status, "READY");
  const previous = h.repository.setupConfiguration.read()!;
  h.repository.setupConfiguration.save({ ...previous, javaPort: previous.javaPort + 1 }, 1, previous.catalogDigest, "another-admin", new Date().toISOString());
  const later = await (await fetch(url, { headers: h.headers })).json(); assert.equal(later.status, "READY"); assert.equal(later.configurationRevision, 1); assert.equal(later.currentConfigurationRevision, 2); assert.equal(later.configurationChanged, true);
  assert.equal((await complete()).status, 409); assert.equal((await (await fetch(h.url, { headers: h.headers })).json()).onboardingComplete, true);
  assert.equal(JSON.stringify({ operations: await h.repository.listOperations(), claims: h.manager.listProvisioningClaims(), definitions: h.manager.listManagedRuntimes(), policy: h.options.policies }), before);
  assert.deepEqual(await fs.readdir(h.f.root), []);
});
test("blocked/unknown readiness, catalog drift and runtime drift cannot complete", async t => {
  const h = await configurationHost(t); await h.post(h.request()); const url = onboardingUrl(h.url);
  const complete = () => fetch(url + "/complete", { method: "POST", headers: h.headers, body: JSON.stringify({ configurationRevision: 1 }) });
  const original = h.probes.host;
  h.probes.host = async () => ({ ...await original(), platform: "linux" }); assert.equal((await complete()).status, 409);
  h.probes.host = async () => ({ ...await original(), inventory: { complete: false, bindings: [] } }); assert.equal((await complete()).status, 409);
  h.probes.host = original; h.probes.fileHash = async () => "f".repeat(64); assert.equal((await complete()).status, 409);
  h.options.policies.minecraft.managedRoots.root += "-changed"; const changed = await complete(); assert.equal(changed.status, 409); assert.equal((await changed.json()).error.code, "ONBOARDING_NOT_READY");
  assert.equal(h.repository.setupConfiguration.onboarding().status, "INCOMPLETE");
});
test("configuration changed during async readiness fails the final transactional revision check", async t => {
  const h = await configurationHost(t); await h.post(h.request());
  let release!: () => void, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }), original = h.probes.fileHash;
  h.probes.fileHash = async location => { began(); await gate; return original(location); };
  const request = fetch(onboardingUrl(h.url) + "/complete", { method: "POST", headers: h.headers, body: JSON.stringify({ configurationRevision: 1 }) }); await started;
  const record = h.repository.setupConfiguration.read()!;
  h.repository.setupConfiguration.save({ ...record, javaPort: 25566 }, 1, record.catalogDigest, "other", new Date().toISOString()); release();
  const result = await request; assert.equal(result.status, 409); assert.equal((await result.json()).error.code, "CONFIGURATION_STALE"); assert.equal(h.repository.setupConfiguration.onboarding().status, "INCOMPLETE");
});
test("completion and its audit commit atomically", async t => {
  let db: DatabaseSync | undefined; t.after(() => db?.close());
  const h = await configurationHost(t); await h.post(h.request());
  db = new DatabaseSync(path.join(h.f.base, "state.sqlite")); db.exec("CREATE TRIGGER reject_completion BEFORE INSERT ON audit_log WHEN NEW.action='setup.onboarding.completed' BEGIN SELECT RAISE(ABORT,'unavailable'); END");
  const result = await fetch(onboardingUrl(h.url) + "/complete", { method: "POST", headers: h.headers, body: JSON.stringify({ configurationRevision: 1 }) }); assert.equal(result.status, 503); assert.equal(h.repository.setupConfiguration.onboarding().status, "INCOMPLETE");
  assert.equal(db.prepare("SELECT count(*) AS n FROM onboarding_state").get()?.n, 0);
});
