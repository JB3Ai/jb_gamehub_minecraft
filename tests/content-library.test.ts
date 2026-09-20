import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentLibraryScanner } from "../packages/content-library/scanner";
import { evaluateMinecraftCompatibility } from "../packages/content-library/minecraft-content-adapter";
import { buildStoredZip } from "./fixtures/content-library/build-zip";

async function makeTmpDir(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `jbgh020-${name}-`));
}

function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

test("classifies a Java world directory (level.dat present) as READY for minecraft-main", async () => {
  const dir = await makeTmpDir("java-world");
  await writeFile(path.join(dir, "level.dat"), Buffer.from([0x0a, 0x00]));
  await mkdir(path.join(dir, "region"));
  await writeFile(path.join(dir, "region", "r.0.0.mca"), Buffer.from("region-data"));

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [dir], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items.length, 1);
  const [item] = report.items;
  assert.equal(item.contentType, "java-world");
  assert.equal(item.hashScope, "directory-not-hashed");
  assert.equal(item.compatibility.status, "READY");

  await rm(dir, { recursive: true, force: true });
});

test("classifies a Bedrock .mcworld file as BLOCKED for minecraft-main and READY for bedrock-main", async () => {
  const dir = await makeTmpDir("bedrock-world");
  const worldZip = buildStoredZip([{ name: "level.dat", content: Buffer.from("bedrock-level") }]);
  const filePath = path.join(dir, "sample.mcworld");
  await writeFile(filePath, worldZip);

  const scanner = new ContentLibraryScanner();
  const javaTargetReport = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });
  const bedrockTargetReport = await scanner.scan({ paths: [filePath], target: { targetId: "bedrock-main", providerId: "minecraft-bedrock" } });

  assert.equal(javaTargetReport.items[0].contentType, "bedrock-world");
  assert.equal(javaTargetReport.items[0].compatibility.status, "BLOCKED");
  assert.ok(javaTargetReport.items[0].compatibility.issues.some((issue) => issue.code === "WORLD_EDITION_MISMATCH"));

  assert.equal(bedrockTargetReport.items[0].contentType, "bedrock-world");
  assert.equal(bedrockTargetReport.items[0].compatibility.status, "READY");

  await rm(dir, { recursive: true, force: true });
});

test("classifies a Paper plugin JAR with a descriptor as READY, and without one as WARNING", async () => {
  const dir = await makeTmpDir("plugins");
  const withDescriptor = buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample\nversion: 1.0\n") }]);
  const withoutDescriptor = buildStoredZip([{ name: "some/class/File.class", content: Buffer.from("not-a-descriptor") }]);
  const goodPath = path.join(dir, "good-plugin.jar");
  const badPath = path.join(dir, "no-descriptor-plugin.jar");
  await writeFile(goodPath, withDescriptor);
  await writeFile(badPath, withoutDescriptor);

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [goodPath, badPath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  const good = report.items.find((item) => item.sourcePath === path.resolve(goodPath))!;
  const bad = report.items.find((item) => item.sourcePath === path.resolve(badPath))!;

  assert.equal(good.contentType, "paper-plugin");
  assert.equal(good.compatibility.status, "READY");

  assert.equal(bad.contentType, "paper-plugin");
  assert.equal(bad.compatibility.status, "WARNING");
  assert.ok(bad.compatibility.issues.some((issue) => issue.code === "PLUGIN_DESCRIPTOR_NOT_FOUND"));

  await rm(dir, { recursive: true, force: true });
});

test("classifies a resource pack ZIP (pack.mcmeta) as READY for minecraft-main", async () => {
  const dir = await makeTmpDir("resource-pack");
  const zip = buildStoredZip([
    { name: "pack.mcmeta", content: Buffer.from('{"pack":{"pack_format":15,"description":"test"}}') },
    { name: "assets/minecraft/textures/block/stone.png", content: Buffer.from("fake-png-bytes") },
  ]);
  const filePath = path.join(dir, "texture-pack.zip");
  await writeFile(filePath, zip);

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].contentType, "resource-pack");
  assert.equal(report.items[0].compatibility.status, "READY");

  await rm(dir, { recursive: true, force: true });
});

test("classifies a Bedrock behavior pack (manifest.json, data module) and blocks it on minecraft-main", async () => {
  const dir = await makeTmpDir("behavior-pack");
  const manifest = JSON.stringify({ format_version: 2, header: { uuid: "abc" }, modules: [{ type: "data" }] });
  const zip = buildStoredZip([{ name: "manifest.json", content: Buffer.from(manifest) }]);
  const filePath = path.join(dir, "sample.mcpack");
  await writeFile(filePath, zip);

  const scanner = new ContentLibraryScanner();
  const javaReport = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });
  const bedrockReport = await scanner.scan({ paths: [filePath], target: { targetId: "bedrock-main", providerId: "minecraft-bedrock" } });

  assert.equal(javaReport.items[0].contentType, "behavior-pack");
  assert.equal(javaReport.items[0].compatibility.status, "BLOCKED");
  assert.ok(javaReport.items[0].compatibility.issues.some((issue) => issue.code === "PROVIDER_TYPE_MISMATCH"));

  assert.equal(bedrockReport.items[0].contentType, "behavior-pack");
  assert.equal(bedrockReport.items[0].compatibility.status, "READY");

  await rm(dir, { recursive: true, force: true });
});

test("classifies a skin PNG as WARNING (format unverified) rather than a false READY", async () => {
  const dir = await makeTmpDir("skin");
  const filePath = path.join(dir, "skin.png");
  await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].contentType, "skin");
  assert.equal(report.items[0].compatibility.status, "WARNING");

  await rm(dir, { recursive: true, force: true });
});

test("classifies an unrelated file as unknown/UNKNOWN rather than guessing", async () => {
  const dir = await makeTmpDir("unknown");
  const filePath = path.join(dir, "notes.txt");
  await writeFile(filePath, "just some notes, not game content");

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].contentType, "unknown");
  assert.equal(report.items[0].compatibility.status, "UNKNOWN");

  await rm(dir, { recursive: true, force: true });
});

test("rejects a malformed ZIP safely (UNKNOWN, not a crash, not a success-shaped fallback)", async () => {
  const dir = await makeTmpDir("malformed");
  const filePath = path.join(dir, "broken.zip");
  await writeFile(filePath, Buffer.from("this is not a zip file at all, just garbage bytes"));

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].contentType, "unknown");
  assert.equal(report.items[0].compatibility.status, "UNKNOWN");
  assert.ok(report.items[0].warnings.includes("ARCHIVE_MALFORMED"));

  await rm(dir, { recursive: true, force: true });
});

test("handles a RAR archive safely as WARNING (unsupported format), not a crash", async () => {
  const dir = await makeTmpDir("rar");
  const filePath = path.join(dir, "world.rar");
  await writeFile(filePath, Buffer.from("fake rar bytes"));

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].compatibility.status, "WARNING");
  assert.ok(report.items[0].warnings.includes("RAR_FORMAT_UNSUPPORTED"));

  await rm(dir, { recursive: true, force: true });
});

test("reports an empty placeholder directory honestly as WARNING (EMPTY_SOURCE_DIRECTORY)", async () => {
  const dir = await makeTmpDir("empty-world-placeholder");

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [dir], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].compatibility.status, "WARNING");
  assert.ok(report.items[0].warnings.includes("EMPTY_SOURCE_DIRECTORY"));

  await rm(dir, { recursive: true, force: true });
});

test("reports a missing source path as BLOCKED (SOURCE_NOT_FOUND) rather than throwing", async () => {
  const missingPath = path.join(tmpdir(), "jbgh020-does-not-exist", "nowhere.zip");

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [missingPath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].compatibility.status, "BLOCKED");
  assert.ok(report.items[0].compatibility.issues.some((issue) => issue.code === "SOURCE_NOT_FOUND"));
});

test("never mutates source bytes: file hash is identical before and after scanning", async () => {
  const dir = await makeTmpDir("integrity");
  const filePath = path.join(dir, "port-spawn.zip");
  const zip = buildStoredZip([{ name: "level.dat", content: Buffer.from("java-world-data") }]);
  await writeFile(filePath, zip);

  const before = sha256Of(await readFile(filePath));
  const scanner = new ContentLibraryScanner();
  await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });
  const after = sha256Of(await readFile(filePath));

  assert.equal(before, after);

  await rm(dir, { recursive: true, force: true });
});

test("scanner is deterministic across repeated runs on the same source", async () => {
  const dir = await makeTmpDir("determinism");
  const filePath = path.join(dir, "sample.jar");
  await writeFile(filePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample") }]));

  const scanner = new ContentLibraryScanner();
  const first = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });
  const second = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(first.items[0].contentType, second.items[0].contentType);
  assert.equal(first.items[0].sha256, second.items[0].sha256);
  assert.equal(first.items[0].compatibility.status, second.items[0].compatibility.status);
  assert.deepEqual(first.items[0].warnings, second.items[0].warnings);

  await rm(dir, { recursive: true, force: true });
});

test("correlates results back to stable acceptance-manifest IDs and matches manifest hashes", async () => {
  const dir = await makeTmpDir("manifest-correlation");
  const filePath = path.join(dir, "medieval-house.zip");
  const zip = buildStoredZip([{ name: "level.dat", content: Buffer.from("java-world") }]);
  await writeFile(filePath, zip);

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({
    paths: [filePath],
    target: { targetId: "minecraft-main", providerId: "minecraft" },
    manifestIdsByPath: { [filePath]: "JBGH-020-CONTENT-006" },
  });

  assert.equal(report.items[0].sourceManifestId, "JBGH-020-CONTENT-006");
  assert.equal(report.items[0].sha256, sha256Of(zip));
});

test("hashes larger files with bounded-memory streaming and a correct digest", async () => {
  const dir = await makeTmpDir("large-file");
  const filePath = path.join(dir, "large-world.zip");
  const chunk = Buffer.alloc(1024 * 1024, 7); // 1 MiB of repeated byte
  const largeContent = Buffer.concat(new Array(6).fill(chunk)); // ~6 MiB
  const zip = buildStoredZip([{ name: "level.dat", content: largeContent }]);
  await writeFile(filePath, zip);

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  assert.equal(report.items[0].sha256, sha256Of(zip));
  assert.equal(report.items[0].contentType, "java-world");

  await rm(dir, { recursive: true, force: true });
});

test("emits the required scan lifecycle events", async () => {
  const dir = await makeTmpDir("events");
  const filePath = path.join(dir, "notes.txt");
  await writeFile(filePath, "hello");

  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({ paths: [filePath], target: { targetId: "minecraft-main", providerId: "minecraft" } });

  const types = report.events.map((event) => event.type);
  assert.equal(types[0], "content.scan.started");
  assert.equal(types[types.length - 1], "content.scan.completed");
  for (const required of ["content.item.detected", "content.item.classified", "content.validation.completed"]) {
    assert.ok(types.includes(required as typeof types[number]), `missing event type ${required}`);
  }

  await rm(dir, { recursive: true, force: true });
});

test("minecraft compatibility adapter never silently improves a status (READY cannot mask a blocking issue)", () => {
  const result = evaluateMinecraftCompatibility({
    contentType: "bedrock-world",
    targetId: "minecraft-main",
    sourceKind: "file",
    sizeBytes: 10,
    classificationWarnings: [],
  });
  assert.equal(result.status, "BLOCKED");
});
