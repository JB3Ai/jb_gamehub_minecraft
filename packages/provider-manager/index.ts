export type OperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface OperationRef {
  operationId: string;
  status: OperationStatus;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  version: string;
  status: "ready" | "degraded" | "offline";
}

export type CapabilityMap = Record<string, boolean>;

export interface ServerSummary {
  id: string;
  providerId: string;
  name: string;
}

export interface ServerStatus {
  status: "online" | "offline" | "starting" | "stopping" | "error";
  players?: number;
  uptimeSeconds?: number;
}

export interface WorldSummary {
  id: string;
  name: string;
  path: string;
}

export interface ValidationIssue {
  type: string;
  uuid?: string;
  version?: string;
  source?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  missingPacks: ValidationIssue[];
  invalidPacks: ValidationIssue[];
  errors: ValidationIssue[];
}

export interface GameProvider {
  metadata(): ProviderMetadata;
  getCapabilities(): CapabilityMap;
  register(): Promise<void>;
  getServers(): Promise<ServerSummary[]>;
  getServerStatus(serverId: string): Promise<ServerStatus>;
  startServer(serverId: string): Promise<OperationRef>;
  stopServer(serverId: string): Promise<OperationRef>;
  restartServer(serverId: string): Promise<OperationRef>;
  getWorlds(serverId: string): Promise<WorldSummary[]>;
  validateWorld(serverId: string, worldId: string): Promise<ValidationResult>;
}

export class InMemoryProviderManager {
  private readonly providers = new Map<string, GameProvider>();

  async register(provider: GameProvider): Promise<void> {
    await provider.register();
    this.providers.set(provider.metadata().id, provider);
  }

  listProviders(): ProviderMetadata[] {
    return [...this.providers.values()].map((provider) => provider.metadata());
  }

  getProvider(providerId: string): GameProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    return provider;
  }

  getCapabilities(providerId: string): CapabilityMap {
    return this.getProvider(providerId).getCapabilities();
  }

  async listServers(providerId?: string): Promise<ServerSummary[]> {
    if (providerId) {
      return this.getProvider(providerId).getServers();
    }

    const serverGroups = await Promise.all([...this.providers.values()].map((provider) => provider.getServers()));
    return serverGroups.flat();
  }

  async getServer(serverId: string): Promise<ServerSummary | undefined> {
    const servers = await this.listServers();
    return servers.find((server) => server.id === serverId);
  }

  async startServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).startServer(serverId);
  }

  async stopServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).stopServer(serverId);
  }

  async restartServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).restartServer(serverId);
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).getServerStatus(serverId);
  }

  async getWorlds(serverId: string): Promise<WorldSummary[]> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).getWorlds(serverId);
  }

  async validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).validateWorld(serverId, worldId);
  }

  private async requireServer(serverId: string): Promise<ServerSummary> {
    const server = await this.getServer(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    return server;
  }
}
