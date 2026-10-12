import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertAcceptanceArtifactIntact } from "../integration/provisioning/scripts/attachment-acceptance-integrity";

const original = "#Mon Oct 12 22:33:46 BST 2026\n" +
  "enable-query=false\nenable-rcon=false\nlevel-name=jb3-integration-test-world\n" +
  "level-type=minecraft\\:normal\nserver-ip=127.0.0.1\nserver-port=25565\n";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const artifact = (bytes: Uint8Array) => ({ name: "configuration", relativePath: "server.properties", observedHash: hash(bytes) });
function check(after: string, before = original) {
  const baseline = Buffer.from(before);
  assertAcceptanceArtifactIntact("java", artifact(baseline), Buffer.from(after), baseline);
}

test("Java acceptance allows timestamp and comment-only rewrites", () => {
  check(original.replace("#Mon Oct 12 22:33:46 BST 2026", "#Mon Oct 12 23:16:49 BST 2026") + "!new comment\n");
});
test("Java acceptance allows blank-line-only changes", () => {
  check("\n  \n" + original.replaceAll("\n", "\n\n"));
});
test("Java acceptance compares property maps independent of order and line endings", () => {
  check(original.trimEnd().split("\n").reverse().join("\r\n") + "\r\n");
});
for (const key of ["enable-query", "enable-rcon", "level-name", "level-type", "server-ip", "server-port"]) {
  test("Java acceptance rejects an active value change: " + key, () => {
    check(original);
    assert.throws(() => check(original.replace(new RegExp("^" + key + "=.*$", "m"), key + "=changed")), /Source artifact changed/);
  });
}
test("Java acceptance rejects added active properties, including unrelated keys", () => {
  assert.throws(() => check(original + "motd=added\n"), /Source artifact changed/);
});
test("Java acceptance rejects removed active properties", () => {
  assert.throws(() => check(original.replace("server-ip=127.0.0.1\n", "")), /Source artifact changed/);
});
for (const line of ["malformed active content", "server-ip:127.0.0.1"]) {
  test("Java acceptance rejects malformed active content before or after lifecycle: " + line, () => {
    assert.throws(() => check(original + line + "\n"), /Malformed active/);
    assert.throws(() => check(original, original + line + "\n"), /Malformed active/);
  });
}
test("Java acceptance rejects duplicate keys even with identical values before or after lifecycle", () => {
  const duplicate = original + "server-port=25565\n";
  assert.throws(() => check(duplicate), /Duplicate active/);
  assert.throws(() => check(original, duplicate), /Duplicate active/);
});
test("Java acceptance preserves literal escape and whitespace values", () => {
  assert.throws(() => check(original.replace("minecraft\\:normal", "minecraft:normal")), /Source artifact changed/);
  assert.throws(() => check(original.replace("server-ip=127.0.0.1", "server-ip= 127.0.0.1")), /Source artifact changed/);
  assert.throws(() => check(original.replace("server-ip=127.0.0.1", "server-ip=127.0.0.1 ")), /Source artifact changed/);
});
test("Java acceptance requires a manifest-matching pre-start baseline", () => {
  const baseline = Buffer.from(original);
  const manifest = artifact(baseline);
  assert.throws(() => assertAcceptanceArtifactIntact("java", manifest, baseline), /Source artifact changed/);
  assert.throws(() => assertAcceptanceArtifactIntact("java", manifest, baseline, Buffer.from(original + "#drift\n")), /Source artifact changed/);
});
test("Java acceptance rejects invalid UTF-8 active content", () => {
  const baseline = Buffer.from(original);
  assert.throws(() => assertAcceptanceArtifactIntact("java", artifact(baseline), Buffer.concat([baseline, Buffer.from([0xff])]), baseline), /encoded data/);
});
for (const kind of ["java", "bedrock"] as const) {
  test(kind + " acceptance keeps ordinary artifacts byte-exact", () => {
    const baseline = Buffer.from("fixture runtime bytes");
    const manifest = { name: "runtime", relativePath: "runtime.bin", observedHash: hash(baseline) };
    assert.doesNotThrow(() => assertAcceptanceArtifactIntact(kind, manifest, baseline));
    assert.throws(() => assertAcceptanceArtifactIntact(kind, manifest, Buffer.from("changed runtime bytes"), baseline), /Source artifact changed/);
  });
}
test("Bedrock configuration stays byte-exact including comment-only changes", () => {
  const baseline = Buffer.from(original);
  assert.doesNotThrow(() => assertAcceptanceArtifactIntact("bedrock", artifact(baseline), baseline));
  assert.throws(() => assertAcceptanceArtifactIntact("bedrock", artifact(baseline), Buffer.from(original + "#comment\n"), baseline), /Source artifact changed/);
});
test("Java semantic exception applies only to the exact configuration manifest entry", () => {
  const baseline = Buffer.from(original);
  const after = Buffer.from(original + "#comment\n");
  for (const manifest of [
    { ...artifact(baseline), name: "runtime" },
    { ...artifact(baseline), relativePath: "other.properties" },
  ]) assert.throws(() => assertAcceptanceArtifactIntact("java", manifest, after, baseline), /Source artifact changed/);
});
