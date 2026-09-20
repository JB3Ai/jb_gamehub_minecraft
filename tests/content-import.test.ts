import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentImportExecutor } from "../packages/content-library/importer";
import { ContentLibraryScanner } from "../packages/content-library/scanner";
import { MinecraftContentImportAdapter } from "../packages/minecraft-provider/content-import";
import { buildStoredZip } from "./fixtures/content-library/build-zip";

async function makeRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `jbgh020b-${name}-`));
}

function importerFor(root: string): ContentImportExecutor {
  return new ContentImportExecutor({
    stagingRoot: path.join(root, "staging"),
    managedWorldsRoot: path.join(root, "managed", "worlds"),
    managedPluginsRoot: path.join(root, "managed", "plugins"),
    managedResourcePacksRoot: path.join(root, "managed", "resource-packs"),
    auditLogPath: path.join(root, "audit", "content-import.jsonl"),
  });
}

async function scanFile(filePath: string) {
  const scanner = new ContentLibraryScanner();
  const report = await scanner.scan({
    paths: [filePath],
    target: { targetId: "minecraft-main", providerId: "minecraft" },
  });
  return report.items[0];
}

test("imports a Java world ZIP through staging, preserves source bytes, and creates an append-only audit trail", async () => {
  const root = await makeRoot("world-success");
  const sourcePath = path.join(root, "source-world.zip");
  const source = buildStoredZip([
    { name: "ImportedWorld/level.dat", content: Buffer.from("level-data") },
    { name: "ImportedWorld/region/r.0.0.mca", content: Buffer.from("region-data") },
  ]);
  await writeFile(sourcePath, source);
  const sourceBefore = await readFile(sourcePath);
  const item = await scanFile(sourcePath);
  const importer = importerFor(root);
  const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft", serverId: "minecraft-main" });

  assert.equal(plan.status, "planned");
  assert.equal(plan.requiresApproval, true);
  assert.match(plan.stagingPath, /staging/);

  const result = await importer.execute(plan, item, true);
  assert.equal(result.status, "completed");
  assert.equal(await readFile(sourcePath).then((value) => value.equals(sourceBefore)), true);
  assert.equal(await stat(path.join(plan.destinationPath, "level.dat")).then((value) => value.isFile()), true);
  await assert.rejects(stat(plan.stagingPath));

  const auditLines = (await readFile(path.join(root, "audit", "content-import.jsonl"), "utf8")).trim().split("\n");
  assert.ok(auditLines.length >= 5);
  assert.ok(auditLines.some((line) => line.includes("\"content.import.installed\"")));

  await rm(root, { recursive: true, force: true });
});

test("imports a validated Paper plugin JAR without modifying the source JAR", async () => {
  const root = await makeRoot("plugin-success");
  const sourcePath = path.join(root, "sample.jar");
  await writeFile(sourcePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample\nversion: 1.0\n") }]));
  const sourceBefore = await readFile(sourcePath);
  const item = await scanFile(sourcePath);
  const importer = importerFor(root);
  const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft" });
  const result = await importer.execute(plan, item, true);

  assert.equal(result.status, "completed");
  assert.equal(await readFile(plan.destinationPath).then((value) => value.equals(sourceBefore)), true);
  assert.equal(await readFile(sourcePath).then((value) => value.equals(sourceBefore)), true);

  await rm(root, { recursive: true, force: true });
});

test("imports resource packs and datapacks only into their respective managed destinations", async () => {
  const root = await makeRoot("packs");
  const resourcePath = path.join(root, "resource.zip");
  const datapackPath = path.join(root, "datapack.zip");
  await writeFile(resourcePath, buildStoredZip([
    { name: "pack.mcmeta", content: Buffer.from('{"pack":{"pack_format":15,"description":"resource"}}') },
    { name: "assets/minecraft/textures/block/stone.png", content: Buffer.from("texture") },
  ]));
  await writeFile(datapackPath, buildStoredZip([
    { name: "pack.mcmeta", content: Buffer.from('{"pack":{"pack_format":15,"description":"data"}}') },
    { name: "data/minecraft/tags/functions/load.json", content: Buffer.from("{}") },
  ]));

  const importer = importerFor(root);
  const resource = await scanFile(resourcePath);
  const resourcePlan = importer.getPlanner().createPlan({ item: resource, providerId: "minecraft" });
  const resourceResult = await importer.execute(resourcePlan, resource, true);
  assert.equal(resource.contentType, "resource-pack");
  assert.equal(resourceResult.status, "completed");
  assert.equal(await stat(resourcePlan.destinationPath).then((value) => value.isFile()), true);

  const datapack = await scanFile(datapackPath);
  const datapackPlan = importer.getPlanner().createPlan({ item: datapack, providerId: "minecraft", worldId: "managed-world" });
  const datapackResult = await importer.execute(datapackPlan, datapack, true);
  assert.equal(datapack.contentType, "datapack");
  assert.equal(datapackResult.status, "completed");
  assert.match(datapackPlan.destinationPath, /managed-world/);
  assert.equal(await stat(datapackPlan.destinationPath).then((value) => value.isFile()), true);

  const noTargetPlan = importer.getPlanner().createPlan({ item: datapack, providerId: "minecraft" });
  assert.equal(noTargetPlan.status, "blocked");
  assert.ok(noTargetPlan.blockingIssues.some((entry) => entry.code === "DATAPACK_TARGET_WORLD_REQUIRED"));

  await rm(root, { recursive: true, force: true });
});

test("does not execute a plan unless an explicit approval is supplied", async () => {
  const root = await makeRoot("approval");
  const sourcePath = path.join(root, "sample.jar");
  await writeFile(sourcePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample") }]));
  const item = await scanFile(sourcePath);
  const importer = importerFor(root);
  const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft" });
  const result = await importer.execute(plan, item, false);

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "APPROVAL_REQUIRED");
  await assert.rejects(stat(plan.destinationPath));

  await rm(root, { recursive: true, force: true });
});

test("blocks zip-slip archives before extraction and leaves no source, staging, or destination mutation", async () => {
  const root = await makeRoot("zip-slip");
  const sourcePath = path.join(root, "unsafe-world.zip");
  await writeFile(
    sourcePath,
    buildStoredZip([
      { name: "World/level.dat", content: Buffer.from("level") },
      { name: "../../server.properties", content: Buffer.from("unsafe") },
    ]),
  );
  const sourceBefore = await readFile(sourcePath);
  const item = await scanFile(sourcePath);
  const importer = importerFor(root);
  const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft" });
  const result = await importer.execute(plan, item, true);

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "ARCHIVE_PATH_UNSAFE");
  assert.equal(await readFile(sourcePath).then((value) => value.equals(sourceBefore)), true);
  await assert.rejects(stat(plan.destinationPath));
  await assert.rejects(stat(path.join(root, "server.properties")));
  await assert.rejects(stat(plan.stagingPath));

  await rm(root, { recursive: true, force: true });
});

test("blocks malformed archives, RAR, unknown content, and unsupported provider types during planning", async () => {
  const root = await makeRoot("blocked");
  const malformedPath = path.join(root, "broken.zip");
  const rarPath = path.join(root, "world.rar");
  const unknownPath = path.join(root, "notes.txt");
  await writeFile(malformedPath, "not a zip");
  await writeFile(rarPath, "not a rar");
  await writeFile(unknownPath, "unrelated content");
  const importer = importerFor(root);

  for (const sourcePath of [malformedPath, rarPath, unknownPath]) {
    const item = await scanFile(sourcePath);
    const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft" });
    assert.equal(plan.status, "blocked");
    const result = await importer.execute(plan, item, true);
    assert.equal(result.status, "blocked");
  }

  const pluginPath = path.join(root, "plugin.jar");
  await writeFile(pluginPath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample") }]));
  const plugin = await scanFile(pluginPath);
  const wrongProviderPlan = importer.getPlanner().createPlan({ item: plugin, providerId: "synthetic" });
  assert.equal(wrongProviderPlan.status, "blocked");
  assert.ok(wrongProviderPlan.blockingIssues.some((entry) => entry.code === "PROVIDER_IMPORT_UNSUPPORTED"));

  await rm(root, { recursive: true, force: true });
});

test("blocks collisions instead of overwriting existing managed content", async () => {
  const root = await makeRoot("collision");
  const sourcePath = path.join(root, "sample.jar");
  await writeFile(sourcePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample") }]));
  const item = await scanFile(sourcePath);
  const importer = importerFor(root);
  const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft" });
  await mkdir(path.dirname(plan.destinationPath), { recursive: true });
  await writeFile(plan.destinationPath, "existing plugin must survive");

  const result = await importer.execute(plan, item, true);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "DESTINATION_COLLISION");
  assert.equal(await readFile(plan.destinationPath, "utf8"), "existing plugin must survive");

  await rm(root, { recursive: true, force: true });
});

test("blocks a source that changes after scan rather than importing unchecked bytes", async () => {
  const root = await makeRoot("hash-mismatch");
  const sourcePath = path.join(root, "sample.jar");
  await writeFile(sourcePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample") }]));
  const item = await scanFile(sourcePath);
  const importer = importerFor(root);
  const plan = importer.getPlanner().createPlan({ item, providerId: "minecraft" });
  await writeFile(sourcePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Modified") }]));

  const result = await importer.execute(plan, item, true);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "SOURCE_HASH_MISMATCH");
  await assert.rejects(stat(plan.destinationPath));

  await rm(root, { recursive: true, force: true });
});

test("Minecraft import adapter owns managed destination layout while core plan remains provider-neutral", async () => {
  const root = await makeRoot("minecraft-adapter");
  const sourcePath = path.join(root, "sample.jar");
  await writeFile(sourcePath, buildStoredZip([{ name: "plugin.yml", content: Buffer.from("name: Sample") }]));
  const item = await scanFile(sourcePath);
  const adapter = new MinecraftContentImportAdapter({ serverDir: path.join(root, "paper-server") });
  const plan = adapter.createPlan({ item, providerId: "minecraft", serverId: "minecraft-main" });

  assert.equal(plan.status, "planned");
  assert.equal(
    plan.destinationPath,
    path.join(root, "paper-server", "plugins", "sample.jar"),
  );

  const result = await adapter.execute(plan, { item, providerId: "minecraft", serverId: "minecraft-main" }, true);
  assert.equal(result.status, "completed");
  assert.equal(await stat(plan.destinationPath).then((value) => value.isFile()), true);

  await rm(root, { recursive: true, force: true });
});
