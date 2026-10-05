import { BedrockRuntimeAttachments } from "./runtime-attachment";
import { BedrockProvisioningPlanner } from "./provisioning";
import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CapabilityMap,
  ConnectionEndpoint,
  GameProvider,
  ProviderAccessEnforcementInput,
  ProviderActionResult,
  ProviderDiagnostics,
  ProviderMetadata,
  ProviderOnlinePlayer,
  ProviderPlayerLifecycleEvent,
  ProviderResolvedPlayerIdentity,
  ServerStatus,
  ServerSummary,
  ValidationResult,
  WorldSummary,
} from "../provider-manager";
import { parseBedrockManifest, readBedrockLinkage } from "../content-library/bedrock-content-adapter";

export interface BedrockProviderConfig {
  serverDir?: string;
  host?: string;
  port?: number;
  providerId?: string;
  serverId?: string;
  startCommand?: string;
  stopCommand?: string;
}

async function exists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

async function directories(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function commandParts(command: string): { executable: string; args: string[] } {
  const values = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
  const [rawExecutable, ...rawArgs] = values;
  if (!rawExecutable) throw new Error("Bedrock server command is empty.");
  const clean = (value: string) => value.replace(/^["']|["']$/g, "");
  return { executable: clean(rawExecutable), args: rawArgs.map(clean) };
}

/** Native Bedrock Dedicated Server provider. It remains degraded until a BDS installation is configured. */
export class BedrockProvider implements GameProvider {
  readonly runtimeAttachments = new BedrockRuntimeAttachments();
  readonly provisioning: BedrockProvisioningPlanner;
  private readonly config: Required<Pick<BedrockProviderConfig, "host" | "port" | "providerId" | "serverId">> & BedrockProviderConfig;
  private process?: ChildProcess;
  private ready = false;
  private runtimeReady = false;
  private startedAt?: number;
  private readonly players = new Map<string, { displayName: string; connectedAt: string }>();
  private readonly listeners = new Set<(event: ProviderPlayerLifecycleEvent) => void>();
  private stdoutBuffer = "";
  private stderrBuffer = "";

  constructor(config: BedrockProviderConfig = {}) {
    this.provisioning = new BedrockProvisioningPlanner(config.providerId || "minecraft-bedrock");
    this.config = {
      host: config.host || "127.0.0.1",
      port: config.port ?? 19132,
      providerId: config.providerId || "minecraft-bedrock",
      serverId: config.serverId || "bedrock-main",
      ...config,
    };
  }

  metadata(): ProviderMetadata {
    return { id: this.config.providerId, name: "Minecraft Bedrock Dedicated Server", version: "0.1.0", status: this.ready ? "ready" : "degraded" };
  }

  getCapabilities(): CapabilityMap {
    const configured = Boolean(this.config.serverDir);
    return {
      "server.provision.plan": true,
      "server.provision.preflight": true,
      "server.provision.attach": true,
      "server.start": configured,
      "server.stop": configured,
      "server.restart": configured,
      "world.list": configured,
      "world.import": configured,
      "content.validate": configured,
      "pack.link": configured,
      "player.list": configured,
      "player.identity": configured,
      "player.sessions": configured,
      "player.enforcement": configured,
      "runtime.native-bedrock": configured,
    };
  }

  async getDiagnostics(): Promise<ProviderDiagnostics> {
    return { paperDetected: false, geyserDetected: false };
  }

  async register(): Promise<void> {
    this.ready = await this.detectBds();
  }

  async getServers(): Promise<ServerSummary[]> {
    return [{ id: this.config.serverId, providerId: this.config.providerId, name: "Bedrock Dedicated Server" }];
  }

  async getServerConnectionEndpoints(serverId: string): Promise<ConnectionEndpoint[]> {
    this.assertServer(serverId);
    return [{
      id: "bedrock",
      protocol: "minecraft-bedrock",
      transport: "udp",
      host: this.config.host,
      port: this.config.port,
      display: `${this.config.host}:${this.config.port}`,
      capabilities: this.ready ? ["play", "native-bedrock"] : ["unavailable"],
    }];
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    this.assertServer(serverId);
    return {
      status: this.process && !this.process.killed ? this.runtimeReady ? "online" : "starting" : "offline",
      players: this.players.size,
      uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : undefined,
    };
  }

  async startServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServer(serverId);
    if (!this.config.serverDir || !(await this.detectBds())) {
      throw new Error("Bedrock Dedicated Server is not configured. Set BEDROCK_SERVER_DIR to a BDS installation.");
    }
    if (this.process && !this.process.killed) return { message: "Bedrock Dedicated Server is already running." };
    const command = this.config.startCommand || this.defaultExecutable();
    const { executable, args } = commandParts(command);
    this.process = spawn(executable, args, { cwd: this.config.serverDir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = this.appendLog(this.stdoutBuffer, chunk.toString("utf8"));
    });
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBuffer = this.appendLog(this.stderrBuffer, chunk.toString("utf8"));
    });
    this.runtimeReady = false;
    this.process.once("exit", () => { this.process = undefined; this.startedAt = undefined; this.runtimeReady = false; this.stdoutBuffer = ""; this.stderrBuffer = ""; });
    this.startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      this.process!.once("spawn", resolve);
      this.process!.once("error", (error) => { this.process = undefined; this.startedAt = undefined; this.runtimeReady = false; reject(error); });
    });
    return { message: "Bedrock Dedicated Server process started." };
  }

  async stopServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServer(serverId);
    if (this.config.stopCommand) {
      const { executable, args } = commandParts(this.config.stopCommand);
      const child = spawn(executable, args, { cwd: this.config.serverDir, stdio: "ignore", windowsHide: true });
      await new Promise<void>((resolve, reject) => child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Bedrock stop command failed with exit code ${code}.`))));
      return { message: "Bedrock Dedicated Server stop command executed." };
    }
    if (!this.process?.stdin?.writable) throw new Error("Bedrock Dedicated Server is not running and no BEDROCK_STOP_COMMAND is configured.");
    this.process.stdin.write("stop\n");
    return { message: "Bedrock Dedicated Server stop command issued." };
  }

  async restartServer(serverId: string): Promise<ProviderActionResult> {
    await this.stopServer(serverId);
    return this.startServer(serverId);
  }

  async getWorlds(serverId: string): Promise<WorldSummary[]> {
    this.assertServer(serverId);
    if (!this.config.serverDir) return [];
    const worldsRoot = path.join(this.config.serverDir, "worlds");
    const worlds: WorldSummary[] = [];
    for (const world of await directories(worldsRoot)) {
      if (await exists(path.join(world, "level.dat"))) worlds.push({ id: path.basename(world), name: path.basename(world), path: world });
    }
    return worlds;
  }

  async validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
    this.assertServer(serverId);
    if (!this.config.serverDir) return { valid: false, missingPacks: [], invalidPacks: [], errors: [{ type: "native_runtime_not_configured", message: "Bedrock Dedicated Server is not configured." }] };
    const worldPath = path.join(this.config.serverDir, "worlds", worldId);
    if (!(await exists(path.join(worldPath, "level.dat")))) return { valid: false, missingPacks: [], invalidPacks: [], errors: [{ type: "world_not_found", message: `World not found: ${worldId}` }] };
    const missingPacks = [];
    const invalidPacks = [];
    for (const [file, root] of [["world_behavior_packs.json", "behavior_packs"], ["world_resource_packs.json", "resource_packs"]] as const) {
      let links;
      try { links = await readBedrockLinkage(worldPath, file); } catch (error) { return { valid: false, missingPacks: [], invalidPacks: [], errors: [{ type: "linkage_invalid", message: error instanceof Error ? error.message : "Invalid world pack linkage." }] }; }
      for (const link of links) {
        try {
          const manifest = parseBedrockManifest(JSON.parse(await fs.readFile(path.join(this.config.serverDir, root, link.pack_id, "manifest.json"), "utf8")));
          if (!manifest.identity) invalidPacks.push({ type: "manifest_invalid", uuid: link.pack_id, version: link.version.join("."), source: file, message: "Installed pack manifest is invalid." });
          else if (manifest.identity.version.join(".") !== link.version.join(".")) invalidPacks.push({ type: "version_mismatch", uuid: link.pack_id, version: link.version.join("."), source: file, message: "Linked pack version differs from installed manifest." });
        } catch {
          missingPacks.push({ type: "missing_pack", uuid: link.pack_id, version: link.version.join("."), source: file, message: "Linked pack is not installed." });
        }
      }
    }
    return { valid: !missingPacks.length && !invalidPacks.length, missingPacks, invalidPacks, errors: [] };
  }

  async resolvePlayerIdentity(serverId: string, hint: { externalPlayerId?: string; displayName?: string }): Promise<ProviderResolvedPlayerIdentity | undefined> {
    this.assertServer(serverId);
    if (!hint.externalPlayerId) return undefined;
    return { providerId: this.config.providerId, externalPlayerId: hint.externalPlayerId, displayName: hint.displayName || this.players.get(hint.externalPlayerId)?.displayName || hint.externalPlayerId, identityType: "minecraft-bedrock" };
  }

  async getOnlinePlayers(serverId: string): Promise<ProviderOnlinePlayer[]> {
    this.assertServer(serverId);
    return [...this.players.entries()].map(([externalPlayerId, player]) => ({ providerId: this.config.providerId, serverId, externalPlayerId, displayName: player.displayName, identityType: "minecraft-bedrock", connectedAt: player.connectedAt }));
  }

  async enforcePlayerAccess(input: ProviderAccessEnforcementInput): Promise<void> {
    if (input.decision === "DENY") await this.disconnectPlayer(input.serverId, input.externalPlayerId, input.reason);
  }

  async disconnectPlayer(serverId: string, externalPlayerId: string, reason: string): Promise<void> {
    this.assertServer(serverId);
    if (!this.process?.stdin?.writable) throw new Error("Bedrock player enforcement requires a running managed Bedrock Dedicated Server console.");
    const player = this.players.get(externalPlayerId);
    if (!player) throw new Error(`Bedrock player enforcement failed: ${externalPlayerId} is not currently online.`);
    const target = player.displayName.replace(/"/g, '\\"');
    this.process.stdin.write(`kick "${target}" ${reason.replace(/[\r\n]/g, " ").slice(0, 200)}\n`);
  }

  subscribePlayerEvents(listener: (event: ProviderPlayerLifecycleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async detectBds(): Promise<boolean> {
    if (!this.config.serverDir) return false;
    return (await exists(path.join(this.config.serverDir, "bedrock_server.exe"))) || (await exists(path.join(this.config.serverDir, "bedrock_server")));
  }
  private defaultExecutable(): string { return process.platform === "win32" ? "bedrock_server.exe" : "./bedrock_server"; }
  private assertServer(serverId: string): void { if (serverId !== this.config.serverId) throw new Error(`Unknown Bedrock server: ${serverId}`); }
  private consumeLogLine(line: string): void {
    if (/server started|server is running|ipv4 supported/i.test(line)) {
      this.runtimeReady = true;
    }
    const join = line.match(/Player connected:\s*([^,]+).*xuid:\s*(\d+)/i);
    const leave = line.match(/Player disconnected:\s*([^,]+).*xuid:\s*(\d+)/i);
    const match = join || leave;
    if (!match) return;
    const [, displayName, externalPlayerId] = match;
    const type: ProviderPlayerLifecycleEvent["type"] = join ? "player.joined" : "player.left";
    if (join) this.players.set(externalPlayerId, { displayName: displayName.trim(), connectedAt: new Date().toISOString() });
    else this.players.delete(externalPlayerId);
    for (const listener of this.listeners) listener({ type, providerId: this.config.providerId, serverId: this.config.serverId, externalPlayerId, displayName: displayName.trim(), identityType: "minecraft-bedrock", timestamp: new Date().toISOString() });
  }

  /** Buffers a stream chunk and parses only complete logical log lines, returning the unparsed remainder. */
  private appendLog(buffer: string, chunk: string): string {
    const combined = buffer + chunk;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    for (const line of lines) this.consumeLogLine(line);
    return remainder;
  }
}
