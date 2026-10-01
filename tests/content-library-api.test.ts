import test from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../server";
import { buildStoredZip } from "./fixtures/content-library/build-zip";

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function createRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `jbgh020c-${name}-`));
}

test("Content Library API scans configured sources, previews a backend-owned plan, approves import, and persists inventory/history", async () => {
  process.env.NODE_ENV = "production";
  const root = await createRoot("api");
  const corpus = path.join(root, "corpus");
  const serverDir = path.join(root, "paper");
  const dbPath = path.join(root, "gamehub.sqlite");
  await mkdir(corpus, { recursive: true });
  await mkdir(path.join(serverDir, "worlds"), { recursive: true });
  await mkdir(path.join(serverDir, "plugins"), { recursive: true });
  await mkdir(path.join(serverDir, "resource_packs"), { recursive: true });
  await writeFile(path.join(serverDir, "paper-1.21.4.jar"), "fixture");
  await writeFile(
    path.join(corpus, "city.zip"),
    buildStoredZip([
      { name: "City/level.dat", content: Buffer.from("level") },
      { name: "City/region/r.0.0.mca", content: Buffer.from("region") },
    ]),
  );
  await writeFile(path.join(corpus, "unknown.txt"), "unknown");

  const previousRoot = process.env.GAMEHUB_CONTENT_ROOT;
  process.env.GAMEHUB_CONTENT_ROOT = corpus;
  let server = await startServer(3356, {
    minecraftServerDir: serverDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
    aiProvider: "fallback",
  });

  try {
    const sources = await fetch("http://127.0.0.1:3356/api/content/sources");
    assert.equal(sources.status, 200);
    assert.ok(((await sources.json()) as { sources: Array<{ path: string }> }).sources.some((source) => source.path === "city.zip"));

    const escape = await fetch("http://127.0.0.1:3356/api/content/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: "../outside.zip" }),
    });
    assert.equal(escape.status, 400);

    const scan = await fetch("http://127.0.0.1:3356/api/content/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: "city.zip", serverId: "minecraft-main" }),
    });
    assert.equal(scan.status, 201);
    const item = ((await scan.json()) as { report: { items: Array<{ contentId: string; contentType: string }> } }).report.items[0];
    assert.equal(item.contentType, "java-world");

    const planResponse = await fetch("http://127.0.0.1:3356/api/content/import-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentId: item.contentId,
        serverId: "minecraft-main",
        destinationPath: "C:\\Windows\\System32",
        stagingPath: "C:\\arbitrary",
      }),
    });
    assert.equal(planResponse.status, 201);
    const plan = ((await planResponse.json()) as { plan: { operationId: string; destinationPath: string; stagingPath: string } }).plan;
    assert.equal(plan.destinationPath, path.join(serverDir, "worlds", "city"));
    assert.match(plan.stagingPath, /\.gamehub-content-staging/);

    const noApproval = await fetch(`http://127.0.0.1:3356/api/content/import-plans/${plan.operationId}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve: false }),
    });
    assert.equal(noApproval.status, 400);

    const execution = await fetch(`http://127.0.0.1:3356/api/content/import-plans/${plan.operationId}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(execution.status, 201);
    assert.equal(((await execution.json()) as { result: { status: string } }).result.status, "completed");
    const canonicalPlan = await fetch(`http://127.0.0.1:3356/api/content/import-plans/${plan.operationId}`);
    assert.equal(canonicalPlan.status, 200);
    assert.equal(((await canonicalPlan.json()) as { plan: { operationId: string } }).plan.operationId, plan.operationId);

    const blockedScan = await fetch("http://127.0.0.1:3356/api/content/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: "unknown.txt", serverId: "minecraft-main" }),
    });
    const blockedItem = ((await blockedScan.json()) as { report: { items: Array<{ contentId: string }> } }).report.items[0];
    const blockedPlan = await fetch("http://127.0.0.1:3356/api/content/import-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: blockedItem.contentId, serverId: "minecraft-main" }),
    });
    assert.equal(blockedPlan.status, 422);
    assert.equal(((await blockedPlan.json()) as { plan: { status: string; blockingIssues: Array<{ code: string }> } }).plan.status, "blocked");

    await closeServer(server);
    server = await startServer(3356, {
      minecraftServerDir: serverDir,
      minecraftStartCommand: "node -e \"process.exit(0)\"",
      minecraftStopCommand: "node -e \"process.exit(0)\"",
      persistenceDbPath: dbPath,
      aiProvider: "fallback",
    });

    const inventory = await fetch("http://127.0.0.1:3356/api/content/inventory");
    const inventoryBody = (await inventory.json()) as { inventory: Array<{ contentType: string; items: Array<{ path: string }> }> };
    assert.ok(inventoryBody.inventory.find((group) => group.contentType === "java-world")?.items.some((entry) => entry.path === "city"));
    const history = await fetch("http://127.0.0.1:3356/api/content/history");
    const audit = ((await history.json()) as { audit: Array<{ action: string }> }).audit;
    assert.ok(audit.some((entry) => entry.action === "content.import.installed"));
    assert.ok(audit.some((entry) => entry.action === "content.import.staging-cleaned"));
  } finally {
    await closeServer(server);
    if (previousRoot === undefined) delete process.env.GAMEHUB_CONTENT_ROOT;
    else process.env.GAMEHUB_CONTENT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("Content Library API maps Bedrock plans to the configured native provider root", async () => {
  process.env.NODE_ENV = "production";
  const root = await createRoot("bedrock-api");
  const corpus = path.join(root, "corpus");
  const paperDir = path.join(root, "paper");
  const bedrockDir = path.join(root, "bedrock");
  await mkdir(corpus, { recursive: true });
  await mkdir(bedrockDir, { recursive: true });
  await writeFile(path.join(bedrockDir, "bedrock_server.exe"), "fixture");
  await writeFile(path.join(corpus, "city.mcworld"), buildStoredZip([
    { name: "level.dat", content: Buffer.from("level") },
    { name: "db/000001.log", content: Buffer.from("db") },
  ]));
  const previousRoot = process.env.GAMEHUB_CONTENT_ROOT;
  process.env.GAMEHUB_CONTENT_ROOT = corpus;
  const server = await startServer(3357, {
    minecraftServerDir: paperDir,
    bedrockServerDir: bedrockDir,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: path.join(root, "gamehub.sqlite"),
    aiProvider: "fallback",
  });
  try {
    const scan = await fetch("http://127.0.0.1:3357/api/content/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: "city.mcworld", serverId: "bedrock-main" }),
    });
    assert.equal(scan.status, 201);
    const item = ((await scan.json()) as { report: { items: Array<{ contentId: string; contentType: string; compatibility: { status: string } }> } }).report.items[0];
    assert.equal(item.contentType, "bedrock-world");
    assert.equal(item.compatibility.status, "READY");
    const planResponse = await fetch("http://127.0.0.1:3357/api/content/import-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: item.contentId, serverId: "bedrock-main", destinationPath: "C:\\Windows\\System32" }),
    });
    assert.equal(planResponse.status, 201);
    const plan = ((await planResponse.json()) as { plan: { operationId: string; destinationPath: string } }).plan;
    assert.equal(plan.destinationPath, path.join(bedrockDir, "worlds", "city"));
    const execution = await fetch(`http://127.0.0.1:3357/api/content/import-plans/${plan.operationId}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(execution.status, 201);
    const executionBody = (await execution.json()) as { result: { status: string } };
    assert.equal(executionBody.result.status, "completed");
    const inventory = (await (await fetch("http://127.0.0.1:3357/api/content/inventory")).json()) as {
      inventory: Array<{ contentType: string; items: Array<{ path: string }> }>;
    };
    assert.ok(inventory.inventory.find((group) => group.contentType === "bedrock-world")?.items.some((entry) => entry.path === "city"));
    const history = (await (await fetch("http://127.0.0.1:3357/api/content/history")).json()) as { audit: Array<{ action: string }> };
    assert.ok(history.audit.some((entry) => entry.action === "content.import.installed"));
  } finally {
    await closeServer(server);
    if (previousRoot === undefined) delete process.env.GAMEHUB_CONTENT_ROOT;
    else process.env.GAMEHUB_CONTENT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
