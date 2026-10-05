import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { attachmentAcceptanceConfig } from "../integration/provisioning/scripts/attachment-acceptance-config";

test("attached runtime acceptance fails closed without explicit prerequisites", () => {
  assert.throws(() => attachmentAcceptanceConfig("java", {}), /confirmation/);
  const env = { JBGH_ATTACHMENT_ACCEPTANCE_CONFIRM: "START_STOP_EXISTING_TEST_RUNTIME", JBGH_ATTACHMENT_RUNTIME_ROOT: path.resolve("tests/tmp/source"), JBGH_ATTACHMENT_EVIDENCE_DIR: path.resolve("tests/tmp/evidence"), JBGH_ATTACHMENT_SERVER_ID: "acceptance", JBGH_ATTACHMENT_ARTIFACT: "bedrock_server.exe", JBGH_ATTACHMENT_GAME_PORT: "19140", JBGH_ATTACHMENT_IPV6_PORT: "19141" };
  assert.equal(attachmentAcceptanceConfig("bedrock", env).port, 19140);
  assert.throws(() => attachmentAcceptanceConfig("java", env), /JAVA_EXECUTABLE/);
  assert.throws(() => attachmentAcceptanceConfig("bedrock", { ...env, JBGH_ATTACHMENT_RUNTIME_ROOT: "relative" }), /absolute/);
  assert.throws(() => attachmentAcceptanceConfig("bedrock", { ...env, JBGH_ATTACHMENT_EVIDENCE_DIR: env.JBGH_ATTACHMENT_RUNTIME_ROOT }), /overlap/);
  assert.throws(() => attachmentAcceptanceConfig("bedrock", { ...env, JBGH_ATTACHMENT_IPV6_PORT: "" }), /explicit port/);
});
