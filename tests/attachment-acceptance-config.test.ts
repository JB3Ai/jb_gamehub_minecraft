import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { attachmentAcceptanceConfig, attachmentAcceptanceEndpoint } from "../integration/provisioning/scripts/attachment-acceptance-config";

test("attached runtime acceptance fails closed without explicit prerequisites", () => {
  assert.throws(() => attachmentAcceptanceConfig("java", {}), /confirmation/);
  const env = { JBGH_ATTACHMENT_ACCEPTANCE_CONFIRM: "START_STOP_EXISTING_TEST_RUNTIME", JBGH_ATTACHMENT_RUNTIME_ROOT: path.resolve("tests/tmp/source"), JBGH_ATTACHMENT_EVIDENCE_DIR: path.resolve("tests/tmp/evidence"), JBGH_ATTACHMENT_SERVER_ID: "acceptance", JBGH_ATTACHMENT_ARTIFACT: "bedrock_server.exe", JBGH_ATTACHMENT_GAME_PORT: "19140", JBGH_ATTACHMENT_IPV6_PORT: "19141" };
  assert.equal(attachmentAcceptanceConfig("bedrock", env).port, 19140);
  assert.throws(() => attachmentAcceptanceConfig("java", env), /JAVA_EXECUTABLE/);
  assert.throws(() => attachmentAcceptanceConfig("bedrock", { ...env, JBGH_ATTACHMENT_RUNTIME_ROOT: "relative" }), /absolute/);
  assert.throws(() => attachmentAcceptanceConfig("bedrock", { ...env, JBGH_ATTACHMENT_EVIDENCE_DIR: env.JBGH_ATTACHMENT_RUNTIME_ROOT }), /overlap/);
  assert.throws(() => attachmentAcceptanceConfig("bedrock", { ...env, JBGH_ATTACHMENT_IPV6_PORT: "" }), /explicit port/);
});

test("Java acceptance uses the explicit runtime bind address and matching port", async () => {
  assert.deepEqual(await attachmentAcceptanceEndpoint({ kind: "java", port: 25565 }, async () =>
    "server-ip=127.0.0.1\nserver-port=25565\nlevel-type=minecraft\\:normal\n"),
  { port: 25565, bindAddress: "127.0.0.1" });
});
for (const address of ["", "server-ip=\n", "server-ip=   \n"]) {
  test("Java acceptance defaults blank or missing server-ip to wildcard: " + JSON.stringify(address), async () => {
    assert.deepEqual(await attachmentAcceptanceEndpoint({ kind: "java", port: 25565 }, async () => address + "server-port=25565\n"),
      { port: 25565, bindAddress: "0.0.0.0" });
  });
}
test("Java acceptance preserves explicit IPv6 and last configured endpoint values", async () => {
  assert.deepEqual(await attachmentAcceptanceEndpoint({ kind: "java", port: 25565 }, async () =>
    "# ignored\nserver-ip=0.0.0.0\nserver-port=25566\nserver-ip= ::1 \nserver-port=25565\n"),
  { port: 25565, bindAddress: "::1" });
});
for (const properties of ["server-port=25566\n", "", "server-port=invalid\n", "server-port=25565.0\n"]) {
  test("Java acceptance rejects missing, invalid or mismatched port: " + JSON.stringify(properties), async () => {
    await assert.rejects(attachmentAcceptanceEndpoint({ kind: "java", port: 25565 }, async () => properties),
      /server-port must equal JBGH_ATTACHMENT_GAME_PORT/);
  });
}
for (const properties of ["server-port=25565\nmalformed\n", "server-port=25565\nserver-ip=127\\.0.0.1\n", "server-port=2556\\5\n"]) {
  test("Java acceptance rejects unsupported endpoint syntax: " + JSON.stringify(properties), async () => {
    await assert.rejects(attachmentAcceptanceEndpoint({ kind: "java", port: 25565 }, async () => properties),
      /explicit key=value|unescaped endpoint/);
  });
}
test("Bedrock acceptance keeps its wildcard endpoint without reading Java properties", async () => {
  assert.deepEqual(await attachmentAcceptanceEndpoint({ kind: "bedrock", port: 19140 }, async () => {
    assert.fail("Bedrock must not read Java server.properties");
  }), { port: 19140, bindAddress: "0.0.0.0" });
});
