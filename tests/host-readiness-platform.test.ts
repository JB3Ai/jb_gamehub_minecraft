import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { observeStorage, observeDatabase, parseWindowsObservation, WINDOWS_READINESS_SCRIPT } from "../packages/host-platform/readiness";
import { discoverJavaRuntimes, javaPrerequisites, parseJavaVersion, probeJavaVersion } from "../packages/minecraft-provider/host-readiness";
import { bedrockPrerequisites } from "../packages/bedrock-provider/host-readiness";
import { managedFixture } from "./helpers/managed-create-fixture";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";

async function directory(t: import("node:test").TestContext) {
  await fs.mkdir("tests/tmp", { recursive: true }); const base = await fs.mkdtemp(path.resolve("tests/tmp/host-readiness-"));
  t.after(() => fs.rm(base, { recursive: true, force: true })); return base;
}
test("storage inspects existing/missing roots without creating files or directories", async t => {
  const base = await directory(t); await fs.writeFile(path.join(base, "preserved.txt"), "unchanged");
  assert.equal((await observeStorage(base)).exists, true);
  const missing = await observeStorage(path.join(base, "future", "managed")); assert.equal(missing.exists, false); assert.ok(missing.availableBytes >= 0n);
  assert.deepEqual(await fs.readdir(base), ["preserved.txt"]); assert.equal(await fs.readFile(path.join(base, "preserved.txt"), "utf8"), "unchanged");
  await assert.rejects(observeStorage("relative/path"), /STORAGE_PATH_UNSAFE/);
  await assert.rejects(observeStorage(path.join(base, "preserved.txt")), /STORAGE_NOT_DIRECTORY/);
  await assert.rejects(observeStorage("\\\\host\\share\\managed"), /STORAGE_PATH_UNSAFE/);
  const link = path.join(base, "linked"); await fs.symlink(base, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(observeStorage(link), /STORAGE_PATH_UNSAFE/);
});
test("Windows probe parses capabilities and fails closed for malformed output", () => {
  const observed = parseWindowsObservation(JSON.stringify({ elevated: false, nativeX64: true, capabilities: true, complete: true, bindings: [] }));
  assert.equal(observed.elevated, false); assert.equal(observed.inventory.complete, true);
  assert.throws(() => parseWindowsObservation("not json")); assert.throws(() => parseWindowsObservation('{"complete":true}'));
  assert.match(WINDOWS_READINESS_SCRIPT, /Get-NetTCPConnection/); assert.match(WINDOWS_READINESS_SCRIPT, /Get-NetUDPEndpoint/);
});

for (const version of ["21.0.9", "17.0.14", "25.0.1", "1.8.0_482", "unknown"] as const) test(`Java version discovery ${version} is injectable and does not enforce one global major`, async t => {
  const base = await directory(t), bin = path.join(base, "bin"); await fs.mkdir(bin);
  const java = path.join(bin, process.platform === "win32" ? "java.exe" : "java");
  // The injected version probe keeps deterministic tests independent of installed Java.
  await fs.writeFile(java, "this fixture must never execute");
  if (version !== "unknown") await fs.writeFile(path.join(base, "release"), `JAVA_VERSION="${version}"\nOS_ARCH="amd64"\n`);
  let calls = 0;
  const before = await fs.readdir(base), result = await discoverJavaRuntimes({ approvedLocations: [java], env: { JAVA_HOME: base, PATH: bin }, versionProbe: async executable => { calls++; assert.equal(executable, java); return { stdout: "", stderr: version === "unknown" ? "C:/private path and token" : `openjdk version "${version}" 2026-10-20\nOpenJDK 64-Bit Server VM` }; } });
  assert.equal(calls, 1); assert.equal(result.length, 1); assert.equal(result[0].status, version === "unknown" ? "WARNING" : "PASS"); assert.equal(result[0].facts?.serverLaunched, false); assert.equal(result[0].facts?.approvedRuntimeValidated, false);
  assert.equal(result[0].code, version === "unknown" ? "JAVA_VERSION_UNAVAILABLE" : "JAVA_VERSION_DISCOVERED");
  if (version !== "unknown") assert.equal(result[0].facts?.version, version);
  assert.ok(!JSON.stringify(result).includes("private path"));
  assert.ok(!JSON.stringify(result).includes(base)); assert.deepEqual(await fs.readdir(base), before);
});
test("Java missing and symlink candidates cannot pass readiness", async t => {
  assert.equal((await discoverJavaRuntimes({ approvedLocations: [], env: {} }))[0].code, "JAVA_NOT_DISCOVERED");
  const base = await directory(t), file = path.join(base, "java.exe"); await fs.writeFile(file, "fixture");
  const link = path.join(base, "linked"); await fs.symlink(base, link, process.platform === "win32" ? "junction" : "dir");
  const results = await discoverJavaRuntimes({ approvedLocations: [path.join(base, "missing.exe"), link], env: {} });
  assert.equal(results[0].code, "JAVA_CONFIGURED_CANDIDATE_MISSING"); assert.equal(results[1].code, "JAVA_CANDIDATE_UNSAFE");
});
test("duplicate, oversized and malformed Java version output remains unverified without leaking diagnostics", async t => {
  const base = await directory(t), bin = path.join(base, "bin"); await fs.mkdir(bin);
  const java = path.join(bin, "java.exe"); await fs.writeFile(java, "fixture");
  for (const output of ['openjdk version "21.0.9"\njava version "17.0.1"\n', "x".repeat(32769), 'openjdk version "21-C:/secret"']) {
    assert.equal(parseJavaVersion(output), undefined);
    assert.equal((await discoverJavaRuntimes({ approvedLocations: [java], env: {}, versionProbe: async () => ({ stdout: output, stderr: "" }) }))[0].code, "JAVA_VERSION_UNAVAILABLE");
  }
  const failed = await discoverJavaRuntimes({ approvedLocations: [java], env: {}, versionProbe: async () => { throw new Error("secret executable path"); } });
  assert.ok(!JSON.stringify(failed).includes("secret"));
  await assert.rejects(probeJavaVersion(path.join(base, "missing.exe")), /JAVA_VERSION_PROBE_FAILED/);
});

test("Java stdout version discovery is sanitized and does not claim profile approval", async t => {
  const base = await directory(t), java = path.join(base, "java.exe"); await fs.writeFile(java, "fixture; never execute");
  const result = await discoverJavaRuntimes({ approvedLocations: [java], env: {}, versionProbe: async () => ({ stdout: 'java version "25.0.4"\n', stderr: 'private ignored diagnostic and C:/location' }) });
  assert.equal(result[0].status, "PASS"); assert.equal(result[0].facts?.major, 25); assert.equal(result[0].facts?.approvedRuntimeValidated, false);
  assert.ok(!JSON.stringify(result).includes("private")); assert.ok(!JSON.stringify(result).includes("C:/location"));
});
test("database inspection reads only a header and never creates a database, parent or SQLite sidecars", async t => {
  const base = await directory(t), file = path.join(base, "state.sqlite");
  assert.equal((await observeDatabase(file)).exists, false); assert.deepEqual(await fs.readdir(base), []);
  await fs.writeFile(file, "SQLite format 3\u0000unchanged fixture"); const before = await fs.readFile(file);
  const observation = await observeDatabase(file); assert.equal(observation.formatValid, true); assert.deepEqual(await fs.readFile(file), before); assert.deepEqual(await fs.readdir(base), ["state.sqlite"]);
  await fs.writeFile(file, "not a database"); assert.equal((await observeDatabase(file)).formatValid, false);
});
test("provider source prerequisites and selected-provider missing Java fail safely without executing anything", async t => {
  const java = await managedFixture(t), bedrock = await managedBedrockFixture(t);
  assert.equal((await javaPrerequisites(java.policy, true)).status, "PASS"); assert.equal((await bedrockPrerequisites(bedrock.policy, true)).status, "PASS");
  await fs.rename(java.source, java.source + ".hidden"); assert.equal((await javaPrerequisites(java.policy, true)).status, "BLOCKED");
  await fs.rename(path.join(bedrock.source, "bedrock_server.exe"), path.join(bedrock.source, "missing.exe")); assert.equal((await bedrockPrerequisites(bedrock.policy, true)).status, "BLOCKED");
  assert.equal((await bedrockPrerequisites(undefined, false)).status, "WARNING"); assert.equal((await bedrockPrerequisites(undefined, true)).status, "BLOCKED");
  const missing = await discoverJavaRuntimes({ approvedLocations: [], env: {}, selected: true }); assert.ok(missing.some(check => check.status === "BLOCKED"));
});
