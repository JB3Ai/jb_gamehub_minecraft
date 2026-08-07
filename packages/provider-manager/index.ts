export type OperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface OperationRef {
  operationId: string;
  status: OperationStatus;
}

export type OperationType = "server.start" | "server.stop" | "server.restart" | "world.validate";

export interface OperationError {
  code: string;
  message: string;
}

export interface OperationRecord {
  operationId: string;
  type: OperationType;
  providerId: string;
  serverId?: string;
  worldId?: string;
  status: OperationStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: OperationError;
  result?: unknown;
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

export type ProviderActionResult = {
  simulated?: boolean;
  message?: string;
};

export interface ProviderEvent<T = unknown> {
  type:
    | "server.status.changed"
    | "operation.created"
    | "operation.started"
    | "operation.completed"
    | "operation.failed"
    | "world.validation.completed";
  timestamp: string;
  providerId: string;
  serverId?: string;
  worldId?: string;
  status?: string;
  operationId?: string;
  payload?: T;
}

export interface GameProvider {
  metadata(): ProviderMetadata;
  getCapabilities(): CapabilityMap;
  register(): Promise<void>;
  getServers(): Promise<ServerSummary[]>;
  getServerStatus(serverId: string): Promise<ServerStatus>;
  startServer(serverId: string): Promise<ProviderActionResult | void>;
  stopServer(serverId: string): Promise<ProviderActionResult | void>;
  restartServer(serverId: string): Promise<ProviderActionResult | void>;
  getWorlds(serverId: string): Promise<WorldSummary[]>;
  validateWorld(serverId: string, worldId: string): Promise<ValidationResult>;
}

class InMemoryOperationManager {
  private readonly operations = new Map<string, OperationRecord>();

  create(input: Omit<OperationRecord, "operationId" | "status" | "createdAt">): OperationRecord {
    const op: OperationRecord = {
      operationId: `op_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      status: "queued",
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.operations.set(op.operationId, op);
    return op;
  }

  start(operationId: string): OperationRecord {
    const op = this.require(operationId);
    op.status = "running";
    op.startedAt = new Date().toISOString();
    return op;
  }

  complete(operationId: string, result?: unknown): OperationRecord {
    const op = this.require(operationId);
    op.status = "completed";
    op.completedAt = new Date().toISOString();
    op.result = result;
    return op;
  }

  fail(operationId: string, error: OperationError): OperationRecord {
    const op = this.require(operationId);
    op.status = "failed";
    op.completedAt = new Date().toISOString();
    op.error = error;
    return op;
  }

  get(operationId: string): OperationRecord | undefined {
    return this.operations.get(operationId);
  }

  private require(operationId: string): OperationRecord {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new Error(`Operation not found: ${operationId}`);
    }
    return op;
  }
}

class InMemoryEventBus {
  private readonly listeners = new Set<(event: ProviderEvent) => void>();

  publish(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: ProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class InMemoryProviderManager {
  private readonly providers = new Map<string, GameProvider>();
  private readonly operations = new InMemoryOperationManager();
  private readonly eventBus = new InMemoryEventBus();
  private readonly lastStatuses = new Map<string, ServerStatus["status"]>();

  async register(provider: GameProvider): Promise<void> {
    await provider.register();
    this.providers.set(provider.metadata().id, provider);
  }

  onEvent(listener: (event: ProviderEvent) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  getOperation(operationId: string): OperationRecord | undefined {
    return this.operations.get(operationId);
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
    const operation = this.operations.create({
      type: "server.start",
      providerId: server.providerId,
      serverId,
    });
    this.publishOperationEvent("operation.created", operation);

    this.operations.start(operation.operationId);
    this.publishOperationEvent("operation.started", operation);

    try {
      const result = await this.getProvider(server.providerId).startServer(serverId);
      const completed = this.operations.complete(operation.operationId, result ?? { simulated: true, message: "No start command configured" });
      this.publishOperationEvent("operation.completed", completed);
      return { operationId: completed.operationId, status: completed.status };
    } catch (err) {
      const failed = this.operations.fail(operation.operationId, {
        code: "SERVER_START_FAILED",
        message: err instanceof Error ? err.message : "Unknown start error",
      });
      this.publishOperationEvent("operation.failed", failed);
      return { operationId: failed.operationId, status: failed.status };
    }
  }

  async stopServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    const operation = this.operations.create({
      type: "server.stop",
      providerId: server.providerId,
      serverId,
    });
    this.publishOperationEvent("operation.created", operation);

    this.operations.start(operation.operationId);
    this.publishOperationEvent("operation.started", operation);

    try {
      const result = await this.getProvider(server.providerId).stopServer(serverId);
      const completed = this.operations.complete(operation.operationId, result ?? { simulated: true, message: "No stop command configured" });
      this.publishOperationEvent("operation.completed", completed);
      return { operationId: completed.operationId, status: completed.status };
    } catch (err) {
      const failed = this.operations.fail(operation.operationId, {
        code: "SERVER_STOP_FAILED",
        message: err instanceof Error ? err.message : "Unknown stop error",
      });
      this.publishOperationEvent("operation.failed", failed);
      return { operationId: failed.operationId, status: failed.status };
    }
  }

  async restartServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    const operation = this.operations.create({
      type: "server.restart",
      providerId: server.providerId,
      serverId,
    });
    this.publishOperationEvent("operation.created", operation);

    this.operations.start(operation.operationId);
    this.publishOperationEvent("operation.started", operation);

    try {
      const result = await this.getProvider(server.providerId).restartServer(serverId);
      const completed = this.operations.complete(operation.operationId, result ?? { simulated: true, message: "No restart command configured" });
      this.publishOperationEvent("operation.completed", completed);
      return { operationId: completed.operationId, status: completed.status };
    } catch (err) {
      const failed = this.operations.fail(operation.operationId, {
        code: "SERVER_RESTART_FAILED",
        message: err instanceof Error ? err.message : "Unknown restart error",
      });
      this.publishOperationEvent("operation.failed", failed);
      return { operationId: failed.operationId, status: failed.status };
    }
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const server = await this.requireServer(serverId);
    const current = await this.getProvider(server.providerId).getServerStatus(serverId);
    const previous = this.lastStatuses.get(serverId);
    if (previous !== current.status) {
      this.lastStatuses.set(serverId, current.status);
      this.eventBus.publish({
        type: "server.status.changed",
        timestamp: new Date().toISOString(),
        providerId: server.providerId,
        serverId,
        status: current.status,
      });
    }
    return current;
  }

  async getWorlds(serverId: string): Promise<WorldSummary[]> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).getWorlds(serverId);
  }

  async validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
    const server = await this.requireServer(serverId);
    const operation = this.operations.create({
      type: "world.validate",
      providerId: server.providerId,
      serverId,
      worldId,
    });
    this.publishOperationEvent("operation.created", operation);

    this.operations.start(operation.operationId);
    this.publishOperationEvent("operation.started", operation);

    try {
      const result = await this.getProvider(server.providerId).validateWorld(serverId, worldId);
      const completed = this.operations.complete(operation.operationId, result);
      this.publishOperationEvent("operation.completed", completed);
      this.eventBus.publish({
        type: "world.validation.completed",
        timestamp: new Date().toISOString(),
        providerId: server.providerId,
        serverId,
        worldId,
        operationId: completed.operationId,
        payload: result,
      });
      return result;
    } catch (err) {
      const failed = this.operations.fail(operation.operationId, {
        code: "WORLD_VALIDATION_FAILED",
        message: err instanceof Error ? err.message : "Unknown world validation error",
      });
      this.publishOperationEvent("operation.failed", failed);
      throw err;
    }
  }

  private publishOperationEvent(
    type: Extract<ProviderEvent["type"], "operation.created" | "operation.started" | "operation.completed" | "operation.failed">,
    operation: OperationRecord,
  ): void {
    this.eventBus.publish({
      type,
      timestamp: new Date().toISOString(),
      providerId: operation.providerId,
      serverId: operation.serverId,
      worldId: operation.worldId,
      operationId: operation.operationId,
      status: operation.status,
      payload: operation,
    });
  }

  private async requireServer(serverId: string): Promise<ServerSummary> {
    const server = await this.getServer(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    return server;
  }
}
