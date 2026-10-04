import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import net from "node:net";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import {
  parseProvisioningRequest,
  ProvisioningCapabilityError,
  ProvisioningValidationError,
  validateProvisioningRequest,
  type ServerProvisioningRequest,
} from "../packages/core/provisioning";
import { InMemoryProviderManager } from "../packages/provider-manager";
import { SyntheticProvider } from "../packages/synthetic-provider";
import { SyntheticProvisioningPlanner } from "../packages/synthetic-provider/provisioning";
import { MinecraftProvider } from "../packages/minecraft-provider";
import { BedrockProvider } from "../packages/bedrock-provider";

const clock = () => new Date("2026-10-03T10:00:00.000Z");
function request(): ServerProvisioningRequest {
  return {
    schemaVersion: 1,
    providerId: "synthetic",
    serverId: "new-server",
    displayName: "Test server",
    hostId: "local",
    storage: { mode: "create", rootId: "test-root", directoryName: "new-server" },
    endpoints: [{ id: "control", protocol: "synthetic-control", transport: "virtual" }],
  };
}

test("synthetic create planning exposes descriptive operations and unclaimed resources", async () => {
  const plan = await new SyntheticProvisioningPlanner("synthetic", clock).plan(request());
  assert.equal(plan.providerId, "synthetic");
  assert.equal(plan.serverId, "new-server");
  assert.equal(plan.mode, "create");
  assert.equal(plan.status, "planned");
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.createdAt, clock().toISOString());
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.managedPaths[0].resolved, false);
  assert.equal(plan.endpoints[0].status, "unreserved");
  assert.deepEqual(plan.operations.map((operation) => operation.kind), ["CREATE_MANAGED_DIRECTORY", "WRITE_CONFIGURATION", "RESERVE_ENDPOINT", "REGISTER_SERVER"]);
  assert.ok(plan.operations.every((operation) => operation.descriptiveOnly));
  assert.equal(plan.warnings[0].code, "PLANNING_ONLY");
});

test("synthetic adoption describes inspection and registration without creating or writing resources", async () => {
  const input = { ...request(), storage: { mode: "adopt" as const, locationRef: "existing-runtime" } };
  const plan = await new SyntheticProvisioningPlanner("synthetic", clock).plan(input);
  assert.equal(plan.mode, "adopt");
  assert.equal(plan.managedPaths[0].ownership, "external");
  assert.deepEqual(plan.operations.map((operation) => operation.kind), ["INSPECT_EXISTING_RUNTIME", "RESERVE_ENDPOINT", "REGISTER_SERVER"]);
});

test("invalid provider and explicit invalid server IDs return structured validation errors", () => {
  for (const providerId of [undefined, "", " ", "../synthetic", 42]) {
    const result = validateProvisioningRequest({ ...request(), providerId });
    assert.equal(result.valid, false);
    assert.ok(result.errors.every((issue) => issue.severity === "blocking"));
  }
  for (const serverId of ["", " ", "../server", "a/b", "a:b", "a".repeat(65), null]) {
    assert.throws(() => parseProvisioningRequest({ ...request(), serverId }), (error) => {
      assert.ok(error instanceof ProvisioningValidationError);
      assert.ok(error.issues.some((issue) => issue.field === "serverId"));
      return true;
    });
  }
});

test("optional server identity and display name are generated deterministically", async () => {
  const input = request();
  delete input.serverId;
  delete input.displayName;
  const left = await new SyntheticProvisioningPlanner("synthetic", clock).plan(input);
  const right = await new SyntheticProvisioningPlanner("synthetic", clock).plan(input);
  assert.deepEqual(left, right);
  assert.match(left.serverId, /^server_[a-f0-9]+$/);
  assert.equal(left.displayName, left.serverId);
  for (const displayName of ["", "   ", "name\n", "a".repeat(121), 1]) {
    assert.equal(validateProvisioningRequest({ ...input, displayName }).valid, false);
  }
});

test("duplicate endpoint IDs or socket definitions are rejected", () => {
  const endpoint = { id: "one", protocol: "example", transport: "tcp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 32123 } };
  for (const second of [endpoint, { ...endpoint, id: "two", protocol: "different-label" }]) {
    const result = validateProvisioningRequest({ ...request(), endpoints: [endpoint, second] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((issue) => issue.code === "DUPLICATE_ENDPOINT"));
  }
  assert.equal(validateProvisioningRequest({ ...request(), endpoints: [endpoint, { ...endpoint, id: "two", transport: "udp" }] }).valid, true);
});

test("endpoint structures enforce transport, port bounds and exclusive fixed/allocation fields", () => {
  const endpoint = { id: "play", protocol: "example", transport: "udp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 32123 } };
  const invalid = [
    { ...endpoint, port: { mode: "fixed", value: 0 } },
    { ...endpoint, port: { mode: "fixed", value: 65536 } },
    { ...endpoint, port: { mode: "fixed", value: 1.2 } },
    { ...endpoint, port: { mode: "fixed", value: "32123" } },
    { ...endpoint, port: { mode: "fixed", value: 32123, poolId: "pool" } },
    { ...endpoint, port: { mode: "allocate", poolId: "pool", value: 32123 } },
    { ...endpoint, port: { mode: "allocate", poolId: "../pool" } },
    { ...endpoint, transport: "virtual" },
    { ...endpoint, transport: "unsupported" },
    { ...endpoint, bindAddress: "https://localhost/path" },
  ];
  for (const value of invalid) assert.equal(validateProvisioningRequest({ ...request(), endpoints: [value] }).valid, false);
  assert.equal(validateProvisioningRequest({ ...request(), endpoints: [{ ...endpoint, port: { mode: "allocate", poolId: "test-pool" } }] }).valid, true);
});

test("opaque nested provider options survive planning with no provider-specific interpretation", async () => {
  const providerOptions = { arbitrary: { values: [true, null, 42, "opaque"], customField: "untouched" } };
  const plan = await new SyntheticProvisioningPlanner("synthetic", clock).plan({ ...request(), providerOptions });
  assert.deepEqual(plan.request.providerOptions as unknown, providerOptions);
  assert.notEqual(plan.request.providerOptions, providerOptions);
  providerOptions.arbitrary.values[0] = false;
  assert.equal(JSON.parse(JSON.stringify(plan.request.providerOptions)).arbitrary.values[0], true);
});

test("create/adopt fields and managed references are explicit and mutually exclusive", () => {
  for (const storage of [
    {}, { rootId: "root" }, { mode: "create" }, { mode: "adopt" },
    { mode: "create", rootId: "root", locationRef: "existing" },
    { mode: "adopt", locationRef: "existing", directoryName: "new" },
    { mode: "adopt", locationRef: "existing", rootId: "root" },
    { mode: "create", rootId: "C:\\server" },
    { mode: "create", rootId: "root", directoryName: "../escape" },
    { mode: "create", rootId: "root", directoryName: "NUL" },
    { mode: "adopt", locationRef: "/etc/runtime" },
  ]) assert.equal(validateProvisioningRequest({ ...request(), storage }).valid, false);
  assert.equal(validateProvisioningRequest({ ...request(), startup: "start-after-apply" }).valid, false);
});

test("plans replay within adapter lifetime and canonical key order preserves stable identity", async () => {
  let clockCalls = 0;
  const planner = new SyntheticProvisioningPlanner("synthetic", () => { clockCalls++; return clock(); });
  const input = request();
  const original = await planner.plan(input);
  const reordered = Object.fromEntries(Object.entries(input).reverse()) as unknown as ServerProvisioningRequest;
  assert.equal(await planner.plan(reordered), original);
  assert.equal(clockCalls, 1);
  const changed = await planner.plan({ ...input, displayName: "Another server" });
  assert.notEqual(changed.requestId, original.requestId);
  assert.notEqual(changed.planId, original.planId);
  assert.equal(changed.serverId, original.serverId); // A preview does not reserve or allocate this explicit ID.
});

test("plans are deeply immutable JSON snapshots without runtime handles", async () => {
  const input = request();
  const plan = await new SyntheticProvisioningPlanner("synthetic", clock).plan(input);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  const frozen = (value: unknown) => {
    if (value && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      for (const child of Object.values(value)) frozen(child);
    }
    assert.notEqual(typeof value, "function");
  };
  frozen(plan);
  input.displayName = "changed later";
  assert.equal(plan.request.displayName, "Test server");
  assert.throws(() => { (plan as any).status = "applied"; }, TypeError);
});

test("non-JSON options, cycles and accessors are rejected without running getters", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => { getterCalls++; return "unsafe"; } });
  for (const providerOptions of [{ callback: () => {} }, { value: undefined }, { value: NaN }, { value: BigInt(1) }, { date: new Date() }, cycle, accessor, [1], { sparse: new Array(2) }]) {
    assert.equal(validateProvisioningRequest({ ...request(), providerOptions }).valid, false);
  }
  assert.equal(getterCalls, 0);
});

test("manager planning leaves registry, lifecycle, history, filesystem and network untouched", async (t) => {
  const manager = new InMemoryProviderManager();
  await manager.initialize();
  const provider = new SyntheticProvider();
  await manager.register(provider);
  const before = await manager.listServers();
  const forbidden = () => assert.fail("Planning attempted a real resource mutation.");
  for (const method of ["mkdir", "writeFile", "appendFile", "rm", "rmdir", "unlink", "rename", "copyFile", "cp", "open"] as const) t.mock.method(fsPromises, method, forbidden);
  for (const method of ["mkdirSync", "writeFileSync", "appendFileSync", "rmSync", "unlinkSync", "renameSync", "copyFileSync", "openSync", "createWriteStream"] as const) t.mock.method(fs, method, forbidden);
  t.mock.method(net.Server.prototype, "listen", forbidden);
  t.mock.method(dgram.Socket.prototype, "bind", forbidden);
  for (const method of ["spawn", "exec", "execFile", "fork"] as const) t.mock.method(childProcess, method, forbidden);
  t.mock.method(provider, "startServer", forbidden);
  t.mock.method(provider, "register", forbidden);
  try {
    await manager.planProvisioning(request());
    await manager.planProvisioning({ ...request(), endpoints: [{ id: "play", protocol: "example", transport: "udp", bindAddress: "127.0.0.1", port: { mode: "allocate", poolId: "test-pool" } }] });
    await manager.planProvisioning({ ...request(), storage: { mode: "adopt", locationRef: "external" } });
    assert.deepEqual(await manager.listServers(), before);
    assert.equal((await provider.getServerStatus("synthetic-main")).status, "offline");
    assert.deepEqual(await manager.listOperations(), []);
    assert.deepEqual(await manager.listEvents(), []);
    assert.deepEqual(await manager.listAudits(), []);
  } finally { await manager.shutdown(); }
});

test("planning capability is optional and unsupported providers fail honestly", async () => {
  const manager = new InMemoryProviderManager();
  await manager.initialize();
  try {
    const unsupported = new SyntheticProvider({ providerId: "legacy" });
    unsupported.getCapabilities = () => ({ "server.start": true });
    await manager.register(unsupported);
    await manager.register(new MinecraftProvider({ serverDir: "tests/fixtures/minecraft-server" }));
    await manager.register(new BedrockProvider());
    for (const providerId of ["legacy", "missing"]) await assert.rejects(manager.planProvisioning({ ...request(), providerId }), ProvisioningCapabilityError);
    const mismatch = new SyntheticProvider({ providerId: "mismatch" });
    Object.defineProperty(mismatch, "provisioning", { value: undefined });
    await manager.register(mismatch);
    await assert.rejects(manager.planProvisioning({ ...request(), providerId: "mismatch" }), ProvisioningCapabilityError);
    assert.equal(new MinecraftProvider({ serverDir: "unused-reference" }).getCapabilities()["server.provision.plan"], true);
    assert.equal(new BedrockProvider().getCapabilities()["server.provision.plan"], true);
    assert.equal(new SyntheticProvider().getCapabilities()["server.provision.apply"], true);
  } finally { await manager.shutdown(); }
});

test("synthetic planner rejects requests for another provider and supports custom registered IDs", async () => {
  await assert.rejects(new SyntheticProvisioningPlanner().plan({ ...request(), providerId: "other" }), ProvisioningCapabilityError);
  const manager = new InMemoryProviderManager();
  await manager.initialize();
  try {
    await manager.register(new SyntheticProvider({ providerId: "custom" }));
    const plan = await manager.planProvisioning({ ...request(), providerId: "custom" });
    assert.equal(plan.providerId, "custom");
  } finally { await manager.shutdown(); }
});
