import { SyntheticProvisioningPlanner } from "./provisioning";
import {
  ConnectionEndpoint,
  CapabilityMap,
  GameProvider,
  ProviderActionResult,
  ProviderDiagnostics,
  ProviderMetadata,
  ProviderAccessEnforcementInput,
  ProviderOnlinePlayer,
  ProviderResolvedPlayerIdentity,
  ProviderPlayerLifecycleEvent,
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
  readonly provisioning: SyntheticProvisioningPlanner;
  private readonly providerId: string;
  private readonly providerName: string;
  private readonly providerVersion: string;
  private readonly serverId: string;
  private readonly serverName: string;
  private lifecycleState: ServerStatus["status"] = "offline";
  private readonly worlds: WorldSummary[];
  private readonly enforcementLog: ProviderAccessEnforcementInput[] = [];
  private readonly playerListeners = new Set<(event: ProviderPlayerLifecycleEvent) => void>();
  private readonly onlinePlayers = new Map<string, string>();

  constructor(config: SyntheticProviderConfig = {}) {
    this.providerId = config.providerId || "synthetic";
    this.provisioning = new SyntheticProvisioningPlanner(this.providerId);
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
      "server.provision.plan": true,
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
      "player.list": true,
      "player.manage": true,
      "player.access.enforce": true,
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

  async getServerConnectionEndpoints(serverId: string): Promise<ConnectionEndpoint[]> {
    this.assertServerId(serverId);
    return [
      {
        id: "control",
        protocol: "synthetic-control",
        transport: "virtual",
        uri: `synthetic://${this.serverId}`,
        display: `synthetic://${this.serverId}`,
        capabilities: ["simulate", "lifecycle-test"],
      },
    ];
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    this.assertServerId(serverId);
    return {
      status: this.lifecycleState,
      uptimeSeconds: this.lifecycleState === "online" ? 120 : 0,
      players: this.onlinePlayers.size,
    };
  }

  async resolvePlayerIdentity(
    serverId: string,
    hint: { externalPlayerId?: string; displayName?: string },
  ): Promise<ProviderResolvedPlayerIdentity | undefined> {
    this.assertServerId(serverId);
    if (!hint.externalPlayerId) {
      return undefined;
    }
    return {
      providerId: this.providerId,
      externalPlayerId: hint.externalPlayerId,
      displayName: hint.displayName || hint.externalPlayerId,
      identityType: "synthetic",
    };
  }

  async getOnlinePlayers(serverId: string): Promise<ProviderOnlinePlayer[]> {
    this.assertServerId(serverId);
    return [...this.onlinePlayers.entries()].map(([externalPlayerId, displayName]) => ({
      providerId: this.providerId,
      serverId,
      externalPlayerId,
      displayName,
      identityType: "synthetic",
    }));
  }

  async enforcePlayerAccess(input: ProviderAccessEnforcementInput): Promise<void> {
    this.assertServerId(input.serverId);
    this.enforcementLog.push({ ...input });
  }

  async disconnectPlayer(serverId: string, externalPlayerId: string, reason: string): Promise<void> {
    this.assertServerId(serverId);
    this.onlinePlayers.delete(externalPlayerId);
    this.emitPlayerEvent("player.left", externalPlayerId, externalPlayerId, reason);
  }

  subscribePlayerEvents(listener: (event: ProviderPlayerLifecycleEvent) => void): () => void {
    this.playerListeners.add(listener);
    return () => this.playerListeners.delete(listener);
  }

  simulatePlayerJoin(
    externalPlayerId: string,
    displayName = externalPlayerId,
    serverId = this.serverId,
    timestamp = new Date().toISOString(),
  ): void {
    this.assertServerId(serverId);
    this.onlinePlayers.set(externalPlayerId, displayName);
    this.emitPlayerEvent("player.joined", externalPlayerId, displayName, undefined, timestamp);
  }

  simulatePlayerLeave(externalPlayerId: string, serverId = this.serverId, timestamp = new Date().toISOString()): void {
    this.assertServerId(serverId);
    const displayName = this.onlinePlayers.get(externalPlayerId) || externalPlayerId;
    this.onlinePlayers.delete(externalPlayerId);
    this.emitPlayerEvent("player.left", externalPlayerId, displayName, undefined, timestamp);
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

  private emitPlayerEvent(
      type: ProviderPlayerLifecycleEvent["type"],
      externalPlayerId: string,
      displayName: string,
      reason?: string,
      timestamp = new Date().toISOString(),
    ): void {
      const event: ProviderPlayerLifecycleEvent = {
        type,
        providerId: this.providerId,
        serverId: this.serverId,
        externalPlayerId,
        displayName,
        identityType: "synthetic",
        timestamp,
        metadata: reason ? { reason } : undefined,
      };
      for (const listener of this.playerListeners) {
        listener(event);
    }
  }
}
