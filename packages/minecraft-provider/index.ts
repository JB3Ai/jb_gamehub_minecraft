import fs from "fs/promises";
import path from "path";
import net from "net";
import { spawn } from "child_process";
import {
  CapabilityMap,
  GameProvider,
  ProviderActionResult,
  ProviderMetadata,
  ServerStatus,
  ServerSummary,
  ValidationIssue,
  ValidationResult,
  WorldSummary,
} from "../provider-manager/index";

interface MinecraftProviderConfig {
  providerId?: string;
  name?: string;
  version?: string;
  serverId?: string;
  serverName?: string;
  serverDir: string;
  host?: string;
  javaPort?: number;
  bedrockPort?: number;
  startCommand?: string;
  stopCommand?: string;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listDirectories(baseDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(baseDir, entry.name));
  } catch {
    return [];
  }
}

function probeTcp(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (isOpen: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(isOpen);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false));
    socket.once("error", () => finalize(false));
    socket.connect(port, host);
  });
}

function parsePackRefs(raw: string, source: string): Array<{ uuid: string; version: string; source: string }> {
  try {
    const data = JSON.parse(raw);
    const packs = Array.isArray(data) ? data : Array.isArray(data?.packs) ? data.packs : [];
    return packs
      .map((pack: any) => {
        const uuid = pack?.pack_id || pack?.uuid;
        const version = Array.isArray(pack?.version) ? pack.version.join(".") : String(pack?.version || "");
        if (!uuid) {
          return undefined;
        }
        return { uuid: String(uuid), version: version || "unknown", source };
      })
      .filter(Boolean) as Array<{ uuid: string; version: string; source: string }>;
  } catch {
    return [];
  }
}

export class MinecraftProvider implements GameProvider {
  private readonly config: Required<
    Pick<MinecraftProviderConfig, "providerId" | "name" | "version" | "serverId" | "serverName" | "host" | "javaPort" | "bedrockPort">
  > &
    MinecraftProviderConfig;

  private ready = false;
  private startedAt = Date.now();

  constructor(config: MinecraftProviderConfig) {
    this.config = {
      providerId: config.providerId || "minecraft",
      name: config.name || "Minecraft",
      version: config.version || "0.1.0",
      serverId: config.serverId || "minecraft-main",
      serverName: config.serverName || "Minecraft Server",
      host: config.host || "127.0.0.1",
      javaPort: config.javaPort ?? 25565,
      bedrockPort: config.bedrockPort ?? 19132,
      ...config,
    };
  }

  metadata(): ProviderMetadata {
    return {
      id: this.config.providerId,
      name: this.config.name,
      version: this.config.version,
      status: this.ready ? "ready" : "degraded",
    };
  }

  getCapabilities(): CapabilityMap {
    return {
      "server.start": true,
      "server.stop": true,
      "server.restart": true,
      "world.list": true,
      "world.import": false,
      "world.export": false,
      "content.list": true,
      "content.validate": true,
      "backup.create": false,
      "backup.restore": false,
      "player.list": false,
      "player.manage": false,
    };
  }

  async register(): Promise<void> {
    const paperDetected = await this.detectPaper();
    const geyserDetected = await this.detectGeyser();
    this.ready = paperDetected || geyserDetected;
  }

  async getServers(): Promise<ServerSummary[]> {
    return [
      {
        id: this.config.serverId,
        providerId: this.config.providerId,
        name: this.config.serverName,
      },
    ];
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    this.assertServerId(serverId);

    const online = await probeTcp(this.config.host, this.config.javaPort);
    return {
      status: online ? "online" : "offline",
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  async startServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServerId(serverId);
    if (!this.config.startCommand) {
      return {
        simulated: true,
        message: "No start command configured. Development-safe completion only.",
      };
    }

    await this.runShellCommand(this.config.startCommand);
    this.startedAt = Date.now();
    return { simulated: false, message: "Start command executed." };
  }

  async stopServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServerId(serverId);
    if (!this.config.stopCommand) {
      return {
        simulated: true,
        message: "No stop command configured. Development-safe completion only.",
      };
    }

    await this.runShellCommand(this.config.stopCommand);
    return { simulated: false, message: "Stop command executed." };
  }

  async restartServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServerId(serverId);
    await this.stopServer(serverId);
    return this.startServer(serverId);
  }

  async getWorlds(serverId: string): Promise<WorldSummary[]> {
    this.assertServerId(serverId);

    const candidateRoots = [
      path.join(this.config.serverDir, "worlds"),
      this.config.serverDir,
    ];

    const worlds: WorldSummary[] = [];
    for (const root of candidateRoots) {
      const dirs = await listDirectories(root);
      for (const dir of dirs) {
        const levelDat = path.join(dir, "level.dat");
        if (!(await exists(levelDat))) {
          continue;
        }
        worlds.push({
          id: path.basename(dir),
          name: path.basename(dir),
          path: dir,
        });
      }
      if (worlds.length > 0) {
        break;
      }
    }

    return worlds;
  }

  async validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
    this.assertServerId(serverId);

    const worlds = await this.getWorlds(serverId);
    const world = worlds.find((item) => item.id === worldId);
    if (!world) {
      return {
        valid: false,
        missingPacks: [],
        invalidPacks: [],
        errors: [{ type: "world_not_found", message: `World not found: ${worldId}` }],
      };
    }

    const behaviorRefPath = path.join(world.path, "world_behavior_packs.json");
    const resourceRefPath = path.join(world.path, "world_resource_packs.json");
    const refs = [
      ...(await this.readRefs(behaviorRefPath, "world_behavior_packs.json")),
      ...(await this.readRefs(resourceRefPath, "world_resource_packs.json")),
    ];

    const manifestIndex = await this.buildManifestIndex(world.path);

    const missingPacks: ValidationIssue[] = [];
    const invalidPacks: ValidationIssue[] = [];

    for (const ref of refs) {
      const manifest = manifestIndex.get(ref.uuid.toLowerCase());
      if (!manifest) {
        missingPacks.push({
          type: "missing_pack",
          uuid: ref.uuid,
          version: ref.version,
          source: ref.source,
          message: `Pack ${ref.uuid} referenced in ${ref.source} is not installed`,
        });
        continue;
      }
      if (ref.version !== "unknown" && manifest.version !== ref.version) {
        invalidPacks.push({
          type: "version_mismatch",
          uuid: ref.uuid,
          version: ref.version,
          source: ref.source,
          message: `Expected version ${ref.version}, installed ${manifest.version}`,
        });
      }
    }

    return {
      valid: missingPacks.length === 0 && invalidPacks.length === 0,
      missingPacks,
      invalidPacks,
      errors: [],
    };
  }

  private async detectPaper(): Promise<boolean> {
    const candidates = [
      path.join(this.config.serverDir, "paper.jar"),
      path.join(this.config.serverDir, "paperclip.jar"),
    ];

    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return true;
      }
    }

    try {
      const entries = await fs.readdir(this.config.serverDir);
      return entries.some((entry) => /^paper-.*\.jar$/i.test(entry));
    } catch {
      return false;
    }
  }

  private async detectGeyser(): Promise<boolean> {
    const pluginCandidates = [
      path.join(this.config.serverDir, "plugins", "Geyser-Spigot", "config.yml"),
      path.join(this.config.serverDir, "plugins", "Geyser", "config.yml"),
    ];

    for (const candidate of pluginCandidates) {
      if (await exists(candidate)) {
        return true;
      }
    }

    return false;
  }

  private async readRefs(filePath: string, source: string): Promise<Array<{ uuid: string; version: string; source: string }>> {
    if (!(await exists(filePath))) {
      return [];
    }

    const raw = await fs.readFile(filePath, "utf8");
    return parsePackRefs(raw, source);
  }

  private async buildManifestIndex(worldPath: string): Promise<Map<string, { version: string }>> {
    const roots = [
      path.join(worldPath, "behavior_packs"),
      path.join(worldPath, "resource_packs"),
      path.join(this.config.serverDir, "behavior_packs"),
      path.join(this.config.serverDir, "resource_packs"),
      path.join(this.config.serverDir, "packs"),
    ];

    const index = new Map<string, { version: string }>();

    for (const root of roots) {
      const dirs = await listDirectories(root);
      for (const dir of dirs) {
        const manifestPath = path.join(dir, "manifest.json");
        if (!(await exists(manifestPath))) {
          continue;
        }

        try {
          const raw = await fs.readFile(manifestPath, "utf8");
          const manifest = JSON.parse(raw);
          const uuid = manifest?.header?.uuid;
          const versionParts = manifest?.header?.version;
          const version = Array.isArray(versionParts) ? versionParts.join(".") : String(versionParts || "unknown");
          if (uuid) {
            index.set(String(uuid).toLowerCase(), { version });
          }
        } catch {
          // Skip malformed manifests and continue discovery.
        }
      }
    }

    return index;
  }

  private async runShellCommand(command: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, {
        cwd: this.config.serverDir,
        shell: true,
        stdio: "ignore",
      });

      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Command failed with exit code ${code}: ${command}`));
      });
    });
  }

  private assertServerId(serverId: string): void {
    if (serverId !== this.config.serverId) {
      throw new Error(`Unknown server: ${serverId}`);
    }
  }
}
