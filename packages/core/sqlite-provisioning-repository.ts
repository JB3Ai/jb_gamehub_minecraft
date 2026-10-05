import path from "node:path";
import type { RuntimeAttachmentRepository, RuntimeAttachmentDescriptor, RuntimeAttachmentRecord, ExternalEffectIntent } from "./runtime-attachment";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ProvisioningApplyException, terminalProvisioningState, type ProvisioningApplyRepository, type ProvisioningApplyOperation, type ProvisioningApplyStep, type ProvisioningApplyError, type ProvisioningClaim, type ProvisioningEffect, type ProvisioningJournalEntry } from "./provisioning-apply-contracts";
import type { ProvisioningJson, ProvisioningResult, ServerProvisioningPlan } from "./provisioning";

export const provisioningMigration = `
CREATE TABLE provisioning_applies (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE provisioning_claims (operation_id TEXT NOT NULL, resource_key TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(operation_id, resource_key));
CREATE UNIQUE INDEX provisioning_active_claim ON provisioning_claims(resource_key) WHERE state = 'active';
CREATE TABLE provisioning_journal (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX provisioning_journal_operation ON provisioning_journal(operation_id, sequence);
CREATE TABLE provisioning_effects (operation_id TEXT NOT NULL, step_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(operation_id, step_id));
`;

/** All logical effects, claims and journal receipts share one SQLite transaction boundary. */
export class SqliteProvisioningRepository implements ProvisioningApplyRepository, RuntimeAttachmentRepository {
  constructor(private readonly database: () => DatabaseSync) {}
  private tx<T>(run: () => T): T {
    const db = this.database(); db.exec("BEGIN IMMEDIATE;");
    try { const result = run(); db.exec("COMMIT;"); return result; }
    catch (error) { db.exec("ROLLBACK;"); throw error; }
  }
  savePlan(plan: ServerProvisioningPlan, preview?: import("./runtime-attachment").RuntimeAttachmentPreview): void {
    const existing = this.getPlan(plan.planId);
    this.database().prepare("INSERT INTO provisioning_plans(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(plan.planId, JSON.stringify({ plan, ...(preview ? { preview } : existing?.preview ? { preview: existing.preview } : {}) }));
  }
  getPlan(planId: string): { plan: ServerProvisioningPlan; preview?: import("./runtime-attachment").RuntimeAttachmentPreview } | undefined {
    const row = this.database().prepare("SELECT data FROM provisioning_plans WHERE id=?").get(planId);
    return row ? JSON.parse(String(row.data)) : undefined;
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
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, started_at=excluded.started_at, completed_at=excluded.completed_at, error=excluded.error, metadata=excluded.metadata`).run(op.operationId, op.plan.providerId, op.plan.serverId, op.executionKind === "attachment" ? "server.provision.attach" : "server.provision.apply", status, op.createdAt, state === "PLANNED" ? null : op.createdAt, terminal ? op.updatedAt : null, op.error ? JSON.stringify(op.error) : null, JSON.stringify({ result: op.result }));
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
        const key: string[] = JSON.parse(step.resourceKey);
        if (key[0] === "physical-path") {
          for (const claim of this.claims().filter((item) => item.state === "active" && item.operationId !== op.operationId)) {
            const other: string[] = JSON.parse(claim.resourceKey);
            const contains = (a: string, b: string) => { const relative = path.relative(a, b); return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
            if (other[0] === "physical-path" && other[1] === key[1] && (contains(key[2], other[2]) || contains(other[2], key[2]))) throw new ProvisioningApplyException({ code: "RESOURCE_CONFLICT", message: "Runtime roots overlap.", resourceKey: step.resourceKey, ownerOperationId: claim.operationId });
          }
        }
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
  attachmentIntent(operationId: string): ExternalEffectIntent | undefined {
    const row = this.database().prepare("SELECT data FROM provisioning_external_intents WHERE operation_id=?").get(operationId);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  attachmentRecords(providerId?: string): RuntimeAttachmentRecord[] {
    const records = this.database().prepare("SELECT data FROM runtime_attachments ORDER BY effect_id").all().map((row) => JSON.parse(String(row.data)) as RuntimeAttachmentRecord);
    return providerId ? records.filter((record) => record.descriptor.providerId === providerId) : records;
  }
  assertAttachmentRecord(record: RuntimeAttachmentRecord): void {
    const stored = this.attachmentRecords().find((item) => item.effectId === record.effectId);
    if (!stored || stored.digest !== record.digest || stored.fencingToken !== record.fencingToken || this.get(record.operationId)?.result.state !== "PROVISIONED") throw new ProvisioningApplyException({ code: "LEASE_LOST", message: "Attachment is no longer current." });
  }
  assertAttachmentFence(op: ProvisioningApplyOperation, now: string): void { this.fenced(op, now); }
  private saveIntent(intent: ExternalEffectIntent) {
    this.database().prepare("INSERT INTO provisioning_external_intents(operation_id,data) VALUES (?,?) ON CONFLICT(operation_id) DO UPDATE SET data=excluded.data").run(intent.operationId, JSON.stringify(intent));
  }
  intendAttachment(op: ProvisioningApplyOperation, descriptor: RuntimeAttachmentDescriptor, digest: string, now: string): ExternalEffectIntent {
    return this.tx(() => {
      const stored = this.fenced(op, now);
      if (stored.executionKind !== "attachment" || stored.digest !== digest) throw new Error("Attachment intent does not match approval.");
      const existing = this.attachmentIntent(op.operationId);
      if (existing && existing.digest !== digest) throw new Error("Incompatible attachment intent.");
      const intent: ExternalEffectIntent = existing ?? { effectId: `attachment_${op.operationId}`, operationId: op.operationId, digest, descriptor, fencingToken: stored.lease.token, state: "INTENDED", createdAt: now, updatedAt: now };
      intent.fencingToken = stored.lease.token; intent.updatedAt = now;
      this.saveIntent(intent); this.append(stored, "ATTACH_INTENT", "completed", now); return intent;
    });
  }
  publishAttachment(op: ProvisioningApplyOperation, now: string): RuntimeAttachmentRecord {
    return this.tx(() => {
      const stored = this.fenced(op, now); const intent = this.attachmentIntent(op.operationId);
      if (!intent || intent.fencingToken !== stored.lease.token) throw new Error("Current fenced attachment intent required.");
      const claims = this.claims(op.operationId).filter((claim) => claim.state === "active");
      if (!stored.steps.filter((step) => step.kind.startsWith("CLAIM_")).every((step) => claims.some((claim) => claim.resourceKey === step.resourceKey))) throw new Error("Attachment claims are incomplete.");
      const existing = this.attachmentRecords().find((record) => record.effectId === intent.effectId);
      if (existing && existing.digest !== intent.digest) throw new Error("External attachment data is incompatible.");
      const record: RuntimeAttachmentRecord = existing ?? { effectId: intent.effectId, operationId: op.operationId, descriptor: intent.descriptor, digest: intent.digest, fencingToken: stored.lease.token, attachedAt: now };
      record.fencingToken = stored.lease.token;
      this.database().prepare("INSERT INTO runtime_attachments(effect_id,server_id,data) VALUES (?,?,?) ON CONFLICT(effect_id) DO UPDATE SET data=excluded.data").run(record.effectId, record.descriptor.serverId, JSON.stringify(record));
      intent.state = "OBSERVED"; intent.updatedAt = now; this.saveIntent(intent);
      return record;
    });
  }
  receiptAttachment(op: ProvisioningApplyOperation, now: string, reconciled: boolean): void {
    this.tx(() => {
      const stored = this.fenced(op, now); const intent = this.attachmentIntent(op.operationId);
      const record = this.attachmentRecords().find((item) => item.operationId === op.operationId);
      if (!intent || !record || intent.digest !== record.digest || record.fencingToken !== stored.lease.token) throw new Error("Verified current attachment record required for receipt.");
      intent.state = reconciled ? "RECONCILED" : "RECEIPTED"; intent.updatedAt = now;
      intent.receipt = { effectId: record.effectId, digest: record.digest, fencingToken: stored.lease.token, recordedAt: now, reconciled };
      this.saveIntent(intent);
      const step = stored.steps.find((item) => item.kind === "ATTACH_RUNTIME")!;
      this.database().prepare("INSERT INTO provisioning_effects(operation_id,step_id,data) VALUES (?,?,?) ON CONFLICT(operation_id,step_id) DO UPDATE SET data=excluded.data").run(op.operationId, step.id, JSON.stringify({ operationId: op.operationId, step, value: intent.receipt }));
      this.append(stored, reconciled ? "ATTACH_RECONCILED" : step.id, "completed", now);
    });
  }
  removeAttachment(op: ProvisioningApplyOperation, now: string): void {
    this.tx(() => {
      const stored = this.fenced(op, now); const intent = this.attachmentIntent(op.operationId);
      if (intent) {
        this.database().prepare("DELETE FROM runtime_attachments WHERE effect_id=?").run(intent.effectId);
        intent.state = "ROLLED_BACK"; intent.fencingToken = stored.lease.token; intent.updatedAt = now; this.saveIntent(intent);
      }
      for (const effect of this.effects(op.operationId).filter((item) => item.step.kind === "ATTACH_RUNTIME")) this.database().prepare("DELETE FROM provisioning_effects WHERE operation_id=? AND step_id=?").run(op.operationId, effect.step.id);
      this.append(stored, "ATTACH_RUNTIME", "compensated", now);
    });
  }

}
