import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { JavaProvisioningPlanner } from "../packages/minecraft-provider/provisioning";
import { BedrockProvisioningPlanner } from "../packages/bedrock-provider/provisioning";
import { SyntheticProvisioningPlanner } from "../packages/synthetic-provider/provisioning";
import { preflightProvisioning, type ProvisioningPreflightContext, type EndpointBinding } from "../packages/core/provisioning-preflight";
import type { ProvisioningPlanner, ServerProvisioningRequest } from "../packages/core/provisioning";
import { InMemoryProviderManager } from "../packages/provider-manager";
import { BedrockProvider } from "../packages/bedrock-provider";

async function fixture(t: TestContext) {
  await fs.mkdir("tests/tmp", { recursive: true });
  const root = await fs.mkdtemp(path.resolve("tests/tmp/preflight-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "artifact"), "fixture only");
  const context: ProvisioningPreflightContext = { hostId: "local", managedRoots: { approved: root }, adoptionLocations: { existing: path.join(root, "existing") }, artifactLocations: { runtime: path.join(root, "artifact") }, endpointInventory: async () => ({ complete: true, bindings: [] }) };
  return { root, context };
}
function request(planner: ProvisioningPlanner): ServerProvisioningRequest {
  const profile = planner.profileAdapter!.profile();
  return { schemaVersion: 1, providerId: profile.providerId, hostId: "local", storage: { mode: "create", rootId: "approved", directoryName: "new-server" }, endpoints: JSON.parse(JSON.stringify(profile.defaultEndpoints)), providerOptions: profile.runtimeKind === "java-paper" ? { artifactRef: "runtime", javaRuntimeRef: "runtime" } : profile.runtimeKind === "native-bds" ? { artifactRef: "runtime" } : {} };
}
for (const [label, planner, port, transport] of [["Java", new JavaProvisioningPlanner(), 25565, "tcp"], ["Bedrock", new BedrockProvisioningPlanner(), 19132, "udp"]] as const) {
  test(`${label} profile exposes defaults and read-only create preflight passes`, async (t) => {
    const { context } = await fixture(t);
    const profile = planner.profileAdapter!.profile();
    assert.equal(profile.defaultEndpoints[0].transport, transport);
    assert.equal((profile.defaultEndpoints[0] as { port: { value: number } }).port.value, port);
    assert.equal(profile.capabilities.apply, false);
    const plan = await planner.plan(request(planner));
    const before = JSON.stringify(plan);
    const result = await preflightProvisioning(plan, planner, context);
    assert.equal(result.status, "PASS", JSON.stringify(result));
    assert.equal(JSON.stringify(await preflightProvisioning(plan, planner, context)), JSON.stringify(result));
    assert.equal(JSON.stringify(plan), before);
  });
  test(`${label} adopt requires directory, executable and configuration`, async (t) => {
    const { root, context } = await fixture(t);
    const req = request(planner); req.storage = { mode: "adopt", locationRef: "existing" }; delete req.providerOptions!.artifactRef;
    const plan = await planner.plan(req);
    assert.equal((await preflightProvisioning(plan, planner, context)).status, "FAIL");
    await fs.mkdir(path.join(root, "existing"));
    assert.ok((await preflightProvisioning(plan, planner, context)).issues.some((i) => i.code === "ARTIFACT_UNAVAILABLE"));
    await fs.writeFile(path.join(root, "existing", String(planner.profileAdapter!.profile().providerDefaults.artifactFile)), "fixture");
    await fs.writeFile(path.join(root, "existing/server.properties"), "level-name=arbitrary");
    assert.equal((await preflightProvisioning(plan, planner, context)).status, "PASS");
    assert.equal(plan.managedPaths[0].ownership, "external");
  });
}
test("create collisions and protected paths fail without inferred ownership", async (t) => {
  const { root, context } = await fixture(t); const planner = new SyntheticProvisioningPlanner();
  const plan = await planner.plan(request(planner));
  await fs.mkdir(path.join(root, "new-server"));
  assert.ok((await preflightProvisioning(plan, planner, context)).issues.some((i) => i.code === "PATH_COLLISION"));
  await fs.writeFile(path.join(root, "new-server/unrelated.txt"), "preserve");
  assert.equal((await preflightProvisioning(plan, planner, context)).status, "FAIL");
  assert.equal((await preflightProvisioning(plan, planner, { ...context, protectedPaths: [root] })).status, "FAIL");
});
test("unapproved references, traversal, relative policy paths and symlink roots fail", async (t) => {
  const { root, context } = await fixture(t); const planner = new SyntheticProvisioningPlanner(); const req = request(planner);
  await assert.rejects(planner.plan({ ...req, storage: { mode: "create", rootId: "approved", directoryName: "../escape" } }));
  const plan = await planner.plan(req);
  assert.equal((await preflightProvisioning(plan, planner, { ...context, managedRoots: {} })).status, "FAIL");
  assert.equal((await preflightProvisioning(plan, planner, { ...context, managedRoots: { approved: "relative" } })).status, "FAIL");
  await fs.symlink(root, path.join(root, "alias"), "junction");
  assert.equal((await preflightProvisioning(plan, planner, { ...context, managedRoots: { approved: path.join(root, "alias") } })).status, "FAIL");
});
for (const transport of ["tcp", "udp"] as const) test(`${transport} collisions respect transport, host and wildcard semantics`, async (t) => {
  const { context } = await fixture(t); const planner = new SyntheticProvisioningPlanner();
  const req = request(planner); req.endpoints = [{ id: "game", protocol: "example", transport, bindAddress: "127.0.0.1", port: { mode: "fixed", value: 19132 } }];
  const plan = await planner.plan(req);
  const binding: EndpointBinding = { hostId: "local", transport, bindAddress: "0.0.0.0", port: 19132 };
  const check = (bindings: EndpointBinding[]) => preflightProvisioning(plan, planner, { ...context, endpointInventory: async () => ({ complete: true, bindings }) });
  assert.ok((await check([binding])).issues.some((i) => i.code === "ENDPOINT_OCCUPIED"));
  assert.equal((await check([{ ...binding, transport: transport === "tcp" ? "udp" : "tcp" }])).status, "PASS");
  assert.equal((await check([{ ...binding, hostId: "remote" }])).status, "PASS");
  assert.equal((await preflightProvisioning(plan, planner, { ...context, endpointInventory: undefined })).status, "WARN");
  assert.equal((await preflightProvisioning(plan, planner, { ...context, endpointInventory: async () => { throw new Error("inventory offline"); } })).status, "FAIL");
  req.endpoints.push({ ...req.endpoints[0], id: "second", bindAddress: "0.0.0.0" } as typeof req.endpoints[number]);
  assert.ok((await preflightProvisioning(await planner.plan(req), planner, context)).issues.some((i) => i.code === "DUPLICATE_ENDPOINT"));
});
test("unsupported profiles, malformed endpoints, altered plans and invalid provider options fail", async (t) => {
  const { context } = await fixture(t); const planner = new BedrockProvisioningPlanner(); const req = request(planner); const plan = await planner.plan(req);
  assert.equal((await preflightProvisioning(plan, undefined, context)).status, "FAIL");
  assert.equal((await preflightProvisioning({ ...plan, serverId: "tampered" }, planner, context)).status, "FAIL");
  await assert.rejects(planner.plan({ ...req, providerOptions: { unsupported: true } }));
  await assert.rejects(planner.plan({ ...req, endpoints: [{ id: "bad", protocol: "bad", transport: "udp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: -1 } }] }));
  assert.equal((await preflightProvisioning(await planner.plan({ ...req, endpoints: [] }), planner, context)).status, "FAIL");
});
test("manager discovers profiles and honors capability mismatches", async (t) => {
  const { context } = await fixture(t); const manager = new InMemoryProviderManager(); await manager.initialize(); t.after(() => manager.shutdown());
  const provider = new BedrockProvider(); await manager.register(provider);
  assert.equal(manager.getProvisioningProfile("minecraft-bedrock").runtimeKind, "native-bds");
  assert.throws(() => manager.getProvisioningProfile("missing"));
  const plan = await manager.planProvisioning(request(provider.provisioning));
  assert.equal((await manager.preflightProvisioning(plan, context)).status, "PASS");
  provider.getCapabilities = () => ({ "server.provision.plan": true });
  assert.equal((await manager.preflightProvisioning(plan, context)).status, "FAIL");
});
test("core has no game constants and preflight does not mutate, bind or spawn", async (t) => {
  const { root, context } = await fixture(t); const planner = new BedrockProvisioningPlanner(); const req = request(planner);
  for (const file of ["provisioning.ts", "provisioning-profile.ts", "provisioning-planner.ts", "provisioning-preflight.ts"]) assert.doesNotMatch(await fs.readFile(`packages/core/${file}`, "utf8"), /25565|19132|paper\.jar|bedrock_server|javaRuntimeRef|JBGH021AWorld/);
  const before = await fs.readdir(root, { recursive: true });
  const fail = () => { throw new Error("Unexpected mutation/runtime action"); };
  try {
    for (const name of ["mkdir", "writeFile", "copyFile", "rename", "rm", "unlink"] as const) t.mock.method(fs, name, fail);
    t.mock.method(net.Server.prototype, "listen", fail); t.mock.method(dgram.Socket.prototype, "bind", fail); t.mock.method(childProcess, "spawn", fail);
    assert.equal((await preflightProvisioning(await planner.plan(req), planner, context)).status, "PASS");
    assert.deepEqual(await fs.readdir(root, { recursive: true }), before);
    assert.equal(await fs.readFile(path.join(root, "artifact"), "utf8"), "fixture only");
  } finally { t.mock.restoreAll(); }
});

