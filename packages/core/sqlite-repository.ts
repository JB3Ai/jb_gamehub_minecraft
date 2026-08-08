import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AuditRecord,
  EventQuery,
  EventRecord,
  OperationQuery,
  OperationRecord,
  PersistenceRepository,
  RetentionCleanupResult,
  RetentionPolicy,
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

const SCHEMA_VERSION = 1;

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
    this.db.exec("PRAGMA synchronous = NORMAL;");
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

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 500) : 100;
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

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 1000) : 200;
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

  async listAudit(query: { providerId?: string; serverId?: string; operationId?: string; limit?: number } = {}): Promise<AuditRecord[]> {
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

    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 1000) : 200;
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
