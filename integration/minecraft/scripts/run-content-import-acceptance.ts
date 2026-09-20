/**
 * JBGH-020B live Paper acceptance.
 *
 * Uses only the disposable integration/minecraft/server harness. It creates
 * temporary source content outside the server, scans and imports through the
 * production ContentImport pipeline, starts Paper against the imported world,
 * then restarts Paper to prove an imported plugin loads. It restores the
 * harness property file and deletes only paths created by this run.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import * as minecraft from "minecraft-protocol";
import { ContentLibraryScanner } from "../../../packages/content-library/scanner";
import { MinecraftContentImportAdapter } from "../../../packages/minecraft-provider/content-import";
import { MinecraftProvider } from "../../../packages/minecraft-provider";

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SERVER_DIR = path.join(WORKSPACE_ROOT, "integration", "minecraft", "server");
const STATE_PATH = path.join(SERVER_DIR, ".jbgamehub-state.json");
const PROPERTIES_PATH = path.join(SERVER_DIR, "server.properties");
const LOG_PATH = path.join(SERVER_DIR, "logs", "latest.log");
const EVIDENCE_DIR = path.join(WORKSPACE_ROOT, "integration", "minecraft", "evidence");
const WORLD_ID = "JBGH020BLiveWorld";
const PLUGIN_FILE = "JBGH020BAcceptance.jar";
const PLAYER = "JBGH020BPlayer";

interface HarnessState {
  host: string;
  javaPort: number;
  javaPath: string;
  paperJar: string;
}

interface StoredZipEntry {
  name: string;
  content: Buffer;
}

function buildStoredZip(entries: StoredZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localEntry = Buffer.concat([local, name, entry.content]);
    localChunks.push(localEntry);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(entry.content.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(Buffer.concat([central, name]));
    offset += localEntry.length;
  }
  const directory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, directory, eocd]);
}

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function filesUnder(root: string): Promise<StoredZipEntry[]> {
  const entries: StoredZipEntry[] = [];
  async function visit(directory: string): Promise<void> {
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, child.name);
      if (child.isDirectory()) await visit(filePath);
      else if (child.isFile()) {
        entries.push({
          name: path.relative(root, filePath),
          content: await fs.readFile(filePath),
        });
      }
    }
  }
  await visit(root);
  return entries;
}

async function waitForTcp(host: string, port: number, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.setTimeout(1_000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Paper did not accept TCP connections at ${host}:${port}.`);
}

async function waitForLogSince(offset: number, requiredText: string, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const log = await fs.readFile(LOG_PATH, "utf8").catch(() => "");
    if (log.slice(offset).includes(requiredText)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Paper log did not include '${requiredText}' before timeout.`);
}

async function startPaper(state: HarnessState): Promise<{ process: ChildProcess; stop: () => Promise<void> }> {
  const initialLogSize = (await fs.stat(LOG_PATH).catch(() => ({ size: 0 }))).size;
  const logHandle = await fs.open(LOG_PATH, "a");
  const process = spawn(state.javaPath, ["-Xms1G", "-Xmx1G", "-jar", state.paperJar, "nogui"], {
    cwd: SERVER_DIR,
    stdio: ["pipe", logHandle.fd, logHandle.fd],
    windowsHide: true,
  });
  await logHandle.close();
  await waitForTcp(state.host, state.javaPort);
  await waitForLogSince(initialLogSize, "Done (");
  return {
    process,
    stop: async () => {
      if (process.exitCode !== null) return;
      process.stdin?.write("stop\n");
      await Promise.race([
        once(process, "exit"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Paper did not stop within 30 seconds.")), 30_000)),
      ]);
    },
  };
}

async function connectPlayer(state: HarnessState): Promise<void> {
  const client = minecraft.createClient({
    host: state.host,
    port: state.javaPort,
    username: PLAYER,
    auth: "offline",
    version: "1.21.4",
    hideErrors: false,
  });
  const failure = once(client, "error").then(([error]) => Promise.reject(error));
  await Promise.race([
    once(client, "playerJoin"),
    failure,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Minecraft client did not join imported world.")), 20_000)),
  ]);
  client.end("JBGH-020B acceptance complete");
}

async function createPlugin(tempRoot: string, state: HarnessState): Promise<string> {
  const sourceDir = path.join(tempRoot, "plugin-source");
  const classesDir = path.join(tempRoot, "plugin-classes");
  await fs.mkdir(path.join(sourceDir, "jbgh", "acceptance"), { recursive: true });
  await fs.mkdir(classesDir, { recursive: true });
  await fs.writeFile(
    path.join(sourceDir, "jbgh", "acceptance", "Jbgh020BAcceptancePlugin.java"),
    [
      "package jbgh.acceptance;",
      "import org.bukkit.plugin.java.JavaPlugin;",
      "public final class Jbgh020BAcceptancePlugin extends JavaPlugin {",
      "  @Override public void onEnable() { getLogger().info(\"JBGH-020B acceptance plugin enabled\"); }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(sourceDir, "plugin.yml"),
    ["name: JBGH020BAcceptance", "version: 1.0.0", "main: jbgh.acceptance.Jbgh020BAcceptancePlugin", "api-version: '1.21'", ""].join("\n"),
    "utf8",
  );
  const javaBin = path.dirname(state.javaPath);
  const javac = path.join(javaBin, process.platform === "win32" ? "javac.exe" : "javac");
  const jar = path.join(javaBin, process.platform === "win32" ? "jar.exe" : "jar");
  const paperApiRoot = path.join(SERVER_DIR, "libraries", "io", "papermc", "paper", "paper-api");
  const apiVersionDirectory = (await fs.readdir(paperApiRoot, { withFileTypes: true })).find((entry) => entry.isDirectory());
  if (!apiVersionDirectory) throw new Error("Paper runtime API was not provisioned by the disposable harness.");
  const paperApiDirectory = path.join(paperApiRoot, apiVersionDirectory.name);
  const paperApi = (await fs.readdir(paperApiDirectory)).find((entry) => entry.endsWith(".jar"));
  if (!paperApi) throw new Error("Paper API JAR was not provisioned by the disposable harness.");
  await execFileAsync(javac, [
    "-cp",
    path.join(paperApiDirectory, paperApi),
    "-d",
    classesDir,
    path.join(sourceDir, "jbgh", "acceptance", "Jbgh020BAcceptancePlugin.java"),
  ]);
  const pluginPath = path.join(tempRoot, PLUGIN_FILE);
  await execFileAsync(jar, ["--create", "--file", pluginPath, "-C", classesDir, ".", "-C", sourceDir, "plugin.yml"]);
  return pluginPath;
}

function updateLevelName(properties: string): string {
  return properties.replace(/^level-name=.*$/m, `level-name=worlds/${WORLD_ID}`);
}

async function main(): Promise<void> {
  const state = JSON.parse(await fs.readFile(STATE_PATH, "utf8")) as HarnessState;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jbgh020b-live-"));
  const originalProperties = await fs.readFile(PROPERTIES_PATH, "utf8");
  const adapter = new MinecraftContentImportAdapter({ serverDir: SERVER_DIR });
  const scanner = new ContentLibraryScanner();
  let paper: { process: ChildProcess; stop: () => Promise<void> } | undefined;
  const evidence: Record<string, unknown> = {
    milestone: "JBGH-020B",
    capturedAt: new Date().toISOString(),
    harness: SERVER_DIR,
    world: {},
    plugin: {},
    cleanup: {},
  };

  try {
    const existingWorld = path.join(SERVER_DIR, "jb3-integration-test-world");
    const worldEntries = await filesUnder(existingWorld);
    const worldSource = path.join(tempRoot, `${WORLD_ID}.zip`);
    await fs.writeFile(worldSource, buildStoredZip(worldEntries.map((entry) => ({ ...entry, name: path.join(WORLD_ID, entry.name) }))));
    const worldBefore = await sha256(worldSource);
    const worldItem = (await scanner.scan({
      paths: [worldSource],
      target: { targetId: "minecraft-main", providerId: "minecraft" },
    })).items[0];
    const worldPlan = adapter.createPlan({ item: worldItem, providerId: "minecraft", serverId: "minecraft-main" });
    const worldResult = await adapter.execute(worldPlan, { item: worldItem, providerId: "minecraft", serverId: "minecraft-main" }, true);
    if (worldResult.status !== "completed") throw new Error(`World import failed: ${worldResult.error?.code} ${worldResult.error?.message}`);
    if ((await sha256(worldSource)) !== worldBefore) throw new Error("World archive hash changed after import.");
    await fs.writeFile(PROPERTIES_PATH, updateLevelName(originalProperties), "utf8");

    paper = await startPaper(state);
    await connectPlayer(state);
    const provider = new MinecraftProvider({ serverDir: SERVER_DIR, host: state.host, javaPort: state.javaPort });
    await provider.register();
    const worlds = await provider.getWorlds("minecraft-main");
    if (!worlds.some((world) => world.id === WORLD_ID)) throw new Error("Minecraft provider did not discover imported world.");
    await paper.stop();
    paper = undefined;
    evidence.world = {
      sourceSha256: worldBefore,
      sourceSha256Unchanged: (await sha256(worldSource)) === worldBefore,
      plan: worldPlan,
      result: worldResult.status,
      providerDetectedWorld: true,
      protocolJoinSucceeded: true,
    };

    const pluginSource = await createPlugin(tempRoot, state);
    const pluginBefore = await sha256(pluginSource);
    const pluginItem = (await scanner.scan({
      paths: [pluginSource],
      target: { targetId: "minecraft-main", providerId: "minecraft" },
    })).items[0];
    const pluginPlan = adapter.createPlan({ item: pluginItem, providerId: "minecraft", serverId: "minecraft-main" });
    const pluginResult = await adapter.execute(pluginPlan, { item: pluginItem, providerId: "minecraft", serverId: "minecraft-main" }, true);
    if (pluginResult.status !== "completed") throw new Error(`Plugin import failed: ${pluginResult.error?.code} ${pluginResult.error?.message}`);
    if ((await sha256(pluginSource)) !== pluginBefore) throw new Error("Plugin JAR hash changed after import.");

    paper = await startPaper(state);
    const log = await fs.readFile(LOG_PATH, "utf8");
    if (!log.includes("JBGH-020B acceptance plugin enabled")) throw new Error("Paper did not log the imported plugin's enable message.");
    await paper.stop();
    paper = undefined;
    evidence.plugin = {
      sourceSha256: pluginBefore,
      sourceSha256Unchanged: (await sha256(pluginSource)) === pluginBefore,
      plan: pluginPlan,
      result: pluginResult.status,
      paperLoadedPlugin: true,
    };

    const stagingPath = path.join(SERVER_DIR, ".gamehub-content-staging");
    const auditPath = path.join(SERVER_DIR, "gamehub-content-audit.jsonl");
    const stagingEntries = await fs.readdir(stagingPath).catch(() => []);
    const audit = await fs.readFile(auditPath, "utf8");
    if (stagingEntries.length !== 0) throw new Error("Content staging directory was not cleaned.");
    if (!audit.includes("content.import.installed")) throw new Error("Import audit lacks completed installation records.");
    evidence.cleanup = { stagingCleaned: true, auditContainsLifecycle: true };
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    const evidencePath = path.join(EVIDENCE_DIR, `JBGH-020B-live-import-${Date.now()}.json`);
    await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`[JBGH-020B] PASS: live Paper world + plugin acceptance complete.`);
    console.log(`[JBGH-020B] Evidence: ${evidencePath}`);
  } finally {
    if (paper) await paper.stop().catch(() => undefined);
    await fs.writeFile(PROPERTIES_PATH, originalProperties, "utf8");
    await fs.rm(path.join(SERVER_DIR, "worlds", WORLD_ID), { recursive: true, force: true });
    await fs.rm(path.join(SERVER_DIR, "worlds", `${WORLD_ID}_nether`), { recursive: true, force: true });
    await fs.rm(path.join(SERVER_DIR, "worlds", `${WORLD_ID}_the_end`), { recursive: true, force: true });
    await fs.rm(path.join(SERVER_DIR, "plugins", PLUGIN_FILE), { force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[JBGH-020B] FAIL:", error);
  process.exitCode = 1;
});
