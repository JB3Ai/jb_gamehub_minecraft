import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { assertDisposableRuntime, assertUdpPortAvailable, deterministicServerProperties, discoverValidatedWorld, isInsideRoot, safeXuidReference } from "../integration/bedrock/scripts/native-bds-acceptance-utils";

for (const id of ["JBGH021AWorld", "Bedrock level"]) {
  test(`native BDS world discovery accepts validated provider world ${id}`, async () => {
    const validated: string[] = [];
    const result = await discoverValidatedWorld([{ id }], async (worldId) => {
      validated.push(worldId);
      return { valid: true };
    });
    assert.deepEqual(result, { discoveredWorldIds: [id], world: id, worldDiscovered: true });
    assert.deepEqual(validated, [id]);
  });
}

test("native BDS world discovery fails without provider worlds or valid ids", async () => {
  for (const worlds of [[], [{ id: "" }, { id: "   " }]]) {
    const result = await discoverValidatedWorld(worlds, async () => {
      assert.fail("No world should be validated without a valid discovered id");
    });
    assert.equal(result.worldDiscovered, false);
    assert.equal(result.world, "");
  }
});

test("native BDS world discovery fails when provider validation rejects the world", async () => {
  const result = await discoverValidatedWorld([{ id: "Bedrock level" }], async () => ({ valid: false }));
  assert.deepEqual(result, { discoveredWorldIds: ["Bedrock level"], world: "Bedrock level", worldDiscovered: false });
});

test("native BDS world discovery selects a validated world after an invalid world", async () => {
  const result = await discoverValidatedWorld([{ id: "invalid" }, { id: "Bedrock level" }], async (id) => ({ valid: id === "Bedrock level" }));
  assert.equal(result.worldDiscovered, true);
  assert.equal(result.world, "Bedrock level");
  assert.deepEqual(result.discoveredWorldIds, ["invalid", "Bedrock level"]);
});

test("native BDS harness rejects paths outside its managed integration root", () => {
  const root = path.join(tmpdir(), "jbgh021a-root");
  assert.equal(isInsideRoot(path.join(root, "runtime"), root), true);
  assert.equal(isInsideRoot(path.join(root, "..", "outside"), root), false);
});

test("native BDS harness requires a cleanup marker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jbgh021a-marker-"));
  const runtime = path.join(root, "runtime");
  await mkdir(runtime);
  await assert.rejects(() => assertDisposableRuntime(runtime, root, ".gamehub-acceptance-runtime"), { code: "BDS_ACCEPTANCE_MARKER_MISSING" });
  await writeFile(path.join(runtime, ".gamehub-acceptance-runtime"), "fixture");
  await assert.doesNotReject(() => assertDisposableRuntime(runtime, root, ".gamehub-acceptance-runtime"));
  await rm(root, { recursive: true, force: true });
});

test("native BDS harness uses deterministic non-production server properties and hashes XUID evidence", () => {
  const properties = deterministicServerProperties(19142);
  assert.match(properties, /^server-name=JB3 GameHub BDS Acceptance$/m);
  assert.match(properties, /^level-name=JBGH021AWorld$/m);
  assert.match(properties, /^server-port=19142$/m);
  assert.match(properties, /^server-portv6=0$/m);
  assert.notEqual(safeXuidReference("2533274790000001"), "2533274790000001");
  assert.match(safeXuidReference("2533274790000001"), /^[a-f0-9]{64}$/);
});

test("native BDS harness rejects an occupied UDP port before it mutates a runtime", async () => {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", () => resolve()));
  const address = socket.address();
  try {
    await assert.rejects(() => assertUdpPortAvailable("127.0.0.1", address.port), { code: "BDS_ACCEPTANCE_PORT_UNAVAILABLE" });
  } finally {
    socket.close();
  }
});
