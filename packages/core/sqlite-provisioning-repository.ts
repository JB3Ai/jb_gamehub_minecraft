import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ProvisioningApplyException, terminalProvisioningState, type ProvisioningApplyRepository, type ProvisioningApplyOperation, type ProvisioningApplyStep, type ProvisioningApplyError, type ProvisioningClaim, type ProvisioningEffect, type ProvisioningJournalEntry } from "./provisioning-apply-contracts";
import type { ProvisioningJson, ProvisioningResult } from "./provisioning";

export const provisioningMigration = `
CREATE TABLE provisioning_applies (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE provisioning_claims (operation_id TEXT NOT NULL, resource_key TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(operation_id, resource_key));
CREATE UNIQUE INDEX provisioning_active_claim ON provisioning_claims(resource_key) WHERE state = 'active';
CREATE TABLE provisioning_journal (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX provisioning_journal_operation ON provisioning_journal(operation_id, sequence);
CREATE TABLE provisioning_effects (operation_id TEXT NOT NULL, step_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(operation_id, step_id));
`;

/** All logical effects, claims and journal receipts share one SQLite transaction boundary. */
export class SqliteProvisioningRepository implements ProvisioningApplyRepository {
  constructor(private readonly database: () => DatabaseSync) {}
  private tx<T>(run: () => T): T {
    const db = this.database(); db.exec("BEGIN IMMEDIATE;");
    try { const result = run(); db.exec("COMMIT;"); return result; }
    catch (error) { db.exec("ROLLBACK;"); throw error; }
  }
  get(id: string): ProvisioningApplyOperation | undefined {
    const row = this.database().prepare("SELECT data FROM provisioning_applies WHERE id = ?").get(id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  listIncomplete(): ProvisioningApplyOperation[] {
    return this.database().prepare("SELECT data FROM provisioning_applies WHERE state NOT IN ('PROVISIONED','ROLLED_BACK','PARTIALLY_ROLLED_BACK') ORDER BY id").all().map((row) => JSON.parse(String(row.data)));
  }
  claims(operationId?: string): ProvisioningClaim[] {
    return this.database().prepare(`SELECT data FROM provisioning_claims ${operationId ? "WHERE operation_id = ?" : ""} ORDER BY operation_id, resource_key`).all(...(operationId ? [operationId] : [])).map((row) => JSON.parse(String(row.data)));
  }
  journal(id: string): ProvisioningJournalEntry[] {
    return this.database().prepare("SELECT sequence, data FROM provisioning_journal WHERE operation_id = ? ORDER BY sequence").all(id).map((row) => ({ ...JSON.parse(String(row.data)), sequence: Number(row.sequence) }));
  }
  effects(id: string): ProvisioningEffect[] {
    return this.database().prepare("SELECT data FROM provisioning_effects WHERE operation_id = ? ORDER BY step_id").all(id).map((row) => JSON.parse(String(row.data)));
  }
  private append(op: ProvisioningApplyOperation, step: string, status: ProvisioningJournalEntry["status"], timestamp: string, error?: ProvisioningApplyError) {
    const data = { operationId: op.operationId, planId: op.plan.planId, step, status, timestamp, ...(error ? { error } : {}) };
    this.database().prepare("INSERT INTO provisioning_journal(operation_id,data) VALUES (?,?)").run(op.operationId, JSON.stringify(data));
    this.database().prepare("INSERT INTO events(id,provider_id,server_id,operation_id,type,timestamp,payload) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), op.plan.providerId, op.plan.serverId, op.operationId, "provisioning.step", timestamp, JSON.stringify(data));
  }
  private save(op: ProvisioningApplyOperation) {
    this.database().prepare("UPDATE provisioning_applies SET state=?, data=? WHERE id=?").run(op.result.state, JSON.stringify(op), op.operationId);
  }
  private fenced(op: ProvisioningApplyOperation, now: string): ProvisioningApplyOperation {
    const stored = this.get(op.operationId);
    if (!stored || stored.lease.owner !== op.lease.owner || stored.lease.token !== op.lease.token || stored.lease.expiresAt <= now || terminalProvisioningState(stored.result.state)) throw new ProvisioningApplyException({ code: "LEASE_LOST", message: "Apply lease expired or was fenced by recovery." });
    return stored;
  }
  private history(op: ProvisioningApplyOperation) {
    const state = op.result.state;
    const terminal = terminalProvisioningState(state);
    const status = state === "PLANNED" ? "queued" : state === "PROVISIONED" ? "completed" : terminal ? "failed" : "running";
    const db = this.database();
    db.prepare(`INSERT INTO operations(id,provider_id,server_id,type,state,created_at,started_at,completed_at,error,metadata) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, started_at=excluded.started_at, completed_at=excluded.completed_at, error=excluded.error, metadata=excluded.metadata`).run(op.operationId, op.plan.providerId, op.plan.serverId, "server.provision.apply", status, op.createdAt, state === "PLANNED" ? null : op.createdAt, terminal ? op.updatedAt : null, op.error ? JSON.stringify(op.error) : null, JSON.stringify({ result: op.result }));
    db.prepare("INSERT INTO audit_log(id,timestamp,actor,action,provider_id,server_id,operation_id,result,metadata) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), op.updatedAt, op.actor, "provisioning.state.changed", op.plan.providerId, op.plan.serverId, op.operationId, op.error ? "failed" : "completed", JSON.stringify({ planId: op.plan.planId, state, rollbackErrors: op.rollbackErrors }));
    db.prepare("INSERT INTO events(id,provider_id,server_id,operation_id,type,timestamp,payload) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), op.plan.providerId, op.plan.serverId, op.operationId, state === "PLANNED" ? "operation.created" : terminal ? state === "PROVISIONED" ? "operation.completed" : "operation.failed" : "operation.started", op.updatedAt, JSON.stringify(op.result));
  }
  begin(op: ProvisioningApplyOperation) {
    return this.tx(() => {
      const existing = this.get(op.operationId);
      if (existing) {
        if (existing.digest !== op.digest) throw new ProvisioningApplyException({ code: "APPROVAL_MISMATCH", message: "Persisted approval differs from this plan." });
        return { operation: existing, acquired: false };
      }
      this.database().prepare("INSERT INTO provisioning_applies(id,plan_id,state,data) VALUES (?,?,?,?)").run(op.operationId, op.plan.planId, op.result.state, JSON.stringify(op));
      this.history(op);
      return { operation: op, acquired: true };
    });
  }
  acquire(id: string, owner: string, now: string, expiresAt: string) {
    return this.tx(() => {
      const op = this.get(id);
      if (!op) throw new ProvisioningApplyException({ code: "OPERATION_NOT_FOUND", message: "Apply operation does not exist." });
      if (terminalProvisioningState(op.result.state)) return op;
      if (op.lease.expiresAt > now) throw new ProvisioningApplyException({ code: "APPLY_IN_PROGRESS", message: "Another worker owns an unexpired apply lease." });
      op.lease = { owner, token: op.lease.token + 1, expiresAt }; op.updatedAt = now;
      this.save(op); this.append(op, "RECOVERY", "completed", now);
      return op;
    });
  }
  startStep(op: ProvisioningApplyOperation, step: ProvisioningApplyStep, now: string, expiresAt: string) {
    return this.tx(() => {
      const stored = this.fenced(op, now);
      if (this.effects(op.operationId).some((effect) => effect.step.id === step.id)) return false;
      stored.lease.expiresAt = expiresAt; stored.updatedAt = now; this.save(stored);
      this.append(stored, step.id, "started", now); return true;
    });
  }
  completeStep(op: ProvisioningApplyOperation, step: ProvisioningApplyStep, value: ProvisioningJson, now: string) {
    this.tx(() => {
      const stored = this.fenced(op, now);
      if (this.effects(op.operationId).some((effect) => effect.step.id === step.id)) return;
      if (step.kind.startsWith("CLAIM_")) {
        const collision = this.database().prepare("SELECT operation_id FROM provisioning_claims WHERE resource_key=? AND state='active'").get(step.resourceKey);
        if (collision && collision.operation_id !== op.operationId) throw new ProvisioningApplyException({ code: "RESOURCE_CONFLICT", message: "Logical resource is already claimed.", resourceKey: step.resourceKey, ownerOperationId: String(collision.operation_id) });
        const claim: ProvisioningClaim = { resourceKey: step.resourceKey, operationId: op.operationId, planId: op.plan.planId, kind: step.kind, state: "active", createdAt: now, updatedAt: now };
        this.database().prepare("INSERT INTO provisioning_claims(operation_id,resource_key,state,data) VALUES (?,?,'active',?)").run(op.operationId, step.resourceKey, JSON.stringify(claim));
      }
      const effect: ProvisioningEffect = { operationId: op.operationId, step, value };
      this.database().prepare("INSERT INTO provisioning_effects(operation_id,step_id,data) VALUES (?,?,?)").run(op.operationId, step.id, JSON.stringify(effect));
      this.append(stored, step.id, "completed", now);
    });
  }
  transition(op: ProvisioningApplyOperation, state: ProvisioningResult["state"], now: string, error?: ProvisioningApplyError, rollbackErrors?: ProvisioningApplyError[]) {
    return this.tx(() => {
      const stored = this.fenced(op, now); stored.result.state = state; stored.updatedAt = now;
      stored.result.outcome = state === "PROVISIONED" ? "applied" : state === "ROLLED_BACK" ? "rolled-back" : state === "PARTIALLY_ROLLED_BACK" ? "partially-rolled-back" : state === "FAILED" || state === "ROLLING_BACK" ? "failed" : "planned";
      if (error) { stored.error = error; stored.result.issues = [{ code: error.code, severity: "blocking", field: error.resourceKey ?? "apply", message: error.message }]; }
      if (rollbackErrors) stored.rollbackErrors = rollbackErrors;
      this.save(stored); this.history(stored);
      this.append(stored, error?.stepId ?? state, state === "FAILED" ? "failed" : "completed", now, error);
      return stored;
    });
  }
  compensate(op: ProvisioningApplyOperation, effect: ProvisioningEffect, status: "compensating" | "compensated" | "compensation_failed", now: string, error?: ProvisioningApplyError) {
    this.tx(() => {
      const stored = this.fenced(op, now);
      if (effect.operationId !== op.operationId || effect.step.kind.startsWith("CLAIM_")) throw new Error("Invalid compensation scope.");
      if (status === "compensated") this.database().prepare("DELETE FROM provisioning_effects WHERE operation_id=? AND step_id=?").run(op.operationId, effect.step.id);
      this.append(stored, effect.step.id, status, now, error);
    });
  }
  finishRollback(op: ProvisioningApplyOperation, now: string, errors: ProvisioningApplyError[]) {
    // Claim release and terminal rollback state are atomic; partial rollback retains every claim.
    return this.tx(() => {
      const stored = this.fenced(op, now);
      const effects = this.effects(op.operationId);
      const remaining = effects.filter((effect) => !effect.step.kind.startsWith("CLAIM_"));
      if (!remaining.length && !errors.length) {
        for (const claim of this.claims(op.operationId)) {
          claim.state = "released"; claim.updatedAt = now;
          this.database().prepare("UPDATE provisioning_claims SET state='released',data=? WHERE operation_id=? AND resource_key=?").run(JSON.stringify(claim), op.operationId, claim.resourceKey);
        }
        for (const effect of effects.reverse()) this.append(stored, effect.step.id, "compensated", now);
        this.database().prepare("DELETE FROM provisioning_effects WHERE operation_id=?").run(op.operationId);
      }
      stored.result.state = remaining.length || errors.length ? "PARTIALLY_ROLLED_BACK" : "ROLLED_BACK";
      stored.result.outcome = stored.result.state === "ROLLED_BACK" ? "rolled-back" : "partially-rolled-back";
      stored.rollbackErrors = errors; stored.updatedAt = now;
      this.append(stored, stored.result.state, "completed", now); this.save(stored); this.history(stored); return stored;
    });
  }
}
