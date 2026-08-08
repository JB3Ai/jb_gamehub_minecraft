import {
  CapabilityMap,
  GameProvider,
  ProviderActionResult,
  ProviderDiagnostics,
  ProviderMetadata,
  ServerStatus,
  ServerSummary,
  ValidationResult,
  WorldSummary,
} from "../provider-manager/index";

interface SyntheticProviderConfig {
  providerId?: string;
  providerName?: string;
  providerVersion?: string;
  serverId?: string;
  serverName?: string;
}

export class SyntheticProvider implements GameProvider {
  private readonly providerId: string;
  private readonly providerName: string;
  private readonly providerVersion: string;
  private readonly serverId: string;
  private readonly serverName: string;
  private lifecycleState: ServerStatus["status"] = "offline";
  private readonly worlds: WorldSummary[];

  constructor(config: SyntheticProviderConfig = {}) {
    this.providerId = config.providerId || "synthetic";
    this.providerName = config.providerName || "Example Test Provider";
    this.providerVersion = config.providerVersion || "0.1.0";
    this.serverId = config.serverId || "synthetic-main";
    this.serverName = config.serverName || "Synthetic Test Server";
    this.worlds = [
      {
        id: "synthetic-lab-world",
        name: "synthetic-lab-world",
        path: "synthetic://worlds/synthetic-lab-world",
      },
    ];
  }

  metadata(): ProviderMetadata {
    return {
      id: this.providerId,
      name: this.providerName,
      version: this.providerVersion,
      status: "ready",
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

  async getDiagnostics(): Promise<ProviderDiagnostics> {
    return {
      paperDetected: false,
      geyserDetected: false,
    };
  }

  async register(): Promise<void> {
    this.lifecycleState = "offline";
  }

  async getServers(): Promise<ServerSummary[]> {
    return [
      {
        id: this.serverId,
        providerId: this.providerId,
        name: this.serverName,
      },
    ];
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    this.assertServerId(serverId);
    return {
      status: this.lifecycleState,
      uptimeSeconds: this.lifecycleState === "online" ? 120 : 0,
      players: 0,
    };
  }

  async startServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServerId(serverId);
    this.lifecycleState = "online";
    return {
      simulated: true,
      message: "Synthetic provider transitioned server to online.",
    };
  }

  async stopServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServerId(serverId);
    this.lifecycleState = "offline";
    return {
      simulated: true,
      message: "Synthetic provider transitioned server to offline.",
    };
  }

  async restartServer(serverId: string): Promise<ProviderActionResult> {
    this.assertServerId(serverId);
    this.lifecycleState = "online";
    return {
      simulated: true,
      message: "Synthetic provider restarted server.",
    };
  }

  async getWorlds(serverId: string): Promise<WorldSummary[]> {
    this.assertServerId(serverId);
    return this.worlds;
  }

  async validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
    this.assertServerId(serverId);
    const worldExists = this.worlds.some((world) => world.id === worldId);
    if (!worldExists) {
      return {
        valid: false,
        missingPacks: [],
        invalidPacks: [],
        errors: [
          {
            type: "world_not_found",
            message: `World not found: ${worldId}`,
          },
        ],
      };
    }

    return {
      valid: true,
      missingPacks: [],
      invalidPacks: [],
      errors: [],
      behaviorPackRefs: [
        {
          uuid: "synthetic-behavior-pack",
          version: "1.0.0",
          source: "synthetic-fixture",
        },
      ],
      resourcePackRefs: [
        {
          uuid: "synthetic-resource-pack",
          version: "1.0.0",
          source: "synthetic-fixture",
        },
      ],
    };
  }

  private assertServerId(serverId: string): void {
    if (serverId !== this.serverId) {
      throw new Error(`Unknown server: ${serverId}`);
    }
  }
}
