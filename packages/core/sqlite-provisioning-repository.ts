import path from "node:path";
import { creationHash, type ResolvedRuntimeBundle, type ManagedCreationRepository, type ManagedCreatePreview, type ManagedRuntimeDefinition, type FileEffectIntent, type FileEffectReceipt } from "./managed-create";
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
export class SqliteProvisioningRepository implements ProvisioningApplyRepository, RuntimeAttachmentRepository, ManagedCreationRepository {
  private managedScope = false;
  constructor(private readonly database: () => DatabaseSync) {}
  private tx<T>(run: () => T): T {
    const db = this.database(); db.exec("BEGIN IMMEDIATE;");
    try { const result = run(); db.exec("COMMIT;"); return result; }
    catch (error) { db.exec("ROLLBACK;"); throw error; }
  }

  saveManagedPreview(preview: ManagedCreatePreview): void {
    this.database().prepare("INSERT INTO provisioning_create_previews(plan_id,data) VALUES (?,?) ON CONFLICT(plan_id) DO UPDATE SET data=excluded.data").run(preview.plan.planId, JSON.stringify(preview));
  }
  getManagedPreview(planId: string): ManagedCreatePreview | undefined {
    const row = this.database().prepare("SELECT data FROM provisioning_create_previews WHERE plan_id=?").get(planId);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  saveManagedBundle(id: string, bundle: ResolvedRuntimeBundle): void {
    if (creationHash(bundle) !== id) throw new Error("Bundle snapshot digest mismatch.");
    this.database().prepare("INSERT INTO managed_runtime_bundles(id,data) VALUES (?,?) ON CONFLICT(id) DO NOTHING").run(id, JSON.stringify(bundle));
    if (creationHash(this.getManagedBundle(id)) !== id) throw new Error("Incompatible bundle snapshot.");
  }
  getManagedBundle(id: string): ResolvedRuntimeBundle | undefined {
    const row = this.database().prepare("SELECT data FROM managed_runtime_bundles WHERE id=?").get(id);
    if (!row) return undefined;
    const bundle = JSON.parse(String(row.data)) as ResolvedRuntimeBundle;
    if (creationHash(bundle) !== id) throw new Error("Bundle snapshot drift.");
    return bundle;
  }
  beginManaged(op: ProvisioningApplyOperation, steps: ProvisioningApplyStep[]) {
    return this.tx(() => {
      const existing = this.get(op.operationId);
      if (existing) {
        if (existing.digest !== op.digest || existing.executionKind !== "managed-create") throw new ProvisioningApplyException({ code: "APPROVAL_MISMATCH", message: "Managed approval differs." });
        return { operation: existing, acquired: false };
      }
      for (const step of steps) {
        const key: string[] = JSON.parse(step.resourceKey);
        const claims = this.claims().filter((claim) => claim.state === "active");
        if (claims.some((claim) => claim.resourceKey === step.resourceKey)) throw new ProvisioningApplyException({ code: "RESOURCE_CONFLICT", message: "Resource is already claimed." });
        if (key[0] === "physical-path") for (const claim of claims) {
          const other: string[] = JSON.parse(claim.resourceKey);
          const inside = (a: string, b: string) => { const relative = path.relative(a, b); return !relative || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)); };
          if (other[0] === "physical-path" && other[1] === key[1] && (inside(other[2], key[2]) || inside(key[2], other[2]))) throw new ProvisioningApplyException({ code: "RESOURCE_CONFLICT", message: "Runtime roots overlap." });
        }
        const claim: ProvisioningClaim = { resourceKey: step.resourceKey, operationId: op.operationId, planId: op.plan.planId, kind: step.kind, state: "active", createdAt: op.createdAt, updatedAt: op.createdAt };
        this.database().prepare("INSERT INTO provisioning_claims(operation_id,resource_key,state,data) VALUES (?,?,'active',?)").run(op.operationId, step.resourceKey, JSON.stringify(claim));
      }
      this.database().prepare("INSERT INTO provisioning_applies(id,plan_id,state,data) VALUES (?,?,?,?)").run(op.operationId, op.plan.planId, op.result.state, JSON.stringify(op));
      this.history(op); this.append(op, "CLAIMS_ACQUIRED", "completed", op.createdAt);
      return { operation: op, acquired: true };
    });
  }
  managedGuard<T>(op: ProvisioningApplyOperation, now: string, expiresAt: string, run: () => T): T {
    if (this.managedScope) throw new Error("Nested managed mutation guard is forbidden.");
    return this.tx(() => {
      const stored = this.fenced(op, now);
      stored.lease.expiresAt = expiresAt; stored.updatedAt = now; this.save(stored);
      this.managedScope = true;
      try {
        const result = run();
        if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Managed mutation guard requires synchronous primitives.");
        return result;
      } finally { this.managedScope = false; }
    });
  }
  private managedTx<T>(run: () => T): T { return this.managedScope ? run() : this.tx(run); }
  intendFile(op: ProvisioningApplyOperation, intent: FileEffectIntent, now: string): void {
    this.managedTx(() => {
      this.fenced(op, now);
      const existing = this.fileIntents(op.operationId).find((item) => item.id === intent.id);
      if (existing) { const { fencingToken: _old, ...original } = existing; const { fencingToken: _new, ...requested } = intent; if (JSON.stringify(original) !== JSON.stringify(requested)) throw new Error("Incompatible file intent."); return; }
      this.database().prepare("INSERT INTO provisioning_file_intents(operation_id,effect_id,data) VALUES (?,?,?)").run(op.operationId, intent.id, JSON.stringify({ ...intent, fencingToken: op.lease.token }));
      this.append(op, intent.id, "started", now);
    });
  }
  fileIntents(operationId: string): FileEffectIntent[] {
    return this.database().prepare("SELECT data FROM provisioning_file_intents WHERE operation_id=? ORDER BY rowid").all(operationId).map((row) => JSON.parse(String(row.data)));
  }
  fileReceipts(operationId: string): FileEffectReceipt[] {
    return this.database().prepare("SELECT data FROM provisioning_file_receipts WHERE operation_id=? ORDER BY rowid").all(operationId).map((row) => JSON.parse(String(row.data)));
  }
  receiptFile(op: ProvisioningApplyOperation, receipt: FileEffectReceipt, now: string): void {
    this.managedTx(() => {
      this.fenced(op, now);
      if (!this.fileIntents(op.operationId).some((intent) => intent.id === receipt.intentId)) throw new Error("Durable file intent required.");
      this.database().prepare("INSERT INTO provisioning_file_receipts(operation_id,effect_id,data) VALUES (?,?,?) ON CONFLICT(operation_id,effect_id) DO UPDATE SET data=excluded.data").run(op.operationId, receipt.intentId, JSON.stringify({ ...receipt, fencingToken: op.lease.token }));
      this.append(op, receipt.intentId, receipt.compensated ? "compensated" : "completed", now);
    });
  }
  journalManagedPhase(op: ProvisioningApplyOperation, phase: string, status: "started" | "completed", now: string): void {
    this.managedTx(() => { this.fenced(op, now); this.append(op, phase, status, now); });
  }
  managedDefinitions(): ManagedRuntimeDefinition[] { return this.database().prepare("SELECT data FROM managed_runtime_definitions ORDER BY server_id").all().map((row) => JSON.parse(String(row.data))); }
  publishManagedDefinition(op: ProvisioningApplyOperation, definition: ManagedRuntimeDefinition, now: string): void {
    this.managedTx(() => {
      this.fenced(op, now);
      const previous = this.managedDefinitions().find((record) => record.descriptor.serverId === op.plan.serverId);
      if (previous && (previous.operationId !== op.operationId || previous.digest !== definition.digest)) throw new ProvisioningApplyException({ code: "RESOURCE_CONFLICT", message: "Managed definition already exists." });
      this.database().prepare("INSERT INTO managed_runtime_definitions(server_id,operation_id,data) VALUES (?,?,?) ON CONFLICT(server_id) DO UPDATE SET data=excluded.data").run(op.plan.serverId, op.operationId, JSON.stringify(definition));
      this.append(op, "DEFINITION_PERSISTED", "completed", now);
    });
  }
  guardManagedDefinition<T>(definition: ManagedRuntimeDefinition, run: () => T): T {
    return this.tx(() => {
      const current = this.managedDefinitions().find((record) => record.operationId === definition.operationId);
      if (!current || current.state !== "ACTIVE" || current.digest !== definition.digest || current.fencingToken !== definition.fencingToken || this.get(current.operationId)?.result.state !== "PROVISIONED") throw new ProvisioningApplyException({ code: "LEASE_LOST", message: "Managed definition is no longer current." });
      const result = run(); if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Synchronous activation required."); return result;
    });
  }
  removeManagedDefinition(op: ProvisioningApplyOperation, now: string): void {
    this.managedTx(() => { this.fenced(op, now); this.database().prepare("DELETE FROM managed_runtime_definitions WHERE operation_id=?").run(op.operationId); this.append(op, "DEFINITION_REMOVED", "compensated", now); });
  }
  finishManaged(op: ProvisioningApplyOperation, now: string): ProvisioningApplyOperation {
    return this.managedTx(() => {
      const stored = this.fenced(op, now), definition = this.managedDefinitions().find((record) => record.operationId === op.operationId);
      if (!definition || definition.fencingToken !== stored.lease.token) throw new Error("Current managed definition required.");
      definition.state = "ACTIVE";
      this.database().prepare("UPDATE managed_runtime_definitions SET data=? WHERE operation_id=?").run(JSON.stringify(definition), op.operationId);
      stored.result.state = "PROVISIONED"; stored.result.outcome = "applied"; stored.updatedAt = now;
      this.save(stored); this.append(stored, "FINALIZED", "completed", now); this.history(stored); return stored;
    });
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
  acquireRollback(id: string, digest: string, actor: string, owner: string, now: string, expiresAt: string) {
    return this.tx(() => {
      const op = this.get(id);
      if (!op || op.executionKind !== "managed-create" || !op.creation) throw new ProvisioningApplyException({ code: "OPERATION_NOT_FOUND", message: "Managed creation operation required." });
      if (!actor.trim() || op.digest !== digest) throw new ProvisioningApplyException({ code: "APPROVAL_MISMATCH", message: "Rollback approval differs." });
      if (op.result.state === "ROLLED_BACK") return op;
      if (op.result.state !== "PARTIALLY_ROLLED_BACK" && !(op.result.state === "ROLLING_BACK" && op.rollbackRecovery)) throw new ProvisioningApplyException({ code: "ROLLBACK_STATE_CONFLICT", message: "Only partial rollback may be explicitly retried." });
      if (op.lease.expiresAt > now) throw new ProvisioningApplyException({ code: "APPLY_IN_PROGRESS", message: "An unexpired lease still owns this operation." });
      op.lease = { owner, token: op.lease.token + 1, expiresAt };
      op.rollbackRecovery = { actor, approvedAt: now }; op.updatedAt = now;
      op.result.state = "ROLLING_BACK"; op.result.outcome = "failed";
      this.save(op); this.append(op, "ROLLBACK_RECOVERY", "started", now); this.history(op);
      this.database().prepare("INSERT INTO audit_log(id,timestamp,actor,action,provider_id,server_id,operation_id,result,metadata) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), now, actor, "provisioning.rollback.recovery.approved", op.plan.providerId, op.plan.serverId, id, "completed", JSON.stringify({ digest, fencingToken: op.lease.token }));
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
      if (stored.executionKind === "managed-create" && !errors.length) {
        const receipts = this.fileReceipts(op.operationId);
        const uncompensated = this.fileIntents(op.operationId).some((intent) => !intent.direction && !["write", "remove-temp"].includes(intent.kind) && receipts.some((receipt) => receipt.intentId === intent.id && !receipt.compensated));
        if (uncompensated) errors = [{ code: "OWNERSHIP_UNVERIFIED", message: "Managed compensation receipts remain incomplete." }];
      }
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
