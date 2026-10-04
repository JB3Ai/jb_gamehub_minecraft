import { parseProvisioningRequest, ProvisioningCapabilityError, type ProvisioningPlanner, type ServerProvisioningPlan } from "../core/provisioning";
import type {
  ChildProfile,
  Family,
  FamilyPlaytimeSummary,
  ParentMembership,
  ParentOverride,
  ParentalRule,
  PlaySession,
  PlayerIdentity,
  PolicyDecision,
  ProviderAccessEnforcementInput,
  ProviderOnlinePlayer,
  ProviderResolvedPlayerIdentity,
  ProviderPlayerLifecycleEvent,
  RewardLedgerEntry,
  RewardLedgerEntryType,
  RewardLedgerRepository,
  RewardType,
  ResolvedEntitlements,
} from "./family-types";

export type {
  ChildProfile,
  Family,
  FamilyPlaytimeSummary,
  ParentMembership,
  ParentOverride,
  ParentalRule,
  PlaySession,
  PlayerIdentity,
  PolicyDecision,
  ProviderAccessEnforcementInput,
  ProviderOnlinePlayer,
  ProviderResolvedPlayerIdentity,
  ProviderPlayerLifecycleEvent,
  RewardLedgerEntry,
  RewardLedgerEntryType,
  RewardLedgerRepository,
  RewardType,
  ResolvedEntitlements,
} from "./family-types";

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

export interface OperationQuery {
  providerId?: string;
  serverId?: string;
  operationId?: string;
  type?: OperationType;
  state?: OperationStatus;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  version: string;
  status: "ready" | "degraded" | "offline";
}

export interface ConnectionEndpoint {
  id: string;
  protocol: string;
  transport: "tcp" | "udp" | "virtual";
  display: string;
  host?: string;
  port?: number;
  uri?: string;
  capabilities?: string[];
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

export interface PackReference {
  uuid: string;
  version: string;
  source: string;
}

export interface ValidationResult {
  valid: boolean;
  missingPacks: ValidationIssue[];
  invalidPacks: ValidationIssue[];
  errors: ValidationIssue[];
  behaviorPackRefs?: PackReference[];
  resourcePackRefs?: PackReference[];
}

export type ProviderActionResult = {
  simulated?: boolean;
  message?: string;
};

export interface ProviderDiagnostics {
  paperDetected: boolean;
  geyserDetected: boolean;
}

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

export interface EventRecord {
  id: string;
  providerId?: string;
  serverId?: string;
  operationId?: string;
  type: ProviderEvent["type"];
  timestamp: string;
  payload?: unknown;
}

export interface EventQuery {
  providerId?: string;
  serverId?: string;
  operationId?: string;
  type?: ProviderEvent["type"];
  from?: string;
  to?: string;
  limit?: number;
}

export interface ServerStateSnapshot {
  providerId: string;
  serverId: string;
  status: ServerStatus["status"];
  availability: boolean;
  lastSeenAt: string;
  metadata?: Record<string, unknown>;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action:
    | "server.start.requested"
    | "server.stop.requested"
    | "server.restart.requested"
    | "world.validation.requested"
    | "history.cleanup.requested"
    | "ai.query.requested"
    | "family.created"
    | "parent.membership.created"
    | "child.created"
    | "identity.linked"
    | "rule.created"
    | "rule.updated"
    | "rule.disabled"
    | "policy.allowed"
    | "policy.denied"
    | "session.started"
    | "session.ended"
    | "override.created"
    | "override.expired"
    | "override.revoked"
    | "reward.granted"
    | "reward.redeemed"
    | "reward.revoked";
  providerId?: string;
  serverId?: string;
  operationId?: string;
  result: "completed" | "failed";
  metadata?: Record<string, unknown>;
}

export interface AuditWriteInput {
  actor: string;
  action: AuditRecord["action"];
  providerId?: string;
  serverId?: string;
  operationId?: string;
  result: AuditRecord["result"];
  metadata?: Record<string, unknown>;
}

export interface RetentionPolicy {
  operationRetentionDays: number;
  eventRetentionDays: number;
  auditRetentionDays: number;
}

export interface RetentionCleanupResult {
  operationsDeleted: number;
  eventsDeleted: number;
  auditDeleted: number;
}

export interface HistoryStorageStats {
  databaseSizeBytes?: number;
  oldestOperationAt?: string;
  oldestEventAt?: string;
  oldestAuditAt?: string;
}

export interface RetentionCleanupSummary {
  cleanup: RetentionCleanupResult;
  policy: RetentionPolicy;
  executedAt: string;
  cutoff: {
    operationsBefore: string;
    eventsBefore: string;
    auditsBefore: string;
  };
}

export interface PersistenceRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createOperation(operation: OperationRecord): Promise<void>;
  updateOperation(operation: OperationRecord): Promise<void>;
  getOperation(operationId: string): Promise<OperationRecord | undefined>;
  listOperations(query?: OperationQuery): Promise<OperationRecord[]>;
  appendEvent(event: EventRecord): Promise<void>;
  listEvents(query?: EventQuery): Promise<EventRecord[]>;
  upsertServerState(snapshot: ServerStateSnapshot): Promise<void>;
  listServerStates(): Promise<ServerStateSnapshot[]>;
  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(query?: { providerId?: string; serverId?: string; operationId?: string; action?: AuditRecord["action"]; limit?: number }): Promise<AuditRecord[]>;
  cleanupExpired(policy: RetentionPolicy, nowIso: string): Promise<RetentionCleanupResult>;
  getHistoryStorageStats(): Promise<HistoryStorageStats>;

  createFamily(family: Family): Promise<void>;
  listFamilies(): Promise<Family[]>;
  getFamily(familyId: string): Promise<Family | undefined>;

  createParentMembership(parent: ParentMembership): Promise<void>;
  listParentMemberships(familyId: string): Promise<ParentMembership[]>;

  createChildProfile(child: ChildProfile): Promise<void>;
  upsertChildProfile(child: ChildProfile): Promise<void>;
  listChildProfiles(familyId: string): Promise<ChildProfile[]>;
  getChildProfile(childId: string): Promise<ChildProfile | undefined>;

  createPlayerIdentity(identity: PlayerIdentity): Promise<void>;
  listPlayerIdentitiesByChild(childId: string): Promise<PlayerIdentity[]>;

  createParentalRule(rule: ParentalRule): Promise<void>;
  upsertParentalRule(rule: ParentalRule): Promise<void>;
  getParentalRule(ruleId: string): Promise<ParentalRule | undefined>;
  listParentalRulesByChild(childId: string): Promise<ParentalRule[]>;

  createPlaySession(session: PlaySession): Promise<void>;
  upsertPlaySession(session: PlaySession): Promise<void>;
  getPlaySession(sessionId: string): Promise<PlaySession | undefined>;
  listPlaySessions(query?: {
    childId?: string;
    providerId?: string;
    serverId?: string;
    from?: string;
    to?: string;
    status?: PlaySession["status"];
    includeActive?: boolean;
    limit?: number;
  }): Promise<PlaySession[]>;
  findActivePlaySession(childId: string, providerId: string, serverId: string, playerIdentityId?: string): Promise<PlaySession | undefined>;

  createParentOverride(override: ParentOverride): Promise<void>;
  upsertParentOverride(override: ParentOverride): Promise<void>;
  getParentOverride(overrideId: string): Promise<ParentOverride | undefined>;
  listParentOverrides(query?: { childId?: string; activeAt?: string; limit?: number }): Promise<ParentOverride[]>;
  createRewardLedgerEntry?(entry: RewardLedgerEntry): Promise<void>;
  listRewardLedger?(query?: { childId?: string; rewardId?: string; limit?: number }): Promise<RewardLedgerEntry[]>;
}

export interface GameProvider {
  readonly provisioning?: ProvisioningPlanner;
  metadata(): ProviderMetadata;
  getCapabilities(): CapabilityMap;
  getDiagnostics(): Promise<ProviderDiagnostics>;
  register(): Promise<void>;
  getServers(): Promise<ServerSummary[]>;
  getServerConnectionEndpoints(serverId: string): Promise<ConnectionEndpoint[]>;
  getServerStatus(serverId: string): Promise<ServerStatus>;
  resolvePlayerIdentity?(serverId: string, hint: { externalPlayerId?: string; displayName?: string }): Promise<ProviderResolvedPlayerIdentity | undefined>;
  getOnlinePlayers?(serverId: string): Promise<ProviderOnlinePlayer[]>;
  enforcePlayerAccess?(input: ProviderAccessEnforcementInput): Promise<void>;
  disconnectPlayer?(serverId: string, externalPlayerId: string, reason: string): Promise<void>;
  subscribePlayerEvents?(listener: (event: ProviderPlayerLifecycleEvent) => void): () => void;
  startServer(serverId: string): Promise<ProviderActionResult | void>;
  stopServer(serverId: string): Promise<ProviderActionResult | void>;
  restartServer(serverId: string): Promise<ProviderActionResult | void>;
  getWorlds(serverId: string): Promise<WorldSummary[]>;
  validateWorld(serverId: string, worldId: string): Promise<ValidationResult>;
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

function createStableId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

class InMemoryPersistenceRepository implements PersistenceRepository {
  private readonly operations = new Map<string, OperationRecord>();
  private readonly events: EventRecord[] = [];
  private readonly states = new Map<string, ServerStateSnapshot>();
  private readonly audits: AuditRecord[] = [];
  private readonly families = new Map<string, Family>();
  private readonly parents = new Map<string, ParentMembership>();
  private readonly children = new Map<string, ChildProfile>();
  private readonly identities = new Map<string, PlayerIdentity>();
  private readonly rules = new Map<string, ParentalRule>();
  private readonly sessions = new Map<string, PlaySession>();
  private readonly overrides = new Map<string, ParentOverride>();
  private readonly rewardLedger: RewardLedgerEntry[] = [];

  async initialize(): Promise<void> {
    // No-op.
  }

  async close(): Promise<void> {
    // No-op.
  }

  async createOperation(operation: OperationRecord): Promise<void> {
    this.operations.set(operation.operationId, { ...operation });
  }

  async updateOperation(operation: OperationRecord): Promise<void> {
    this.operations.set(operation.operationId, { ...operation });
  }

  async getOperation(operationId: string): Promise<OperationRecord | undefined> {
    const op = this.operations.get(operationId);
    return op ? { ...op } : undefined;
  }

  async listOperations(query?: OperationQuery): Promise<OperationRecord[]> {
    let list = [...this.operations.values()];
    if (query?.providerId) {
      list = list.filter((item) => item.providerId === query.providerId);
    }
    if (query?.serverId) {
      list = list.filter((item) => item.serverId === query.serverId);
    }
    if (query?.operationId) {
      list = list.filter((item) => item.operationId === query.operationId);
    }
    if (query?.type) {
      list = list.filter((item) => item.type === query.type);
    }
    if (query?.state) {
      list = list.filter((item) => item.status === query.state);
    }
    if (query?.from) {
      list = list.filter((item) => item.createdAt >= query.from!);
    }
    if (query?.to) {
      list = list.filter((item) => item.createdAt <= query.to!);
    }
    list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return query?.limit ? list.slice(0, query.limit) : list;
  }

  async appendEvent(event: EventRecord): Promise<void> {
    this.events.unshift({ ...event });
  }

  async listEvents(query?: EventQuery): Promise<EventRecord[]> {
    let list = [...this.events];
    if (query?.providerId) {
      list = list.filter((item) => item.providerId === query.providerId);
    }
    if (query?.serverId) {
      list = list.filter((item) => item.serverId === query.serverId);
    }
    if (query?.operationId) {
      list = list.filter((item) => item.operationId === query.operationId);
    }
    if (query?.type) {
      list = list.filter((item) => item.type === query.type);
    }
    if (query?.from) {
      list = list.filter((item) => item.timestamp >= query.from!);
    }
    if (query?.to) {
      list = list.filter((item) => item.timestamp <= query.to!);
    }
    return query?.limit ? list.slice(0, query.limit) : list;
  }

  async upsertServerState(snapshot: ServerStateSnapshot): Promise<void> {
    this.states.set(`${snapshot.providerId}::${snapshot.serverId}`, { ...snapshot });
  }

  async listServerStates(): Promise<ServerStateSnapshot[]> {
    return [...this.states.values()].map((item) => ({ ...item }));
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    this.audits.unshift({ ...record });
  }

  async listAudit(query?: { providerId?: string; serverId?: string; operationId?: string; action?: AuditRecord["action"]; limit?: number }): Promise<AuditRecord[]> {
    let list = [...this.audits];
    if (query?.providerId) {
      list = list.filter((item) => item.providerId === query.providerId);
    }
    if (query?.serverId) {
      list = list.filter((item) => item.serverId === query.serverId);
    }
    if (query?.operationId) {
      list = list.filter((item) => item.operationId === query.operationId);
    }
    if (query?.action) {
      list = list.filter((item) => item.action === query.action);
    }
    return query?.limit ? list.slice(0, query.limit) : list;
  }

  async cleanupExpired(_policy: RetentionPolicy, _nowIso: string): Promise<RetentionCleanupResult> {
    return {
      operationsDeleted: 0,
      eventsDeleted: 0,
      auditDeleted: 0,
    };
  }

  async getHistoryStorageStats(): Promise<HistoryStorageStats> {
    const oldestOperationAt = [...this.operations.values()].map((item) => item.createdAt).sort()[0];
    const oldestEventAt = this.events.map((item) => item.timestamp).sort()[0];
    const oldestAuditAt = this.audits.map((item) => item.timestamp).sort()[0];
    return {
      oldestOperationAt,
      oldestEventAt,
      oldestAuditAt,
    };
  }

  async createFamily(family: Family): Promise<void> {
    this.families.set(family.id, { ...family });
  }

  async listFamilies(): Promise<Family[]> {
    return [...this.families.values()].map((item) => ({ ...item }));
  }

  async getFamily(familyId: string): Promise<Family | undefined> {
    const family = this.families.get(familyId);
    return family ? { ...family } : undefined;
  }

  async createParentMembership(parent: ParentMembership): Promise<void> {
    this.parents.set(parent.id, { ...parent });
  }

  async listParentMemberships(familyId: string): Promise<ParentMembership[]> {
    return [...this.parents.values()].filter((item) => item.familyId === familyId).map((item) => ({ ...item }));
  }

  async createChildProfile(child: ChildProfile): Promise<void> {
    this.children.set(child.id, { ...child });
  }

  async upsertChildProfile(child: ChildProfile): Promise<void> {
    this.children.set(child.id, { ...child });
  }

  async listChildProfiles(familyId: string): Promise<ChildProfile[]> {
    return [...this.children.values()].filter((item) => item.familyId === familyId).map((item) => ({ ...item }));
  }

  async getChildProfile(childId: string): Promise<ChildProfile | undefined> {
    const child = this.children.get(childId);
    return child ? { ...child } : undefined;
  }

  async createPlayerIdentity(identity: PlayerIdentity): Promise<void> {
    this.identities.set(identity.id, { ...identity });
  }

  async listPlayerIdentitiesByChild(childId: string): Promise<PlayerIdentity[]> {
    return [...this.identities.values()].filter((item) => item.childId === childId).map((item) => ({ ...item }));
  }

  async createParentalRule(rule: ParentalRule): Promise<void> {
    this.rules.set(rule.id, { ...rule });
  }

  async upsertParentalRule(rule: ParentalRule): Promise<void> {
    this.rules.set(rule.id, { ...rule });
  }

  async getParentalRule(ruleId: string): Promise<ParentalRule | undefined> {
    const rule = this.rules.get(ruleId);
    return rule ? { ...rule } : undefined;
  }

  async listParentalRulesByChild(childId: string): Promise<ParentalRule[]> {
    return [...this.rules.values()].filter((item) => item.childId === childId).map((item) => ({ ...item }));
  }

  async createPlaySession(session: PlaySession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async upsertPlaySession(session: PlaySession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async getPlaySession(sessionId: string): Promise<PlaySession | undefined> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  async listPlaySessions(
    query: {
      childId?: string;
      providerId?: string;
      serverId?: string;
      from?: string;
      to?: string;
      status?: PlaySession["status"];
      includeActive?: boolean;
      limit?: number;
    } = {},
  ): Promise<PlaySession[]> {
    let list = [...this.sessions.values()];
    if (query.childId) {
      list = list.filter((item) => item.childId === query.childId);
    }
    if (query.providerId) {
      list = list.filter((item) => item.providerId === query.providerId);
    }
    if (query.serverId) {
      list = list.filter((item) => item.serverId === query.serverId);
    }
    if (query.status) {
      list = list.filter((item) => item.status === query.status);
    }
    if (!query.includeActive) {
      list = list.filter((item) => item.status !== "active");
    }
    if (query.from) {
      list = list.filter((item) => item.startedAt >= query.from!);
    }
    if (query.to) {
      list = list.filter((item) => item.startedAt <= query.to!);
    }
    list.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return (query.limit ? list.slice(0, query.limit) : list).map((item) => ({ ...item }));
  }

  async findActivePlaySession(
    childId: string,
    providerId: string,
    serverId: string,
    playerIdentityId?: string,
  ): Promise<PlaySession | undefined> {
    const session = [...this.sessions.values()].find(
      (item) =>
        item.childId === childId &&
        item.providerId === providerId &&
        item.serverId === serverId &&
        item.status === "active" &&
        (!playerIdentityId || item.playerIdentityId === playerIdentityId),
    );
    return session ? { ...session } : undefined;
  }

  async createParentOverride(override: ParentOverride): Promise<void> {
    this.overrides.set(override.id, { ...override });
  }

  async upsertParentOverride(override: ParentOverride): Promise<void> {
    this.overrides.set(override.id, { ...override });
  }

  async getParentOverride(overrideId: string): Promise<ParentOverride | undefined> {
    const value = this.overrides.get(overrideId);
    return value ? { ...value } : undefined;
  }

  async listParentOverrides(query: { childId?: string; activeAt?: string; limit?: number } = {}): Promise<ParentOverride[]> {
    let list = [...this.overrides.values()];
    if (query.childId) {
      list = list.filter((item) => item.childId === query.childId);
    }
    if (query.activeAt) {
      const at = Date.parse(query.activeAt);
      list = list.filter((item) => !item.revokedAt && Date.parse(item.startsAt) <= at && Date.parse(item.expiresAt) >= at);
    }
    list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return (query.limit ? list.slice(0, query.limit) : list).map((item) => ({ ...item }));
  }

  async createRewardLedgerEntry(entry: RewardLedgerEntry): Promise<void> {
    this.rewardLedger.unshift({
      ...entry,
      providerIds: entry.providerIds ? [...entry.providerIds] : undefined,
      serverIds: entry.serverIds ? [...entry.serverIds] : undefined,
    });
  }

  async listRewardLedger(query: { childId?: string; rewardId?: string; limit?: number } = {}): Promise<RewardLedgerEntry[]> {
    let list = this.rewardLedger;
    if (query.childId) list = list.filter((item) => item.childId === query.childId);
    if (query.rewardId) list = list.filter((item) => item.rewardId === query.rewardId);
    return (query.limit ? list.slice(0, query.limit) : list).map((item) => ({
      ...item,
      providerIds: item.providerIds ? [...item.providerIds] : undefined,
      serverIds: item.serverIds ? [...item.serverIds] : undefined,
    }));
  }
}

class OperationEventService {
  private readonly durableEvents = new Set<ProviderEvent["type"]>([
    "operation.created",
    "operation.started",
    "operation.completed",
    "operation.failed",
    "server.status.changed",
    "world.validation.completed",
  ]);

  constructor(
    private readonly repository: PersistenceRepository,
    private readonly eventBus: InMemoryEventBus,
    private readonly operationCache: Map<string, OperationRecord>,
  ) {}

  async loadRecentOperations(limit = 300): Promise<void> {
    const operations = await this.repository.listOperations({ limit });
    for (const operation of operations) {
      this.operationCache.set(operation.operationId, operation);
    }
  }

  async createOperation(input: Omit<OperationRecord, "operationId" | "status" | "createdAt">): Promise<OperationRecord> {
    const operation: OperationRecord = {
      operationId: createStableId("op"),
      status: "queued",
      createdAt: new Date().toISOString(),
      ...input,
    };
    await this.repository.createOperation(operation);
    this.operationCache.set(operation.operationId, operation);
    await this.publish({
      type: "operation.created",
      timestamp: new Date().toISOString(),
      providerId: operation.providerId,
      serverId: operation.serverId,
      worldId: operation.worldId,
      operationId: operation.operationId,
      status: operation.status,
      payload: operation,
    });
    return operation;
  }

  async startOperation(operation: OperationRecord): Promise<OperationRecord> {
    const started: OperationRecord = {
      ...operation,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await this.repository.updateOperation(started);
    this.operationCache.set(started.operationId, started);
    await this.publish({
      type: "operation.started",
      timestamp: new Date().toISOString(),
      providerId: started.providerId,
      serverId: started.serverId,
      worldId: started.worldId,
      operationId: started.operationId,
      status: started.status,
      payload: started,
    });
    return started;
  }

  async completeOperation(operation: OperationRecord, result?: unknown): Promise<OperationRecord> {
    const completed: OperationRecord = {
      ...operation,
      status: "completed",
      completedAt: new Date().toISOString(),
      result,
    };
    await this.repository.updateOperation(completed);
    this.operationCache.set(completed.operationId, completed);
    await this.publish({
      type: "operation.completed",
      timestamp: new Date().toISOString(),
      providerId: completed.providerId,
      serverId: completed.serverId,
      worldId: completed.worldId,
      operationId: completed.operationId,
      status: completed.status,
      payload: completed,
    });
    return completed;
  }

  async failOperation(operation: OperationRecord, error: OperationError): Promise<OperationRecord> {
    const failed: OperationRecord = {
      ...operation,
      status: "failed",
      completedAt: new Date().toISOString(),
      error,
    };
    await this.repository.updateOperation(failed);
    this.operationCache.set(failed.operationId, failed);
    await this.publish({
      type: "operation.failed",
      timestamp: new Date().toISOString(),
      providerId: failed.providerId,
      serverId: failed.serverId,
      worldId: failed.worldId,
      operationId: failed.operationId,
      status: failed.status,
      payload: failed,
    });
    return failed;
  }

  async publish(event: ProviderEvent): Promise<void> {
    if (this.durableEvents.has(event.type)) {
      const durablePayload =
        event.payload !== undefined
          ? event.payload
          : {
              ...(event.status ? { status: event.status } : {}),
              ...(event.worldId ? { worldId: event.worldId } : {}),
            };
      await this.repository.appendEvent({
        id: createStableId("evt"),
        providerId: event.providerId,
        serverId: event.serverId,
        operationId: event.operationId,
        type: event.type,
        timestamp: event.timestamp,
        payload: durablePayload,
      });
    }
    this.eventBus.publish(event);
  }

  async writeServerState(snapshot: ServerStateSnapshot): Promise<void> {
    await this.repository.upsertServerState(snapshot);
  }

  async writeAudit(input: AuditWriteInput): Promise<void> {
    await this.repository.appendAudit({
      id: createStableId("audit"),
      timestamp: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      providerId: input.providerId,
      serverId: input.serverId,
      operationId: input.operationId,
      result: input.result,
      metadata: input.metadata,
    });
  }
}

export interface ProviderManagerHistory {
  providerId: string;
  serverId: string;
  state?: ServerStateSnapshot;
  operations: OperationRecord[];
  events: EventRecord[];
  audits: AuditRecord[];
}

export interface ProviderManagerOptions {
  repository?: PersistenceRepository;
  defaultActor?: string;
}

export class InMemoryProviderManager {
  private readonly providers = new Map<string, GameProvider>();
  private readonly eventBus = new InMemoryEventBus();
  private readonly operations = new Map<string, OperationRecord>();
  private readonly lastStatuses = new Map<string, ServerStatus["status"]>();
  private readonly repository: PersistenceRepository;
  private readonly service: OperationEventService;
  private readonly defaultActor: string;
  private readonly playerEventListeners = new Set<(event: ProviderPlayerLifecycleEvent) => void>();
  private readonly providerPlayerUnsubscribers = new Map<string, () => void>();

  constructor(options: ProviderManagerOptions = {}) {
    this.repository = options.repository ?? new InMemoryPersistenceRepository();
    this.service = new OperationEventService(this.repository, this.eventBus, this.operations);
    this.defaultActor = options.defaultActor || "local-admin";
  }

  async initialize(): Promise<void> {
    await this.repository.initialize();
    await this.service.loadRecentOperations();
    const states = await this.repository.listServerStates();
    for (const state of states) {
      this.lastStatuses.set(`${state.providerId}::${state.serverId}`, state.status);
    }
  }

  async shutdown(): Promise<void> {
    for (const unsubscribe of this.providerPlayerUnsubscribers.values()) {
      unsubscribe();
    }
    this.providerPlayerUnsubscribers.clear();
    await this.repository.close();
  }

  async register(provider: GameProvider): Promise<void> {
    await provider.register();
    this.providers.set(provider.metadata().id, provider);
    if (provider.subscribePlayerEvents) {
      this.providerPlayerUnsubscribers.set(
        provider.metadata().id,
        provider.subscribePlayerEvents((event) => {
          for (const listener of this.playerEventListeners) {
            listener(event);
          }
        }),
      );
    }
  }

  onEvent(listener: (event: ProviderEvent) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  onPlayerEvent(listener: (event: ProviderPlayerLifecycleEvent) => void): () => void {
    this.playerEventListeners.add(listener);
    return () => {
      this.playerEventListeners.delete(listener);
    };
  }

  async getOperation(operationId: string): Promise<OperationRecord | undefined> {
    const fromCache = this.operations.get(operationId);
    if (fromCache) {
      return fromCache;
    }
    return this.repository.getOperation(operationId);
  }

  async listOperations(query: OperationQuery = {}): Promise<OperationRecord[]> {
    return this.repository.listOperations(query);
  }

  async listEvents(query: EventQuery = {}): Promise<EventRecord[]> {
    return this.repository.listEvents(query);
  }

  async listAudits(
    query: { providerId?: string; serverId?: string; operationId?: string; action?: AuditRecord["action"]; limit?: number } = {},
  ): Promise<AuditRecord[]> {
    return this.repository.listAudit(query);
  }

  async writeAudit(input: AuditWriteInput): Promise<void> {
    await this.service.writeAudit(input);
  }

  async listServerStates(): Promise<ServerStateSnapshot[]> {
    return this.repository.listServerStates();
  }

  async getHistoryStorageStats(): Promise<HistoryStorageStats> {
    return this.repository.getHistoryStorageStats();
  }

  async createFamily(family: Family): Promise<void> {
    await this.repository.createFamily(family);
  }

  async listFamilies(): Promise<Family[]> {
    return this.repository.listFamilies();
  }

  async getFamily(familyId: string): Promise<Family | undefined> {
    return this.repository.getFamily(familyId);
  }

  async createParentMembership(parent: ParentMembership): Promise<void> {
    await this.repository.createParentMembership(parent);
  }

  async listParentMemberships(familyId: string): Promise<ParentMembership[]> {
    return this.repository.listParentMemberships(familyId);
  }

  async createChildProfile(child: ChildProfile): Promise<void> {
    await this.repository.createChildProfile(child);
  }

  async upsertChildProfile(child: ChildProfile): Promise<void> {
    await this.repository.upsertChildProfile(child);
  }

  async listChildProfiles(familyId: string): Promise<ChildProfile[]> {
    return this.repository.listChildProfiles(familyId);
  }

  async getChildProfile(childId: string): Promise<ChildProfile | undefined> {
    return this.repository.getChildProfile(childId);
  }

  async createPlayerIdentity(identity: PlayerIdentity): Promise<void> {
    await this.repository.createPlayerIdentity(identity);
  }

  async listPlayerIdentitiesByChild(childId: string): Promise<PlayerIdentity[]> {
    return this.repository.listPlayerIdentitiesByChild(childId);
  }

  async createParentalRule(rule: ParentalRule): Promise<void> {
    await this.repository.createParentalRule(rule);
  }

  async upsertParentalRule(rule: ParentalRule): Promise<void> {
    await this.repository.upsertParentalRule(rule);
  }

  async getParentalRule(ruleId: string): Promise<ParentalRule | undefined> {
    return this.repository.getParentalRule(ruleId);
  }

  async listParentalRulesByChild(childId: string): Promise<ParentalRule[]> {
    return this.repository.listParentalRulesByChild(childId);
  }

  async createPlaySession(session: PlaySession): Promise<void> {
    await this.repository.createPlaySession(session);
  }

  async upsertPlaySession(session: PlaySession): Promise<void> {
    await this.repository.upsertPlaySession(session);
  }

  async getPlaySession(sessionId: string): Promise<PlaySession | undefined> {
    return this.repository.getPlaySession(sessionId);
  }

  async listPlaySessions(query: {
    childId?: string;
    providerId?: string;
    serverId?: string;
    from?: string;
    to?: string;
    status?: PlaySession["status"];
    includeActive?: boolean;
    limit?: number;
  } = {}): Promise<PlaySession[]> {
    return this.repository.listPlaySessions(query);
  }

  async findActivePlaySession(
    childId: string,
    providerId: string,
    serverId: string,
    playerIdentityId?: string,
  ): Promise<PlaySession | undefined> {
    return this.repository.findActivePlaySession(childId, providerId, serverId, playerIdentityId);
  }

  async createParentOverride(override: ParentOverride): Promise<void> {
    await this.repository.createParentOverride(override);
  }

  async upsertParentOverride(override: ParentOverride): Promise<void> {
    await this.repository.upsertParentOverride(override);
  }

  async getParentOverride(overrideId: string): Promise<ParentOverride | undefined> {
    return this.repository.getParentOverride(overrideId);
  }

  async listParentOverrides(query: { childId?: string; activeAt?: string; limit?: number } = {}): Promise<ParentOverride[]> {
    return this.repository.listParentOverrides(query);
  }

  async createRewardLedgerEntry(entry: RewardLedgerEntry): Promise<void> {
    if (!this.repository.createRewardLedgerEntry) {
      throw new Error("Rewards persistence is not supported by this repository");
    }
    await this.repository.createRewardLedgerEntry(entry);
  }

  async listRewardLedger(query: { childId?: string; rewardId?: string; limit?: number } = {}): Promise<RewardLedgerEntry[]> {
    if (!this.repository.listRewardLedger) {
      return [];
    }
    return this.repository.listRewardLedger(query);
  }

  async getServerHistory(providerId: string, serverId: string, limit = 100): Promise<ProviderManagerHistory> {
    const state = (await this.repository.listServerStates()).find((item) => item.providerId === providerId && item.serverId === serverId);
    const operations = await this.repository.listOperations({ providerId, serverId, limit });
    const events = await this.repository.listEvents({ providerId, serverId, limit });
    const audits = await this.repository.listAudit({ providerId, serverId, limit });
    return {
      providerId,
      serverId,
      state,
      operations,
      events,
      audits,
    };
  }

  async cleanupHistory(policy: RetentionPolicy, actor = this.defaultActor): Promise<RetentionCleanupSummary> {
    const executedAt = new Date().toISOString();
    const operationsBefore = new Date(Date.parse(executedAt) - policy.operationRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const eventsBefore = new Date(Date.parse(executedAt) - policy.eventRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const auditsBefore = new Date(Date.parse(executedAt) - policy.auditRetentionDays * 24 * 60 * 60 * 1000).toISOString();

    const cleanup = await this.repository.cleanupExpired(policy, executedAt);
    await this.service.writeAudit({
      actor,
      action: "history.cleanup.requested",
      result: "completed",
      metadata: {
        policy,
        cleanup,
        cutoff: {
          operationsBefore,
          eventsBefore,
          auditsBefore,
        },
      },
    });

    return {
      cleanup,
      policy,
      executedAt,
      cutoff: {
        operationsBefore,
        eventsBefore,
        auditsBefore,
      },
    };
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

  async planProvisioning(input: unknown): Promise<ServerProvisioningPlan> {
    const request = parseProvisioningRequest(input);
    const provider = this.providers.get(request.providerId);
    if (!provider?.getCapabilities()["server.provision.plan"] || !provider.provisioning) {
      throw new ProvisioningCapabilityError(request.providerId);
    }
    return provider.provisioning.plan(request);
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

  async getServerConnectionEndpoints(serverId: string): Promise<ConnectionEndpoint[]> {
    const server = await this.requireServer(serverId);
    return this.getProvider(server.providerId).getServerConnectionEndpoints(serverId);
  }

  async startServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    const operation = await this.service.createOperation({
      type: "server.start",
      providerId: server.providerId,
      serverId,
    });
    const started = await this.service.startOperation(operation);

    try {
      const result = await this.getProvider(server.providerId).startServer(serverId);
      const completed = await this.service.completeOperation(started, result ?? { simulated: true, message: "No start command configured" });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "server.start.requested",
        providerId: server.providerId,
        serverId,
        operationId: completed.operationId,
        result: "completed",
      });
      return { operationId: completed.operationId, status: completed.status };
    } catch (err) {
      const failed = await this.service.failOperation(started, {
        code: "SERVER_START_FAILED",
        message: err instanceof Error ? err.message : "Unknown start error",
      });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "server.start.requested",
        providerId: server.providerId,
        serverId,
        operationId: failed.operationId,
        result: "failed",
        metadata: { reason: failed.error?.message },
      });
      return { operationId: failed.operationId, status: failed.status };
    }
  }

  async stopServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    const operation = await this.service.createOperation({
      type: "server.stop",
      providerId: server.providerId,
      serverId,
    });
    const started = await this.service.startOperation(operation);

    try {
      const result = await this.getProvider(server.providerId).stopServer(serverId);
      const completed = await this.service.completeOperation(started, result ?? { simulated: true, message: "No stop command configured" });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "server.stop.requested",
        providerId: server.providerId,
        serverId,
        operationId: completed.operationId,
        result: "completed",
      });
      return { operationId: completed.operationId, status: completed.status };
    } catch (err) {
      const failed = await this.service.failOperation(started, {
        code: "SERVER_STOP_FAILED",
        message: err instanceof Error ? err.message : "Unknown stop error",
      });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "server.stop.requested",
        providerId: server.providerId,
        serverId,
        operationId: failed.operationId,
        result: "failed",
        metadata: { reason: failed.error?.message },
      });
      return { operationId: failed.operationId, status: failed.status };
    }
  }

  async restartServer(serverId: string): Promise<OperationRef> {
    const server = await this.requireServer(serverId);
    const operation = await this.service.createOperation({
      type: "server.restart",
      providerId: server.providerId,
      serverId,
    });
    const started = await this.service.startOperation(operation);

    try {
      const result = await this.getProvider(server.providerId).restartServer(serverId);
      const completed = await this.service.completeOperation(started, result ?? { simulated: true, message: "No restart command configured" });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "server.restart.requested",
        providerId: server.providerId,
        serverId,
        operationId: completed.operationId,
        result: "completed",
      });
      return { operationId: completed.operationId, status: completed.status };
    } catch (err) {
      const failed = await this.service.failOperation(started, {
        code: "SERVER_RESTART_FAILED",
        message: err instanceof Error ? err.message : "Unknown restart error",
      });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "server.restart.requested",
        providerId: server.providerId,
        serverId,
        operationId: failed.operationId,
        result: "failed",
        metadata: { reason: failed.error?.message },
      });
      return { operationId: failed.operationId, status: failed.status };
    }
  }

  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const server = await this.requireServer(serverId);
    const current = await this.getProvider(server.providerId).getServerStatus(serverId);
    const key = `${server.providerId}::${serverId}`;
    const previous = this.lastStatuses.get(key);
    if (previous !== current.status) {
      this.lastStatuses.set(key, current.status);
      await this.service.writeServerState({
        providerId: server.providerId,
        serverId,
        status: current.status,
        availability: current.status === "online" || current.status === "starting",
        lastSeenAt: new Date().toISOString(),
        metadata: {
          source: "runtime-probe",
          stale: false,
        },
      });
      await this.service.publish({
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
    const operation = await this.service.createOperation({
      type: "world.validate",
      providerId: server.providerId,
      serverId,
      worldId,
    });
    const started = await this.service.startOperation(operation);

    try {
      const result = await this.getProvider(server.providerId).validateWorld(serverId, worldId);
      const completed = await this.service.completeOperation(started, result);
      await this.service.publish({
        type: "world.validation.completed",
        timestamp: new Date().toISOString(),
        providerId: server.providerId,
        serverId,
        worldId,
        operationId: completed.operationId,
        status: completed.status,
        payload: result,
      });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "world.validation.requested",
        providerId: server.providerId,
        serverId,
        operationId: completed.operationId,
        result: "completed",
        metadata: {
          worldId,
        },
      });
      return result;
    } catch (err) {
      const failed = await this.service.failOperation(started, {
        code: "WORLD_VALIDATION_FAILED",
        message: err instanceof Error ? err.message : "Unknown world validation error",
      });
      await this.service.writeAudit({
        actor: this.defaultActor,
        action: "world.validation.requested",
        providerId: server.providerId,
        serverId,
        operationId: failed.operationId,
        result: "failed",
        metadata: {
          worldId,
          reason: failed.error?.message,
        },
      });
      throw err;
    }
  }

  async reconcileServerState(): Promise<void> {
    const persistedStates = await this.repository.listServerStates();
    const now = new Date().toISOString();
    for (const state of persistedStates) {
      await this.repository.upsertServerState({
        ...state,
        metadata: {
          ...(state.metadata || {}),
          stale: true,
          staleMarkedAt: now,
        },
      });
      this.lastStatuses.set(`${state.providerId}::${state.serverId}`, state.status);
    }

    const servers = await this.listServers();
    for (const server of servers) {
      await this.getServerStatus(server.id);
    }
  }

  private async requireServer(serverId: string): Promise<ServerSummary> {
    const server = await this.getServer(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }
    return server;
  }
}
