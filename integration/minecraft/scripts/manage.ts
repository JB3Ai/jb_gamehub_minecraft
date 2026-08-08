import fs from "fs/promises";
import { spawn, spawnSync } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const INTEGRATION_ROOT = path.join(WORKSPACE_ROOT, "integration", "minecraft");
const DEFAULT_SERVER_DIR = path.join(INTEGRATION_ROOT, "server");
const CONFIG_DIR = path.join(INTEGRATION_ROOT, "config");
const FIXTURES_DIR = path.join(INTEGRATION_ROOT, "fixtures");

const WORLD_FIXTURE_DIR = path.join(FIXTURES_DIR, "worlds", "jb3-integration-test-world");
const BEHAVIOR_PACK_FIXTURE_DIR = path.join(FIXTURES_DIR, "packs", "integration-behavior-pack");
const RESOURCE_PACK_FIXTURE_DIR = path.join(FIXTURES_DIR, "packs", "integration-resource-pack");

const SERVER_MARKER = ".jbgamehub-managed";
const STATE_FILE = ".jbgamehub-state.json";
const PID_FILE = ".paper.pid";
const LOG_DIR = "logs";
const LEVEL_NAME = "jb3-integration-test-world";
const DISPLAY_NAME = "JB³ GAMEHUB INTEGRATION TEST SERVER";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_JAVA_PORT = 25565;
const DEFAULT_BEDROCK_PORT = 19132;
const DEFAULT_PAPER_VERSION = "1.21.4";
const DEFAULT_GEYSER_URL = "https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot";

interface ManagedState {
  serverDir: string;
  host: string;
  javaPort: number;
  bedrockPort: number;
  paperVersion: string;
  paperBuild: number;
  paperJar: string;
  geyserJar?: string;
}

interface ParsedArgs {
  command?: string;
  confirm: boolean;
  acceptEula: boolean;
  paperVersion?: string;
  paperBuild?: string;
}

function withinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveServerDir(): string {
  const configured = process.env.MINECRAFT_SERVER_DIR?.trim();
  const serverDir = path.resolve(configured && configured.length > 0 ? configured : DEFAULT_SERVER_DIR);
  if (!withinRoot(serverDir, INTEGRATION_ROOT)) {
    throw new Error(`Refusing to use server directory outside integration/minecraft: ${serverDir}`);
  }
  return serverDir;
}

function resolveHost(): string {
  return process.env.MINECRAFT_HOST?.trim() || DEFAULT_HOST;
}

function resolvePort(raw: string | undefined, fallback: number, label: string): number {
  const value = raw && raw.trim().length > 0 ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return value;
}

function resolveJavaPort(): number {
  return resolvePort(process.env.MINECRAFT_JAVA_PORT, DEFAULT_JAVA_PORT, "MINECRAFT_JAVA_PORT");
}

function resolveBedrockPort(): number {
  return resolvePort(process.env.MINECRAFT_BEDROCK_PORT, DEFAULT_BEDROCK_PORT, "MINECRAFT_BEDROCK_PORT");
}

function parseArgs(argv: string[]): ParsedArgs {
  return {
    command: argv[2],
    confirm: argv.includes("--confirm"),
    acceptEula: argv.includes("--accept-eula"),
    paperVersion: argv.find((value) => value.startsWith("--paper-version="))?.split("=", 2)[1],
    paperBuild: argv.find((value) => value.startsWith("--paper-build="))?.split("=", 2)[1],
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await fileExists(filePath)) {
    return false;
  }
  await ensureParent(filePath);
  await fs.writeFile(filePath, content, "utf8");
  return true;
}

async function copyFileIfMissing(source: string, destination: string): Promise<void> {
  if (await fileExists(destination)) {
    return;
  }
  await ensureParent(destination);
  await fs.copyFile(source, destination);
}

async function readEntries(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

async function ensureSafeServerDir(serverDir: string): Promise<void> {
  const entries = await readEntries(serverDir);
  if (entries.length === 0) {
    return;
  }

  if (await fileExists(path.join(serverDir, SERVER_MARKER))) {
    return;
  }

  const allowedScaffold = new Set(["worlds", "behavior_packs", "resource_packs", "plugins", "logs"]);
  const unknownEntries = entries.filter((entry) => !allowedScaffold.has(entry));

  if (unknownEntries.length > 0) {
    throw new Error([
      "Refusing to use a non-empty server directory without the integration marker.",
      `Server directory: ${serverDir}`,
      `Existing entries: ${entries.join(", ")}`,
    ].join(" "));
  }

  for (const entry of entries) {
    const childPath = path.join(serverDir, entry);
    const stat = await fs.stat(childPath);
    if (!stat.isDirectory()) {
      throw new Error(`Refusing to use unmanaged non-directory entry: ${childPath}`);
    }
    const childEntries = await readEntries(childPath);
    if (entry === "plugins" && childEntries.length === 1 && childEntries[0] === "Geyser-Spigot") {
      const geyserDir = path.join(childPath, "Geyser-Spigot");
      const geyserDirEntries = await readEntries(geyserDir);
      if (geyserDirEntries.length === 0) {
        continue;
      }
    }
    if (childEntries.length > 0) {
      throw new Error([
        "Refusing to use a pre-populated server directory without integration marker.",
        `Directory: ${childPath}`,
        `Contains: ${childEntries.join(", ")}`,
      ].join(" "));
    }
  }
}

function ensureJava21(): void {
  const result = spawnSync("java", ["-version"], { encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error || result.status !== 0) {
    throw new Error("Java 21 is required but java -version failed. Install Java 21 and try again.");
  }

  const match = output.match(/version\s+"(\d+)(?:\.(\d+))?/i);
  const major = match ? Number(match[1]) : Number.NaN;
  if (major !== 21) {
    throw new Error(`Java 21 is required, but the detected version was: ${output || "unknown"}`);
  }
}

async function ensureDirectoryTree(serverDir: string): Promise<void> {
  const directories = [
    serverDir,
    path.join(serverDir, LOG_DIR),
    path.join(serverDir, "plugins"),
    path.join(serverDir, "plugins", "Geyser-Spigot"),
    path.join(serverDir, "worlds"),
    path.join(serverDir, "behavior_packs"),
    path.join(serverDir, "resource_packs"),
  ];

  for (const directory of directories) {
    await fs.mkdir(directory, { recursive: true });
  }
}

async function copyFixtureTree(source: string, destination: string): Promise<void> {
  const entries = await readEntries(destination);
  if (entries.length > 0) {
    return;
  }
  await fs.cp(source, destination, { recursive: true });
}

async function resolvePaperBuild(version: string, requestedBuild?: string): Promise<{ build: number; jarName: string; downloadUrl: string }> {
  type FillBuild = {
    id: number;
    downloads?: {
      "server:default"?: {
        name?: string;
        url?: string;
      };
    };
  };

  const response = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`);
  if (!response.ok) {
    throw new Error(`Unable to resolve Paper version ${version}: ${response.status} ${response.statusText}`);
  }

  const builds = (await response.json()) as FillBuild[];
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error(`No Paper builds available for version ${version}`);
  }

  const selected = requestedBuild
    ? builds.find((item) => item.id === Number(requestedBuild))
    : builds[builds.length - 1];

  if (!selected) {
    throw new Error(`Requested Paper build not found for version ${version}: ${requestedBuild}`);
  }

  const artifact = selected.downloads?.["server:default"];
  if (!artifact?.url || !artifact?.name) {
    throw new Error(`Missing server artifact metadata for Paper ${version} build ${selected.id}`);
  }

  return {
    build: selected.id,
    jarName: artifact.name,
    downloadUrl: artifact.url,
  };
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  if (await fileExists(targetPath)) {
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await ensureParent(targetPath);
  await fs.writeFile(targetPath, bytes);
}

async function writeTemplates(serverDir: string, host: string, javaPort: number, bedrockPort: number, acceptEula: boolean): Promise<void> {
  const serverPropertiesTemplate = await fs.readFile(path.join(CONFIG_DIR, "server.properties.template"), "utf8");
  const eulaTemplate = await fs.readFile(path.join(CONFIG_DIR, "eula.txt.template"), "utf8");
  const geyserConfig = await fs.readFile(path.join(CONFIG_DIR, "geyser-config.yml"), "utf8");

  await writeIfMissing(
    path.join(serverDir, "server.properties"),
    serverPropertiesTemplate
      .replaceAll("{{MINECRAFT_HOST}}", host)
      .replaceAll("{{MINECRAFT_JAVA_PORT}}", String(javaPort)),
  );

  await writeIfMissing(path.join(serverDir, "eula.txt"), eulaTemplate.replaceAll("{{EULA_VALUE}}", acceptEula ? "true" : "false"));
  await writeIfMissing(
    path.join(serverDir, "plugins", "Geyser-Spigot", "config.yml"),
    geyserConfig
      .replaceAll("{{MINECRAFT_HOST}}", host)
      .replaceAll("{{MINECRAFT_JAVA_PORT}}", String(javaPort))
      .replaceAll("{{MINECRAFT_BEDROCK_PORT}}", String(bedrockPort)),
  );
  await writeIfMissing(path.join(serverDir, SERVER_MARKER), `${DISPLAY_NAME}\n`);
}

async function setupEnvironment(options: { acceptEula: boolean; paperVersion?: string; paperBuild?: string }): Promise<void> {
  ensureJava21();
  const serverDir = resolveServerDir();
  await ensureSafeServerDir(serverDir);
  await ensureDirectoryTree(serverDir);

  const host = resolveHost();
  const javaPort = resolveJavaPort();
  const bedrockPort = resolveBedrockPort();
  const paperVersion = options.paperVersion || process.env.MINECRAFT_TEST_PAPER_VERSION || DEFAULT_PAPER_VERSION;
  const paperBuild = await resolvePaperBuild(paperVersion, options.paperBuild || process.env.MINECRAFT_TEST_PAPER_BUILD);
  const paperJarPath = path.join(serverDir, paperBuild.jarName);
  const geyserJarPath = path.join(serverDir, "plugins", "Geyser-Spigot.jar");
  const geyserJarUrl = process.env.MINECRAFT_TEST_GEYSER_JAR_URL?.trim() || DEFAULT_GEYSER_URL;

  await writeTemplates(serverDir, host, javaPort, bedrockPort, options.acceptEula);
  await copyFixtureTree(WORLD_FIXTURE_DIR, path.join(serverDir, "worlds", LEVEL_NAME));
  await copyFixtureTree(BEHAVIOR_PACK_FIXTURE_DIR, path.join(serverDir, "behavior_packs", "integration-behavior-pack"));
  await copyFixtureTree(RESOURCE_PACK_FIXTURE_DIR, path.join(serverDir, "resource_packs", "integration-resource-pack"));
  await copyFileIfMissing(path.join(WORLD_FIXTURE_DIR, "level.dat"), path.join(serverDir, "worlds", LEVEL_NAME, "level.dat"));
  await copyFileIfMissing(
    path.join(WORLD_FIXTURE_DIR, "world_behavior_packs.json"),
    path.join(serverDir, "worlds", LEVEL_NAME, "world_behavior_packs.json"),
  );
  await copyFileIfMissing(
    path.join(WORLD_FIXTURE_DIR, "world_resource_packs.json"),
    path.join(serverDir, "worlds", LEVEL_NAME, "world_resource_packs.json"),
  );
  await downloadFile(paperBuild.downloadUrl, paperJarPath);

  if (geyserJarUrl.length > 0) {
    await downloadFile(geyserJarUrl, geyserJarPath);
  }

  await writeJson(path.join(serverDir, STATE_FILE), {
    serverDir,
    host,
    javaPort,
    bedrockPort,
    paperVersion,
    paperBuild: paperBuild.build,
    paperJar: paperJarPath,
    geyserJar: geyserJarUrl.length > 0 ? geyserJarPath : undefined,
  } satisfies ManagedState);

  console.log(DISPLAY_NAME);
  console.log(`Server directory: ${serverDir}`);
  console.log(`Paper version: ${paperVersion} (build ${paperBuild.build})`);
  console.log(`Java port: ${javaPort}`);
  console.log(`Bedrock port: ${bedrockPort}`);
  console.log(`EULA accepted: ${options.acceptEula ? "yes" : "no"}`);
}

async function loadState(serverDir: string): Promise<ManagedState> {
  const state = await readJson<ManagedState>(path.join(serverDir, STATE_FILE));
  if (!state) {
    throw new Error(`Integration state not found. Run npm run minecraft:test:setup first.`);
  }
  return state;
}

async function readEulaAccepted(serverDir: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(serverDir, "eula.txt"), "utf8");
    return /eula\s*=\s*true/i.test(raw);
  } catch {
    return false;
  }
}

async function isTcpReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(value);
      }
    };

    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startServerProcess(): Promise<void> {
  const serverDir = resolveServerDir();
  const state = await loadState(serverDir);

  if (!(await readEulaAccepted(serverDir))) {
    throw new Error("EULA has not been accepted. Re-run setup with --accept-eula before starting the test server.");
  }

  const pidPath = path.join(serverDir, PID_FILE);
  if (await fileExists(pidPath)) {
    const pid = Number((await fs.readFile(pidPath, "utf8")).trim());
    if (Number.isInteger(pid) && isProcessAlive(pid)) {
      console.log(`Test server already running (PID ${pid}).`);
      return;
    }
  }

  const logPath = path.join(serverDir, LOG_DIR, "latest.log");
  await ensureParent(logPath);
  const logHandle = await fs.open(logPath, "a");

  const child = spawn("java", ["-Xms1G", "-Xmx1G", "-jar", state.paperJar, "nogui"], {
    cwd: serverDir,
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
    windowsHide: true,
  });

  child.unref();
  await fs.writeFile(pidPath, `${child.pid}\n`, "utf8");
  await logHandle.close();

  console.log(DISPLAY_NAME);
  console.log(`Started Paper process with PID ${child.pid}`);
  console.log(`Java port: ${state.javaPort}`);
  console.log(`Bedrock port: ${state.bedrockPort}`);
}

async function stopServerProcess(): Promise<void> {
  const serverDir = resolveServerDir();
  const pidPath = path.join(serverDir, PID_FILE);
  if (!(await fileExists(pidPath))) {
    console.log("Test server is not running.");
    return;
  }

  const pid = Number((await fs.readFile(pidPath, "utf8")).trim());
  if (!Number.isInteger(pid)) {
    throw new Error(`Invalid PID file: ${pidPath}`);
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore missing process errors.
    }
  }

  await fs.rm(pidPath, { force: true });
  console.log(DISPLAY_NAME);
  console.log(`Stopped Paper process ${pid}`);
}

async function statusServerProcess(): Promise<void> {
  const serverDir = resolveServerDir();
  const state = await loadState(serverDir);
  const pidPath = path.join(serverDir, PID_FILE);
  const pid = (await fileExists(pidPath)) ? Number((await fs.readFile(pidPath, "utf8")).trim()) : undefined;
  const processAlive = Number.isInteger(pid) ? isProcessAlive(pid as number) : false;
  const javaReachable = await isTcpReachable(state.host, state.javaPort);

  const { bootstrapCore } = await import("../../../packages/core/index");
  const providerManager = await bootstrapCore({
    minecraftServerDir: state.serverDir,
    minecraftHost: state.host,
    minecraftJavaPort: state.javaPort,
    minecraftBedrockPort: state.bedrockPort,
    minecraftStartCommand: "npx tsx ../scripts/manage.ts start",
    minecraftStopCommand: "npx tsx ../scripts/manage.ts stop",
  });

  const provider = providerManager.getProvider("minecraft");
  const diagnostics = await provider.getDiagnostics();
  const server = (await providerManager.listServers())[0];

  if (!server) {
    throw new Error("Integration server did not expose a Minecraft server summary.");
  }

  const status = await providerManager.getServerStatus(server.id);
  const worlds = await providerManager.getWorlds(server.id);
  const validation = worlds[0] ? await providerManager.validateWorld(server.id, worlds[0].id) : undefined;

  console.log(DISPLAY_NAME);
  console.log("");
  console.log("Provider");
  console.log("--------------");
  console.log(`Minecraft provider: ${provider.metadata().status === "ready" ? "PASS" : "WARN"}`);
  console.log(`Paper detected: ${diagnostics.paperDetected ? "PASS" : "FAIL"}`);
  console.log(`Geyser detected: ${diagnostics.geyserDetected ? "PASS" : "FAIL"}`);
  console.log("");
  console.log("Connectivity");
  console.log("--------------");
  console.log(`Java TCP reachable: ${javaReachable ? "PASS" : "FAIL"}`);
  console.log(`Bedrock/Geyser endpoint: ${state.host}:${state.bedrockPort}`);
  console.log(`Server status: ${status.status.toUpperCase()}`);
  console.log(`Process running: ${processAlive ? "yes" : "no"}`);
  console.log("");
  console.log("Worlds");
  console.log("--------------");
  console.log(`World count: ${worlds.length}`);
  console.log(`World names: ${worlds.map((world) => world.name).join(", ") || "none"}`);
  console.log("");
  console.log("Content");
  console.log("--------------");
  console.log(`Validation result: ${validation?.valid ? "PASS" : "WARN"}`);
  console.log(`Behavior pack references: ${validation?.behaviorPackRefs?.length || 0}`);
  console.log(`Resource pack references: ${validation?.resourcePackRefs?.length || 0}`);
}

async function cleanServerProcess(confirm: boolean): Promise<void> {
  if (!confirm) {
    throw new Error("Refusing to delete the integration test environment without --confirm.");
  }

  const serverDir = resolveServerDir();
  if (!(await fileExists(path.join(serverDir, SERVER_MARKER)))) {
    throw new Error(`Integration marker not found. Refusing to clean an unmanaged directory: ${serverDir}`);
  }

  await fs.rm(serverDir, { recursive: true, force: true });
  console.log(DISPLAY_NAME);
  console.log(`Removed managed integration server directory: ${serverDir}`);
}

async function main() {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case "setup":
      await setupEnvironment({ acceptEula: args.acceptEula, paperVersion: args.paperVersion, paperBuild: args.paperBuild });
      break;
    case "start":
      await startServerProcess();
      break;
    case "stop":
      await stopServerProcess();
      break;
    case "status":
      await statusServerProcess();
      break;
    case "clean":
      await cleanServerProcess(args.confirm);
      break;
    default:
      throw new Error("Usage: tsx integration/minecraft/scripts/manage.ts <setup|start|stop|status|clean> [--accept-eula] [--confirm]");
  }
}

main().catch((error) => {
  console.error(DISPLAY_NAME);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
