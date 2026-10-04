import { SqliteProvisioningRepository, provisioningMigration } from "./sqlite-provisioning-repository";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AuditRecord,
  ChildProfile,
  EventQuery,
  EventRecord,
  Family,
  HistoryStorageStats,
  OperationQuery,
  OperationRecord,
  ParentMembership,
  ParentOverride,
  ParentalRule,
  PersistenceRepository,
  PlaySession,
  PlayerIdentity,
  RetentionCleanupResult,
  RetentionPolicy,
  RewardLedgerEntry,
  RewardLedgerEntryType,
  RewardType,
  ServerStateSnapshot,
} from "../provider-manager/index";

interface SqliteRepositoryConfig {
  filePath: string;
}

interface Migration {
  version: number;
  name: string;
  up: string;
}

const SCHEMA_VERSION = 5;

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_persistence_schema",
    up: `
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        server_id TEXT,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operations_identity ON operations(provider_id, server_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operations_state ON operations(state, created_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        provider_id TEXT,
        server_id TEXT,
        operation_id TEXT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_identity ON events(provider_id, server_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_operation_id ON events(operation_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS server_state (
        provider_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        status TEXT NOT NULL,
        availability INTEGER NOT NULL,
        last_seen_at TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (provider_id, server_id)
      );

      CREATE INDEX IF NOT EXISTS idx_server_state_last_seen ON server_state(last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        provider_id TEXT,
        server_id TEXT,
        operation_id TEXT,
        result TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_identity ON audit_log(provider_id, server_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_operation_id ON audit_log(operation_id, timestamp DESC);
    `,
  },
  {
    version: 2,
    name: "analytics_indexes",
    up: `
      CREATE INDEX IF NOT EXISTS idx_operations_type ON operations(type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operations_provider_state ON operations(provider_id, server_id, state, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_provider_type ON events(provider_id, server_id, type, timestamp DESC);
    `,
  },
  {
    version: 3,
    name: "family_parental_controls",
    up: `
      CREATE TABLE IF NOT EXISTS families (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS parent_memberships (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_parent_memberships_family ON parent_memberships(family_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS child_profiles (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT,
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_child_profiles_family ON child_profiles(family_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS player_identities (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        external_player_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        identity_type TEXT NOT NULL,
        verified INTEGER NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_player_identity_unique ON player_identities(child_id, provider_id, external_player_id);
      CREATE INDEX IF NOT EXISTS idx_player_identities_child ON player_identities(child_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS parental_rules (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_parental_rules_child ON parental_rules(child_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS play_sessions (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        player_identity_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER NOT NULL,
        status TEXT NOT NULL,
        disconnect_reason TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_play_sessions_child_time ON play_sessions(child_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_play_sessions_active ON play_sessions(child_id, provider_id, server_id, status, started_at DESC);

      CREATE TABLE IF NOT EXISTS parent_overrides (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        scope TEXT NOT NULL,
        reason TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_parent_overrides_child ON parent_overrides(child_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_parent_overrides_active ON parent_overrides(child_id, starts_at, expires_at, revoked_at);
    `,
  },
  {
    version: 4,
    name: "provider_neutral_rewards",
    up: `
      CREATE TABLE IF NOT EXISTS reward_ledger (
        id TEXT PRIMARY KEY,
        reward_id TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        reward_type TEXT NOT NULL,
        family_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        amount_minutes INTEGER,
        provider_ids TEXT,
        server_ids TEXT,
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_reward_ledger_child ON reward_ledger(child_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reward_ledger_reward ON reward_ledger(reward_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reward_ledger_active ON reward_ledger(child_id, starts_at, expires_at);
    `,
  },
  { version: 5, name: "durable_provisioning_simulation", up: provisioningMigration },
];

function parseJson<T>(raw: unknown): T | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function toUtcIso(input: string): string {
  return new Date(input).toISOString();
}

function utcCutoffIso(nowIso: string, retentionDays: number): string {
  const cutoffMs = Date.parse(nowIso) - retentionDays * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

export class SqlitePersistenceRepository implements PersistenceRepository {
  readonly provisioning = new SqliteProvisioningRepository(() => this.requireDb());
  private readonly filePath: string;
  private db: DatabaseSync | undefined;

  constructor(config: SqliteRepositoryConfig) {
    this.filePath = config.filePath;
  }

  async initialize(): Promise<void> {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });

    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = FULL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA foreign_keys = OFF;");

    const currentVersion = Number(this.db.prepare("PRAGMA user_version;").get()?.user_version ?? 0);
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(`Unsupported schema version ${currentVersion}; expected <= ${SCHEMA_VERSION}`);
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) {
        continue;
      }
      try {
        this.db.exec("BEGIN;");
        this.db.exec(migration.up);
        this.db.exec(`PRAGMA user_version = ${migration.version};`);
        this.db.exec("COMMIT;");
      } catch (error) {
        this.db.exec("ROLLBACK;");
        throw new Error(
          `Failed migration ${migration.version} (${migration.name}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  async createOperation(operation: OperationRecord): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO operations (id, provider_id, server_id, type, state, created_at, started_at, completed_at, error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      operation.operationId,
      operation.providerId,
      operation.serverId ?? null,
      operation.type,
      operation.status,
      toUtcIso(operation.createdAt),
      operation.startedAt ? toUtcIso(operation.startedAt) : null,
      operation.completedAt ? toUtcIso(operation.completedAt) : null,
      operation.error ? JSON.stringify(operation.error) : null,
      JSON.stringify({ worldId: operation.worldId, result: operation.result ?? null }),
    );
  }

  async updateOperation(operation: OperationRecord): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `UPDATE operations
       SET state = ?, started_at = ?, completed_at = ?, error = ?, metadata = ?
       WHERE id = ?`,
    ).run(
      operation.status,
      operation.startedAt ? toUtcIso(operation.startedAt) : null,
      operation.completedAt ? toUtcIso(operation.completedAt) : null,
      operation.error ? JSON.stringify(operation.error) : null,
      JSON.stringify({ worldId: operation.worldId, result: operation.result ?? null }),
      operation.operationId,
    );
  }

  async getOperation(operationId: string): Promise<OperationRecord | undefined> {
    const db = this.requireDb();
    const row = db
      .prepare(
        `SELECT id, provider_id, server_id, type, state, created_at, started_at, completed_at, error, metadata
         FROM operations
         WHERE id = ?`,
      )
      .get(operationId) as Record<string, unknown> | undefined;

    return row ? this.mapOperationRow(row) : undefined;
  }

  async listOperations(query: OperationQuery = {}): Promise<OperationRecord[]> {
    const db = this.requireDb();
    const where: string[] = [];
    const params: Array<string | number | null> = [];

    if (query.providerId) {
      where.push("provider_id = ?");
      params.push(query.providerId);
    }
    if (query.serverId) {
      where.push("server_id = ?");
      params.push(query.serverId);
    }
    if (query.operationId) {
      where.push("id = ?");
      params.push(query.operationId);
    }
    if (query.type) {
      where.push("type = ?");
      params.push(query.type);
    }
    if (query.state) {
      where.push("state = ?");
      params.push(query.state);
    }
    if (query.from) {
      where.push("created_at >= ?");
      params.push(toUtcIso(query.from));
    }
    if (query.to) {
      where.push("created_at <= ?");
      params.push(toUtcIso(query.to));
    }

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 5000) : 100;
    const sql = `
      SELECT id, provider_id, server_id, type, state, created_at, started_at, completed_at, error, metadata
      FROM operations
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapOperationRow(row));
  }

  async appendEvent(event: EventRecord): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO events (id, provider_id, server_id, operation_id, type, timestamp, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.providerId ?? null,
      event.serverId ?? null,
      event.operationId ?? null,
      event.type,
      toUtcIso(event.timestamp),
      JSON.stringify(event.payload ?? null),
    );
  }

  async listEvents(query: EventQuery = {}): Promise<EventRecord[]> {
    const db = this.requireDb();
    const where: string[] = [];
    const params: Array<string | number | null> = [];

    if (query.providerId) {
      where.push("provider_id = ?");
      params.push(query.providerId);
    }
    if (query.serverId) {
      where.push("server_id = ?");
      params.push(query.serverId);
    }
    if (query.operationId) {
      where.push("operation_id = ?");
      params.push(query.operationId);
    }
    if (query.type) {
      where.push("type = ?");
      params.push(query.type);
    }
    if (query.from) {
      where.push("timestamp >= ?");
      params.push(toUtcIso(query.from));
    }
    if (query.to) {
      where.push("timestamp <= ?");
      params.push(toUtcIso(query.to));
    }

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 5000) : 200;
    const sql = `
      SELECT id, provider_id, server_id, operation_id, type, timestamp, payload
      FROM events
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      providerId: typeof row.provider_id === "string" ? row.provider_id : undefined,
      serverId: typeof row.server_id === "string" ? row.server_id : undefined,
      operationId: typeof row.operation_id === "string" ? row.operation_id : undefined,
      type: row.type as EventRecord["type"],
      timestamp: String(row.timestamp),
      payload: parseJson(row.payload),
    }));
  }

  async upsertServerState(snapshot: ServerStateSnapshot): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO server_state (provider_id, server_id, status, availability, last_seen_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, server_id) DO UPDATE SET
         status = excluded.status,
         availability = excluded.availability,
         last_seen_at = excluded.last_seen_at,
         metadata = excluded.metadata`,
    ).run(
      snapshot.providerId,
      snapshot.serverId,
      snapshot.status,
      snapshot.availability ? 1 : 0,
      toUtcIso(snapshot.lastSeenAt),
      JSON.stringify(snapshot.metadata ?? {}),
    );
  }

  async listServerStates(): Promise<ServerStateSnapshot[]> {
    const db = this.requireDb();
    const rows = db
      .prepare(
        `SELECT provider_id, server_id, status, availability, last_seen_at, metadata
         FROM server_state
         ORDER BY provider_id ASC, server_id ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      providerId: String(row.provider_id),
      serverId: String(row.server_id),
      status: row.status as ServerStateSnapshot["status"],
      availability: Number(row.availability) === 1,
      lastSeenAt: String(row.last_seen_at),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO audit_log (id, timestamp, actor, action, provider_id, server_id, operation_id, result, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      toUtcIso(record.timestamp),
      record.actor,
      record.action,
      record.providerId ?? null,
      record.serverId ?? null,
      record.operationId ?? null,
      record.result,
      JSON.stringify(record.metadata ?? {}),
    );
  }

  async listAudit(
    query: { providerId?: string; serverId?: string; operationId?: string; action?: AuditRecord["action"]; limit?: number } = {},
  ): Promise<AuditRecord[]> {
    const db = this.requireDb();
    const where: string[] = [];
    const params: Array<string | number | null> = [];

    if (query.providerId) {
      where.push("provider_id = ?");
      params.push(query.providerId);
    }
    if (query.serverId) {
      where.push("server_id = ?");
      params.push(query.serverId);
    }
    if (query.operationId) {
      where.push("operation_id = ?");
      params.push(query.operationId);
    }
    if (query.action) {
      where.push("action = ?");
      params.push(query.action);
    }

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 5000) : 200;
    const sql = `
      SELECT id, timestamp, actor, action, provider_id, server_id, operation_id, result, metadata
      FROM audit_log
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      timestamp: String(row.timestamp),
      actor: String(row.actor),
      action: row.action as AuditRecord["action"],
      providerId: typeof row.provider_id === "string" ? row.provider_id : undefined,
      serverId: typeof row.server_id === "string" ? row.server_id : undefined,
      operationId: typeof row.operation_id === "string" ? row.operation_id : undefined,
      result: row.result as AuditRecord["result"],
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async cleanupExpired(policy: RetentionPolicy, nowIso: string): Promise<RetentionCleanupResult> {
    const db = this.requireDb();

    const operationCutoff = utcCutoffIso(nowIso, policy.operationRetentionDays);
    const eventCutoff = utcCutoffIso(nowIso, policy.eventRetentionDays);
    const auditCutoff = utcCutoffIso(nowIso, policy.auditRetentionDays);

    const operationsResult = db.prepare("DELETE FROM operations WHERE created_at < ?").run(operationCutoff);
    const eventsResult = db.prepare("DELETE FROM events WHERE timestamp < ?").run(eventCutoff);
    const auditResult = db.prepare("DELETE FROM audit_log WHERE timestamp < ?").run(auditCutoff);

    return {
      operationsDeleted: Number(operationsResult.changes ?? 0),
      eventsDeleted: Number(eventsResult.changes ?? 0),
      auditDeleted: Number(auditResult.changes ?? 0),
    };
  }

  async getHistoryStorageStats(): Promise<HistoryStorageStats> {
    const db = this.requireDb();
    const sizeBytes = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : undefined;

    const oldestOperationAt = db.prepare("SELECT MIN(created_at) AS value FROM operations").get() as { value?: string };
    const oldestEventAt = db.prepare("SELECT MIN(timestamp) AS value FROM events").get() as { value?: string };
    const oldestAuditAt = db.prepare("SELECT MIN(timestamp) AS value FROM audit_log").get() as { value?: string };

    return {
      databaseSizeBytes: sizeBytes,
      oldestOperationAt: oldestOperationAt.value,
      oldestEventAt: oldestEventAt.value,
      oldestAuditAt: oldestAuditAt.value,
    };
  }

  async createFamily(family: Family): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO families (id, name, timezone, created_at, metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      family.id,
      family.name,
      family.timezone,
      toUtcIso(family.createdAt),
      JSON.stringify(family.metadata ?? {}),
    );
  }

  async listFamilies(): Promise<Family[]> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT id, name, timezone, created_at, metadata FROM families ORDER BY created_at DESC`
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      timezone: String(row.timezone),
      createdAt: String(row.created_at),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async getFamily(familyId: string): Promise<Family | undefined> {
    const db = this.requireDb();
    const row = db.prepare(
      `SELECT id, name, timezone, created_at, metadata FROM families WHERE id = ?`
    ).get(familyId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      name: String(row.name),
      timezone: String(row.timezone),
      createdAt: String(row.created_at),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    };
  }

  async createParentMembership(parent: ParentMembership): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO parent_memberships (id, family_id, parent_id, role, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      parent.id,
      parent.familyId,
      parent.parentId,
      parent.role,
      toUtcIso(parent.createdAt),
      JSON.stringify(parent.metadata ?? {}),
    );
  }

  async listParentMemberships(familyId: string): Promise<ParentMembership[]> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT id, family_id, parent_id, role, created_at, metadata FROM parent_memberships WHERE family_id = ? ORDER BY created_at DESC`
    ).all(familyId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      familyId: String(row.family_id),
      parentId: String(row.parent_id),
      role: row.role as "parent" | "admin",
      createdAt: String(row.created_at),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async createChildProfile(child: ChildProfile): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO child_profiles (id, family_id, name, timezone, created_at, active, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      child.id,
      child.familyId,
      child.name,
      child.timezone ?? null,
      toUtcIso(child.createdAt),
      child.active ? 1 : 0,
      JSON.stringify(child.metadata ?? {}),
    );
  }

  async upsertChildProfile(child: ChildProfile): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO child_profiles (id, family_id, name, timezone, created_at, active, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         family_id = excluded.family_id,
         name = excluded.name,
         timezone = excluded.timezone,
         active = excluded.active,
         metadata = excluded.metadata`
    ).run(
      child.id,
      child.familyId,
      child.name,
      child.timezone ?? null,
      toUtcIso(child.createdAt),
      child.active ? 1 : 0,
      JSON.stringify(child.metadata ?? {}),
    );
  }

  async listChildProfiles(familyId: string): Promise<ChildProfile[]> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT id, family_id, name, timezone, created_at, active, metadata FROM child_profiles WHERE family_id = ? ORDER BY created_at DESC`
    ).all(familyId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      familyId: String(row.family_id),
      name: String(row.name),
      timezone: typeof row.timezone === "string" ? row.timezone : undefined,
      createdAt: String(row.created_at),
      active: Number(row.active) === 1,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async getChildProfile(childId: string): Promise<ChildProfile | undefined> {
    const db = this.requireDb();
    const row = db.prepare(
      `SELECT id, family_id, name, timezone, created_at, active, metadata FROM child_profiles WHERE id = ?`
    ).get(childId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      familyId: String(row.family_id),
      name: String(row.name),
      timezone: typeof row.timezone === "string" ? row.timezone : undefined,
      createdAt: String(row.created_at),
      active: Number(row.active) === 1,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    };
  }

  async createPlayerIdentity(identity: PlayerIdentity): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO player_identities (id, family_id, child_id, provider_id, external_player_id, display_name, identity_type, verified, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      identity.id,
      identity.familyId,
      identity.childId,
      identity.providerId,
      identity.externalPlayerId,
      identity.displayName,
      identity.identityType,
      identity.verified ? 1 : 0,
      JSON.stringify(identity.metadata ?? {}),
      toUtcIso(identity.createdAt),
    );
  }

  async listPlayerIdentitiesByChild(childId: string): Promise<PlayerIdentity[]> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT id, family_id, child_id, provider_id, external_player_id, display_name, identity_type, verified, metadata, created_at
       FROM player_identities WHERE child_id = ? ORDER BY created_at DESC`
    ).all(childId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      providerId: String(row.provider_id),
      externalPlayerId: String(row.external_player_id),
      displayName: String(row.display_name),
      identityType: String(row.identity_type),
      verified: Number(row.verified) === 1,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      createdAt: String(row.created_at),
    }));
  }

  async createParentalRule(rule: ParentalRule): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO parental_rules (id, family_id, child_id, type, enabled, config, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      rule.id,
      rule.familyId,
      rule.childId,
      rule.type,
      rule.enabled ? 1 : 0,
      JSON.stringify(rule.config ?? {}),
      toUtcIso(rule.createdAt),
      toUtcIso(rule.updatedAt),
      JSON.stringify(rule.metadata ?? {}),
    );
  }

  async upsertParentalRule(rule: ParentalRule): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO parental_rules (id, family_id, child_id, type, enabled, config, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         family_id = excluded.family_id,
         child_id = excluded.child_id,
         type = excluded.type,
         enabled = excluded.enabled,
         config = excluded.config,
         updated_at = excluded.updated_at,
         metadata = excluded.metadata`
    ).run(
      rule.id,
      rule.familyId,
      rule.childId,
      rule.type,
      rule.enabled ? 1 : 0,
      JSON.stringify(rule.config ?? {}),
      toUtcIso(rule.createdAt),
      toUtcIso(rule.updatedAt),
      JSON.stringify(rule.metadata ?? {}),
    );
  }

  async getParentalRule(ruleId: string): Promise<ParentalRule | undefined> {
    const db = this.requireDb();
    const row = db.prepare(
      `SELECT id, family_id, child_id, type, enabled, config, created_at, updated_at, metadata
       FROM parental_rules WHERE id = ?`
    ).get(ruleId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      type: row.type as ParentalRule["type"],
      enabled: Number(row.enabled) === 1,
      config: parseJson<Record<string, unknown>>(row.config) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    };
  }

  async listParentalRulesByChild(childId: string): Promise<ParentalRule[]> {
    const db = this.requireDb();
    const rows = db.prepare(
      `SELECT id, family_id, child_id, type, enabled, config, created_at, updated_at, metadata
       FROM parental_rules WHERE child_id = ? ORDER BY updated_at DESC`
    ).all(childId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      type: row.type as ParentalRule["type"],
      enabled: Number(row.enabled) === 1,
      config: parseJson<Record<string, unknown>>(row.config) ?? {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async createPlaySession(session: PlaySession): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO play_sessions (id, family_id, child_id, provider_id, server_id, player_identity_id, started_at, ended_at, duration_seconds, status, disconnect_reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      session.familyId,
      session.childId,
      session.providerId,
      session.serverId,
      session.playerIdentityId,
      toUtcIso(session.startedAt),
      session.endedAt ? toUtcIso(session.endedAt) : null,
      session.durationSeconds,
      session.status,
      session.disconnectReason ?? null,
      JSON.stringify(session.metadata ?? {}),
    );
  }

  async upsertPlaySession(session: PlaySession): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO play_sessions (id, family_id, child_id, provider_id, server_id, player_identity_id, started_at, ended_at, duration_seconds, status, disconnect_reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         family_id = excluded.family_id,
         child_id = excluded.child_id,
         provider_id = excluded.provider_id,
         server_id = excluded.server_id,
         player_identity_id = excluded.player_identity_id,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_seconds = excluded.duration_seconds,
         status = excluded.status,
         disconnect_reason = excluded.disconnect_reason,
         metadata = excluded.metadata`
    ).run(
      session.id,
      session.familyId,
      session.childId,
      session.providerId,
      session.serverId,
      session.playerIdentityId,
      toUtcIso(session.startedAt),
      session.endedAt ? toUtcIso(session.endedAt) : null,
      session.durationSeconds,
      session.status,
      session.disconnectReason ?? null,
      JSON.stringify(session.metadata ?? {}),
    );
  }

  async getPlaySession(sessionId: string): Promise<PlaySession | undefined> {
    const db = this.requireDb();
    const row = db.prepare(
      `SELECT id, family_id, child_id, provider_id, server_id, player_identity_id, started_at, ended_at, duration_seconds, status, disconnect_reason, metadata
       FROM play_sessions WHERE id = ?`
    ).get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      providerId: String(row.provider_id),
      serverId: String(row.server_id),
      playerIdentityId: String(row.player_identity_id),
      startedAt: String(row.started_at),
      endedAt: typeof row.ended_at === "string" ? row.ended_at : undefined,
      durationSeconds: Number(row.duration_seconds),
      status: row.status as PlaySession["status"],
      disconnectReason: typeof row.disconnect_reason === "string" ? row.disconnect_reason : undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    };
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
    const db = this.requireDb();
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (query.childId) {
      where.push("child_id = ?");
      params.push(query.childId);
    }
    if (query.providerId) {
      where.push("provider_id = ?");
      params.push(query.providerId);
    }
    if (query.serverId) {
      where.push("server_id = ?");
      params.push(query.serverId);
    }
    if (query.status) {
      where.push("status = ?");
      params.push(query.status);
    } else if (!query.includeActive) {
      where.push("status != ?");
      params.push("active");
    }
    if (query.from) {
      where.push("started_at >= ?");
      params.push(toUtcIso(query.from));
    }
    if (query.to) {
      where.push("started_at <= ?");
      params.push(toUtcIso(query.to));
    }

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 10000) : 200;
    const sql = `
      SELECT id, family_id, child_id, provider_id, server_id, player_identity_id, started_at, ended_at, duration_seconds, status, disconnect_reason, metadata
      FROM play_sessions
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY started_at DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      providerId: String(row.provider_id),
      serverId: String(row.server_id),
      playerIdentityId: String(row.player_identity_id),
      startedAt: String(row.started_at),
      endedAt: typeof row.ended_at === "string" ? row.ended_at : undefined,
      durationSeconds: Number(row.duration_seconds),
      status: row.status as PlaySession["status"],
      disconnectReason: typeof row.disconnect_reason === "string" ? row.disconnect_reason : undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async findActivePlaySession(
    childId: string,
    providerId: string,
    serverId: string,
    playerIdentityId?: string,
  ): Promise<PlaySession | undefined> {
    const db = this.requireDb();
    const where = ["child_id = ?", "provider_id = ?", "server_id = ?", "status = ?"];
    const params: Array<string | number | null> = [childId, providerId, serverId, "active"];
    if (playerIdentityId) {
      where.push("player_identity_id = ?");
      params.push(playerIdentityId);
    }
    const row = db.prepare(
      `SELECT id, family_id, child_id, provider_id, server_id, player_identity_id, started_at, ended_at, duration_seconds, status, disconnect_reason, metadata
       FROM play_sessions
       WHERE ${where.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT 1`
    ).get(...params) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      providerId: String(row.provider_id),
      serverId: String(row.server_id),
      playerIdentityId: String(row.player_identity_id),
      startedAt: String(row.started_at),
      endedAt: typeof row.ended_at === "string" ? row.ended_at : undefined,
      durationSeconds: Number(row.duration_seconds),
      status: row.status as PlaySession["status"],
      disconnectReason: typeof row.disconnect_reason === "string" ? row.disconnect_reason : undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    };
  }

  async createParentOverride(override: ParentOverride): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO parent_overrides (id, family_id, child_id, created_by, scope, reason, starts_at, expires_at, created_at, revoked_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      override.id,
      override.familyId,
      override.childId,
      override.createdBy,
      JSON.stringify(override.scope ?? {}),
      override.reason,
      toUtcIso(override.startsAt),
      toUtcIso(override.expiresAt),
      toUtcIso(override.createdAt),
      override.revokedAt ? toUtcIso(override.revokedAt) : null,
      JSON.stringify(override.metadata ?? {}),
    );
  }

  async upsertParentOverride(override: ParentOverride): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO parent_overrides (id, family_id, child_id, created_by, scope, reason, starts_at, expires_at, created_at, revoked_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         family_id = excluded.family_id,
         child_id = excluded.child_id,
         created_by = excluded.created_by,
         scope = excluded.scope,
         reason = excluded.reason,
         starts_at = excluded.starts_at,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at,
         revoked_at = excluded.revoked_at,
         metadata = excluded.metadata`
    ).run(
      override.id,
      override.familyId,
      override.childId,
      override.createdBy,
      JSON.stringify(override.scope ?? {}),
      override.reason,
      toUtcIso(override.startsAt),
      toUtcIso(override.expiresAt),
      toUtcIso(override.createdAt),
      override.revokedAt ? toUtcIso(override.revokedAt) : null,
      JSON.stringify(override.metadata ?? {}),
    );
  }

  async getParentOverride(overrideId: string): Promise<ParentOverride | undefined> {
    const db = this.requireDb();
    const row = db.prepare(
      `SELECT id, family_id, child_id, created_by, scope, reason, starts_at, expires_at, created_at, revoked_at, metadata
       FROM parent_overrides WHERE id = ?`
    ).get(overrideId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      createdBy: String(row.created_by),
      scope: parseJson<Record<string, unknown>>(row.scope) ?? {},
      reason: String(row.reason),
      startsAt: String(row.starts_at),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    };
  }

  async listParentOverrides(query: { childId?: string; activeAt?: string; limit?: number } = {}): Promise<ParentOverride[]> {
    const db = this.requireDb();
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (query.childId) {
      where.push("child_id = ?");
      params.push(query.childId);
    }
    if (query.activeAt) {
      const activeAt = toUtcIso(query.activeAt);
      where.push("revoked_at IS NULL");
      where.push("starts_at <= ?");
      where.push("expires_at >= ?");
      params.push(activeAt, activeAt);
    }

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 10000) : 200;
    const sql = `
      SELECT id, family_id, child_id, created_by, scope, reason, starts_at, expires_at, created_at, revoked_at, metadata
      FROM parent_overrides
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      familyId: String(row.family_id),
      childId: String(row.child_id),
      createdBy: String(row.created_by),
      scope: parseJson<Record<string, unknown>>(row.scope) ?? {},
      reason: String(row.reason),
      startsAt: String(row.starts_at),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  async createRewardLedgerEntry(entry: RewardLedgerEntry): Promise<void> {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO reward_ledger
        (id, reward_id, entry_type, reward_type, family_id, child_id, amount_minutes, provider_ids, server_ids,
         starts_at, expires_at, created_at, actor, reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.rewardId,
      entry.entryType,
      entry.rewardType,
      entry.familyId,
      entry.childId,
      entry.amountMinutes ?? null,
      JSON.stringify(entry.providerIds ?? []),
      JSON.stringify(entry.serverIds ?? []),
      toUtcIso(entry.startsAt),
      toUtcIso(entry.expiresAt),
      toUtcIso(entry.createdAt),
      entry.actor,
      entry.reason,
      JSON.stringify(entry.metadata ?? {}),
    );
  }

  async listRewardLedger(query: { childId?: string; rewardId?: string; limit?: number } = {}): Promise<RewardLedgerEntry[]> {
    const db = this.requireDb();
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.childId) {
      where.push("child_id = ?");
      params.push(query.childId);
    }
    if (query.rewardId) {
      where.push("reward_id = ?");
      params.push(query.rewardId);
    }
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 10000) : 2000;
    const rows = db.prepare(`
      SELECT id, reward_id, entry_type, reward_type, family_id, child_id, amount_minutes, provider_ids, server_ids,
             starts_at, expires_at, created_at, actor, reason, metadata
      FROM reward_ledger
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      rewardId: String(row.reward_id),
      entryType: row.entry_type as RewardLedgerEntryType,
      rewardType: row.reward_type as RewardType,
      familyId: String(row.family_id),
      childId: String(row.child_id),
      amountMinutes: row.amount_minutes === null || row.amount_minutes === undefined ? undefined : Number(row.amount_minutes),
      providerIds: parseJson<string[]>(row.provider_ids) ?? [],
      serverIds: parseJson<string[]>(row.server_ids) ?? [],
      startsAt: String(row.starts_at),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      actor: String(row.actor),
      reason: String(row.reason),
      metadata: parseJson<Record<string, unknown>>(row.metadata),
    }));
  }

  private mapOperationRow(row: Record<string, unknown>): OperationRecord {
    const metadata = parseJson<{ worldId?: string; result?: unknown }>(row.metadata) ?? {};
    return {
      operationId: String(row.id),
      providerId: String(row.provider_id),
      serverId: typeof row.server_id === "string" ? row.server_id : undefined,
      type: row.type as OperationRecord["type"],
      status: row.state as OperationRecord["status"],
      createdAt: String(row.created_at),
      startedAt: typeof row.started_at === "string" ? row.started_at : undefined,
      completedAt: typeof row.completed_at === "string" ? row.completed_at : undefined,
      worldId: metadata.worldId,
      error: parseJson(row.error),
      result: metadata.result,
    };
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("Persistence repository is not initialized");
    }
    return this.db;
  }
}
