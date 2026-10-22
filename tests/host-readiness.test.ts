import test from "node:test";
import assert from "node:assert/strict";
import { addressesOverlap, inspectHostReadiness, readinessStatus, type HostReadinessInput, type ReadinessProbes, type StorageObservation } from "../packages/core/host-readiness";

const GiB = 1024n ** 3n;
function fixture() {
  const input: HostReadinessInput = { locations: [{ id: "storage.approved", path: "private-operator-path" }], endpoints: [{ id: "endpoint.game", hostId: "local", transport: "udp", bindAddress: "0.0.0.0", port: 29242 }], reservations: [] };
  const probes: ReadinessProbes = { host: async () => ({ platform: "win32", architecture: "x64", elevated: true, capabilityChecksAvailable: true, inventory: { complete: true, bindings: [] } }),
    storage: async () => ({ exists: true, access: "allowed-advisory", availableBytes: 4n * GiB }), runtimes: async () => [], now: () => new Date("2026-10-21T20:00:00Z") };
  return { input, probes };
}
test("host readiness is an observation with explicit unverified writability, not an authorization", async () => {
  const { input, probes } = fixture(), before = JSON.stringify(input), report = await inspectHostReadiness(input, probes);
  assert.equal(report.status, "WARNING"); assert.equal(report.readOnly, true); assert.equal(report.authorizationGranted, false);
  assert.equal(report.checkedAt, "2026-10-21T20:00:00.000Z");
  assert.ok(report.checks.every(check => check.title && check.message));
  assert.equal(report.checks.find(c => c.id === "storage.approved.access")?.code, "STORAGE_WRITE_UNVERIFIED");
  assert.equal(report.checks.find(c => c.id === "endpoint.game")?.code, "ENDPOINT_OBSERVED_FREE");
  assert.ok(!JSON.stringify(report).includes("private-operator-path")); assert.equal(JSON.stringify(input), before);
  assert.equal(readinessStatus([]), "PASS"); assert.equal(readinessStatus([{ id: "one", category: "host", code: "test", status: "WARNING" }, { id: "two", category: "host", code: "test", status: "BLOCKED" }]), "BLOCKED");
});

for (const mode of ["failure", "incomplete", "malformed", "unsupported"] as const) test(`inventory fails closed: ${mode}`, async () => {
  const { input, probes } = fixture(), original = await probes.host();
  probes.host = async () => {
    if (mode === "failure") throw new Error("private process or credential");
    return { ...original, platform: mode === "unsupported" ? "linux" : "win32", inventory: { complete: mode !== "incomplete", bindings: mode === "malformed" ? [{ transport: "udp", bindAddress: "invalid", port: 29242 }] : [] } };
  };
  const report = await inspectHostReadiness(input, probes); assert.equal(report.status, "BLOCKED"); assert.ok(!JSON.stringify(report).includes("credential"));
  if (mode !== "unsupported") assert.equal(report.checks.find(c => c.id === "endpoint.game")?.code, "ENDPOINT_STATUS_UNKNOWN");
});

for (const [bytes, status] of [[GiB - 1n, "BLOCKED"], [GiB, "WARNING"], [2n * GiB, "PASS"], [2n ** 65n, "PASS"]] as const) test(`disk capacity boundary ${bytes}`, async () => {
  const { input, probes } = fixture(); probes.storage = async () => ({ exists: true, access: "allowed-advisory", availableBytes: bytes });
  const check = (await inspectHostReadiness(input, probes)).checks.find(c => c.id.endsWith(".capacity"));
  assert.equal(check?.status, status); assert.equal(check?.facts?.availableBytes, bytes.toString());
});

test("permission failure blocks, missing root needs creation, and unavailable space is never zero/free", async () => {
  for (const mode of ["denied", "missing", "unavailable"] as const) {
    const { input, probes } = fixture(); probes.storage = async (): Promise<StorageObservation> => { if (mode === "unavailable") throw new Error("C:/private-path"); return { exists: mode !== "missing", access: mode === "denied" ? "denied" : "allowed-advisory", availableBytes: 4n * GiB }; };
    const report = await inspectHostReadiness(input, probes);
    assert.equal(report.checks.find(c => c.category === "storage")?.code, mode === "denied" ? "STORAGE_ACCESS_DENIED" : mode === "missing" ? "STORAGE_CREATION_REQUIRED" : "STORAGE_OBSERVATION_UNAVAILABLE");
    assert.ok(!JSON.stringify(report).includes("private-path"));
  }
});

test("TCP/UDP/address conflicts and retained claims are distinguished without acquiring a claim", async () => {
  const { input, probes } = fixture(), host = await probes.host();
  for (const transport of ["tcp", "udp"] as const) {
    probes.host = async () => ({ ...host, inventory: { complete: true, bindings: [{ transport, bindAddress: "127.0.0.1", port: 29242 }] } });
    assert.equal((await inspectHostReadiness(input, probes)).checks.find(c => c.id === "endpoint.game")?.code, transport === "udp" ? "ENDPOINT_OCCUPIED" : "ENDPOINT_OBSERVED_FREE");
    if (transport === "udp") assert.equal((await inspectHostReadiness(input, probes)).checks.find(c => c.id === "endpoint.game")?.status, "WARNING");
  }
  probes.host = async () => host; input.reservations.push({ hostId: "local", transport: "udp", port: 29242 });
  const check = (await inspectHostReadiness(input, probes)).checks.find(c => c.id === "endpoint.game");
  assert.equal(check?.status, "WARNING"); assert.equal(check?.code, "ENDPOINT_RESERVED"); assert.equal(check?.facts?.reservationAcquired, false);
  assert.ok(addressesOverlap("::", "127.0.0.1")); assert.ok(addressesOverlap("::ffff:127.0.0.1", "127.0.0.1")); assert.ok(!addressesOverlap("127.0.0.1", "127.0.0.2"));
});

for (const transport of ["tcp", "udp"] as const) test(`occupied configured ${transport} endpoint warns without changing the observation`, async () => {
  const { input, probes } = fixture(), host = await probes.host();
  input.endpoints[0].transport = transport;
  const binding = { transport, bindAddress: "127.0.0.1", port: 29242 };
  probes.host = async () => ({ ...host, inventory: { complete: true, bindings: [binding] } });
  const before = JSON.stringify({ input, binding }), report = await inspectHostReadiness(input, probes);
  const check = report.checks.find(item => item.id === "endpoint.game");
  assert.equal(check?.status, "WARNING"); assert.equal(check?.code, "ENDPOINT_OCCUPIED");
  assert.equal(JSON.stringify({ input, binding }), before);
});

test("disk thresholds are injectable and invalid threshold ordering fails closed", async () => {
  const { input, probes } = fixture();
  input.diskThresholds = { minimumBytes: 5n * GiB, recommendedBytes: 6n * GiB };
  assert.equal((await inspectHostReadiness(input, probes)).checks.find(check => check.id.endsWith(".capacity"))?.status, "BLOCKED");
  input.diskThresholds = { minimumBytes: 1n, recommendedBytes: 0n };
  await assert.rejects(inspectHostReadiness(input, probes), /READINESS_THRESHOLD_INVALID/);
});

test("new/unelevated hosts expose missing configuration without elevating or inventing defaults", async () => {
  const { input, probes } = fixture(), host = await probes.host(); probes.host = async () => ({ ...host, elevated: false }); input.locations = []; input.endpoints = [];
  const codes = (await inspectHostReadiness(input, probes)).checks.map(c => c.code);
  for (const code of ["PROCESS_NOT_ELEVATED", "STORAGE_NOT_CONFIGURED", "ENDPOINTS_NOT_CONFIGURED"]) assert.ok(codes.includes(code));
});

test("missing Windows capability or unsupported architecture is a blocker", async () => {
  for (const patch of [{ architecture: "arm64" }, { capabilityChecksAvailable: false }]) {
    const { input, probes } = fixture(), host = await probes.host(); probes.host = async () => ({ ...host, ...patch });
    const check = (await inspectHostReadiness(input, probes)).checks.find(c => c.id === "host.capabilities");
    assert.equal(check?.status, "BLOCKED"); assert.equal(check?.code, "WINDOWS_CAPABILITIES_UNAVAILABLE");
  }
});
test("database readability and existing configuration are reported without opening or authorizing a database", async () => {
  const { input, probes } = fixture(); input.databasePath = "private-database-location"; input.configuration = { configured: true, managedRuntimeCount: 2, attachedRuntimeCount: 1 };
  for (const readable of [true, false]) {
    probes.database = async () => ({ exists: true, readable, formatValid: readable, locationAccess: "allowed-advisory" });
    const report = await inspectHostReadiness(input, probes), database = report.checks.find(check => check.id === "database");
    assert.equal(database?.status, readable ? "WARNING" : "BLOCKED"); assert.equal(database?.details?.databaseOpened, false);
    assert.equal(report.configuration.managedRuntimeCount, 2); assert.equal(report.configuration.preserveExisting, true);
    assert.ok(report.checks.some(check => check.code === "EXISTING_RUNTIMES_PRESERVED")); assert.ok(!JSON.stringify(report).includes("private-database-location"));
  }
});
