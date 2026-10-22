import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqlitePersistenceRepository } from "../packages/core/sqlite-repository";
import { setupCatalog, publicSetupConfiguration, parseSetupConfiguration, validateSetupConfiguration, type SetupConfigurationProbes } from "../packages/core/setup-configuration";
import { managedFixture } from "./helpers/managed-create-fixture";

function fixtureProbes(hash: string): SetupConfigurationProbes {
  return { host: async () => ({ platform: "win32", architecture: "x64", elevated: false, capabilityChecksAvailable: true, inventory: { complete: true, bindings: [] } }), storage: async () => ({ exists: true, access: "allowed-advisory", availableBytes: 4n * 1024n ** 3n }), database: async () => ({ exists: true, readable: true, formatValid: true, locationAccess: "allowed-advisory" }), fileHash: async () => hash };
}
export { fixtureProbes };
test("catalog/public configuration contains stable IDs, never trusted paths or operator records", async t => {
  const f = await managedFixture(t), catalog = setupCatalog({ policies: { minecraft: f.policy }, authorize: () => undefined }, path.join(f.base, "state.sqlite"), { javaPort: 25565, bedrockPort: 19132 });
  const view = publicSetupConfiguration(catalog), json = JSON.stringify(view);
  for (const secret of [f.root, f.source, f.java, "prior-license", "explicit-operator", "artifactLocations", "sha256", "location\""]) assert.ok(!json.includes(secret));
  assert.equal(view.onboardingComplete, false); assert.equal(view.revision, 0); assert.equal(view.choices.databases[0].id, "default");
  const changed = { ...f.policy, managedRoots: { ...f.policy.managedRoots, root: f.policy.managedRoots.root + "-changed" } };
  const next = setupCatalog({ policies: { minecraft: changed }, authorize: () => undefined }, path.join(f.base, "state.sqlite"), catalog.defaults);
  assert.equal(next.storage[0].id, catalog.storage[0].id); assert.notEqual(next.digest, catalog.digest);
});
test("explicit schema, approval, revision, IDs and ports reject unexpected fields and traversal", () => {
  const body: any = { schemaVersion: 1, expectedRevision: 0, catalogDigest: "a".repeat(64), approved: true, storage: { rootId: "root" }, database: { locationId: "default" }, java: { runtimeId: "java" }, ports: { java: 25565, bedrock: 19132 } };
  assert.equal(parseSetupConfiguration(body).settings.javaPort, 25565);
  for (const patch of [{ storage: { rootId: "../outside" } }, { database: { locationId: "C:/private" } }, { java: { runtimeId: "java", path: "evil" } }, { approved: false }, { expectedRevision: -1 }, { expectedRevision: "0" }, { extra: true }, { ports: { java: 0, bedrock: 19132 } }, { ports: { java: 25565, bedrock: 65536 } }, { ports: { java: "25565", bedrock: 19132 } }]) assert.throws(() => parseSetupConfiguration({ ...body, ...patch }));
});
test("validation resolves IDs only, checks hashes, and reports occupied ports without launching or binding", async t => {
  const f = await managedFixture(t), catalog = setupCatalog({ policies: { minecraft: f.policy }, authorize: () => undefined }, path.join(f.base, "state.sqlite"), { javaPort: 25565, bedrockPort: 19132 });
  const settings = { storageRootId: catalog.storage[0].id, databaseLocationId: "default", javaRuntimeId: catalog.java[0].id, javaPort: 25565, bedrockPort: 19132 }, probes = fixtureProbes(catalog.java[0].sha256);
  probes.host = async () => ({ platform: "win32", architecture: "x64", elevated: false, capabilityChecksAvailable: true, inventory: { complete: true, bindings: [{ transport: "tcp", bindAddress: "127.0.0.1", port: 25565 }, { transport: "udp", bindAddress: "::", port: 19132 }] } });
  assert.deepEqual(await validateSetupConfiguration(settings, catalog, probes), ["WRITE_ACCESS_UNVERIFIED", "JAVA_PORT_OCCUPIED", "BEDROCK_PORT_OCCUPIED"]);
  for (const patch of [{ storageRootId: "unknown" }, { javaRuntimeId: "unknown" }, { databaseLocationId: "other" }, { javaRuntimeId: undefined }]) await assert.rejects(validateSetupConfiguration({ ...settings, ...patch }, catalog, probes));
  probes.fileHash = async () => "c".repeat(64); await assert.rejects(validateSetupConfiguration(settings, catalog, probes), /CONFIGURATION_VALIDATION_FAILED/);
});
test("inaccessible storage, unknown inventory and unavailable database fail before persistence", async t => {
  const f = await managedFixture(t), catalog = setupCatalog({ policies: { minecraft: f.policy }, authorize: () => undefined }, path.join(f.base, "state.sqlite"), { javaPort: 25565, bedrockPort: 19132 });
  const settings = { storageRootId: catalog.storage[0].id, databaseLocationId: "default", javaRuntimeId: catalog.java[0].id, javaPort: 25565, bedrockPort: 19132 };
  for (const mode of ["storage", "database", "inventory"] as const) {
    const probes = fixtureProbes(catalog.java[0].sha256);
    if (mode === "storage") probes.storage = async () => ({ exists: true, access: "denied", availableBytes: 8n * 1024n ** 3n });
    if (mode === "database") probes.database = async () => ({ exists: true, readable: false, formatValid: false, locationAccess: "denied" });
    if (mode === "inventory") { const observed = await probes.host(); probes.host = async () => ({ ...observed, inventory: { complete: false, bindings: [] } }); }
    await assert.rejects(validateSetupConfiguration(settings, catalog, probes), /CONFIGURATION_VALIDATION_FAILED/);
  }
});
test("configuration CAS, idempotence, restart and audit failure rollback preserve existing repository state", async t => {
  let db: DatabaseSync | undefined, second: SqlitePersistenceRepository | undefined;
  t.after(async () => { await second?.close(); db?.close(); });
  const f = await managedFixture(t), { manager, repository } = await f.open(), dbPath = path.join(f.base, "state.sqlite");
  db = new DatabaseSync(dbPath);
  const settings = { storageRootId: "root", databaseLocationId: "default", javaRuntimeId: "java", javaPort: 25565, bedrockPort: 19132 }, digest = "a".repeat(64);
  const before = { operations: await repository.listOperations(), claims: manager.listProvisioningClaims(), definitions: manager.listManagedRuntimes() };
  const first = repository.setupConfiguration.save(settings, 0, digest, "operator", "2026-10-22T12:00:00Z"); assert.equal(first.record.revision, 1);
  assert.equal(repository.setupConfiguration.save(settings, 1, digest, "operator", "2026-10-22T12:01:00Z").unchanged, true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='setup.configuration.saved'").get()?.n, 1);
  assert.throws(() => repository.setupConfiguration.save(settings, 0, digest, "operator", "later"), /CONFIGURATION_STALE/);
  second = new SqlitePersistenceRepository({ filePath: dbPath }); await second.initialize();
  assert.deepEqual(second.setupConfiguration.read(), first.record);
  second.setupConfiguration.save({ ...settings, javaPort: 25566 }, 1, digest, "other-operator", "2026-10-22T12:02:00Z");
  assert.throws(() => repository.setupConfiguration.save({ ...settings, javaPort: 25567 }, 1, digest, "operator", "later"), /CONFIGURATION_STALE/);
  const current = repository.setupConfiguration.read();
  db.exec("CREATE TRIGGER reject_setup_audit BEFORE INSERT ON audit_log WHEN NEW.action='setup.configuration.saved' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(() => repository.setupConfiguration.save(settings, 2, digest, "operator", "later"), /audit unavailable/);
  assert.deepEqual(repository.setupConfiguration.read(), current);
  assert.deepEqual({ operations: await repository.listOperations(), claims: manager.listProvisioningClaims(), definitions: manager.listManagedRuntimes() }, before);
});
