import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentLibraryScanner } from "../packages/content-library/scanner";
import { BedrockContentImportAdapter } from "../packages/minecraft-provider/bedrock-content-import";
import { buildStoredZip } from "./fixtures/content-library/build-zip";

const WORLD_UUID = "1c3e8cf8-83f5-4d7e-9f11-2bd9339a2e10";
const MODULE_UUID = "a32fa729-a57e-4e72-b00c-77444fdc0a20";

async function root(name: string) {
  return mkdtemp(path.join(tmpdir(), `jbgh020d-${name}-`));
}

function pack(
  type: "resources" | "data",
  version: [number, number, number] = [1, 0, 0],
  dependencies?: Array<{ uuid: string; version: [number, number, number] }>,
): Buffer {
  return buildStoredZip([
    {
      name: "manifest.json",
      content: Buffer.from(JSON.stringify({
        format_version: 2,
        header: { name: "Fixture Pack", uuid: WORLD_UUID, version },
        modules: [{ type, uuid: MODULE_UUID, version }],
        dependencies,
      })),
    },
    { name: type === "resources" ? "textures/test.png" : "functions/test.mcfunction", content: Buffer.from("fixture") },
  ]);
}

async function scan(sourcePath: string) {
  const scanner = new ContentLibraryScanner();
  return (await scanner.scan({ paths: [sourcePath], target: { targetId: "bedrock-main", providerId: "bedrock" } })).items[0];
}

test("imports a staged Bedrock world without source mutation", async () => {
  const folder = await root("world");
  const source = path.join(folder, "city.mcworld");
  const bytes = buildStoredZip([
    { name: "level.dat", content: Buffer.from("level") },
    { name: "levelname.txt", content: Buffer.from("City") },
    { name: "db/000001.log", content: Buffer.from("db") },
  ]);
  await writeFile(source, bytes);
  const item = await scan(source);
  const adapter = new BedrockContentImportAdapter({ serverDir: path.join(folder, "managed") });
  const plan = await adapter.createPlan({ item, providerId: "minecraft-bedrock", serverId: "bedrock-main" });
  const result = await adapter.execute(plan, { item, providerId: "minecraft-bedrock", serverId: "bedrock-main" }, true);

  assert.equal(item.contentType, "bedrock-world");
  assert.equal(plan.status, "planned");
  assert.equal(result.status, "completed");
  assert.equal((await readFile(source)).equals(bytes), true);
  assert.equal(await stat(path.join(plan.destinationPath, "level.dat")).then((value) => value.isFile()), true);
  await assert.rejects(stat(plan.stagingPath));
  await rm(folder, { recursive: true, force: true });
});

test("installs a Bedrock pack and atomically links it only to a managed world", async () => {
  const folder = await root("pack");
  const worldSource = path.join(folder, "city.mcworld");
  const packSource = path.join(folder, "textures.mcpack");
  await writeFile(worldSource, buildStoredZip([
    { name: "level.dat", content: Buffer.from("level") },
    { name: "db/000001.log", content: Buffer.from("db") },
  ]));
  await writeFile(packSource, pack("resources"));
  const adapter = new BedrockContentImportAdapter({ serverDir: path.join(folder, "managed") });
  const world = await scan(worldSource);
  const worldPlan = await adapter.createPlan({ item: world, providerId: "minecraft-bedrock" });
  assert.equal((await adapter.execute(worldPlan, { item: world, providerId: "minecraft-bedrock" }, true)).status, "completed");

  const item = await scan(packSource);
  const plan = await adapter.createPlan({ item, providerId: "minecraft-bedrock", worldId: "city" });
  const result = await adapter.execute(plan, { item, providerId: "minecraft-bedrock", worldId: "city" }, true);
  assert.equal(plan.status, "planned");
  assert.equal(result.status, "completed");
  assert.equal(await stat(path.join(plan.destinationPath, "manifest.json")).then((value) => value.isFile()), true);
  const linkage = JSON.parse(await readFile(path.join(folder, "managed", "worlds", "city", "world_resource_packs.json"), "utf8"));
  assert.deepEqual(linkage, [{ pack_id: WORLD_UUID, version: [1, 0, 0] }]);
  await assert.rejects(stat(plan.stagingPath));
  await rm(folder, { recursive: true, force: true });
});

test("blocks a Bedrock pack without a managed world and preserves the source", async () => {
  const folder = await root("missing-world");
  const source = path.join(folder, "behavior.mcpack");
  const bytes = pack("data");
  await writeFile(source, bytes);
  const item = await scan(source);
  const adapter = new BedrockContentImportAdapter({ serverDir: path.join(folder, "managed") });
  const plan = await adapter.createPlan({ item, providerId: "minecraft-bedrock", worldId: "missing" });
  const result = await adapter.execute(plan, { item, providerId: "minecraft-bedrock", worldId: "missing" }, true);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.error?.code, "BEDROCK_TARGET_WORLD_NOT_FOUND");
  assert.equal((await readFile(source)).equals(bytes), true);
  await assert.rejects(stat(plan.destinationPath));
  await rm(folder, { recursive: true, force: true });
});

test("blocks a Bedrock pack with an unresolved manifest dependency before staging", async () => {
  const folder = await root("missing-dependency");
  const source = path.join(folder, "dependent.mcpack");
  await writeFile(source, pack("resources", [1, 0, 0], [{ uuid: "bc671c7e-08be-4a61-921b-9f2bbde14e30", version: [1, 0, 0] }]));
  const item = await scan(source);
  const adapter = new BedrockContentImportAdapter({ serverDir: path.join(folder, "managed") });
  const plan = await adapter.createPlan({ item, providerId: "minecraft-bedrock", worldId: "city" });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockingIssues.some((entry) => entry.code === "BEDROCK_PACK_DEPENDENCY_MISSING"));
  await rm(folder, { recursive: true, force: true });
});
