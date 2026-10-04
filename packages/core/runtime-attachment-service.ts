import { randomUUID } from "node:crypto";
import { freezeProvisioningData, type ProvisioningPlanner, type ServerProvisioningPlan } from "./provisioning";
import { ProvisioningApplyException, ProvisioningInterrupted, terminalProvisioningState, type ProvisioningApplyOperation, type ProvisioningApplyRepository, type ProvisioningApplyStep } from "./provisioning-apply-contracts";
import { attachmentDigest, type RuntimeAttachmentAdapter, type RuntimeAttachmentPolicy, type RuntimeAttachmentPreview, type RuntimeAttachmentRepository, type RuntimeAttachmentRequest } from "./runtime-attachment";
import { verifyRuntimeAttachment } from "./runtime-attachment-verification";

export interface RuntimeAttachmentHooks { afterClaims?: () => Promise<void>; afterRecord?: () => Promise<void>; afterProviderAttach?: () => Promise<void>; afterReceipt?: () => Promise<void> }
export interface RuntimeAttachmentServiceOptions { now?: () => Date; leaseMs?: number; hooks?: RuntimeAttachmentHooks }
export class RuntimeAttachmentService {
  private readonly workerId = randomUUID();
  private readonly now: () => Date;
  private readonly leaseMs: number;
  constructor(private readonly repository: ProvisioningApplyRepository & RuntimeAttachmentRepository, private readonly planner: ProvisioningPlanner, private readonly adapter: RuntimeAttachmentAdapter, private readonly options: RuntimeAttachmentServiceOptions = {}) {
    this.now = options.now ?? (() => new Date()); this.leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0) throw new Error("Positive attachment lease required.");
  }
  private clock() { const now = this.now(); return { now: now.toISOString(), expiresAt: new Date(now.getTime() + this.leaseMs).toISOString() }; }
  async preview(plan: ServerProvisioningPlan, policy: RuntimeAttachmentPolicy): Promise<RuntimeAttachmentPreview> {
    return verifyRuntimeAttachment(plan, this.planner, this.adapter, policy, this.clock().now);
  }
  private steps(preview: RuntimeAttachmentPreview): ProvisioningApplyStep[] {
    const { plan, descriptor } = preview; const key = (...parts: string[]) => JSON.stringify(parts);
    const root = process.platform === "win32" ? descriptor.runtimeRoot.toLowerCase() : descriptor.runtimeRoot;
    const steps: ProvisioningApplyStep[] = [{ id: "01-claim-server", kind: "CLAIM_SERVER_ID", resourceKey: key("server", plan.serverId) }, { id: "02-claim-path", kind: "CLAIM_MANAGED_PATH", resourceKey: key("physical-path", descriptor.hostId, root) }];
    const keys = new Set<string>();
    for (const endpoint of descriptor.endpoints) {
      if (endpoint.transport === "virtual" || endpoint.port.mode !== "fixed") throw new Error("Attachment requires concrete configured network endpoints.");
      const resourceKey = key("endpoint", descriptor.hostId, endpoint.transport, String(endpoint.port.value));
      if (keys.has(resourceKey)) throw new Error("Attachment endpoint claims overlap."); keys.add(resourceKey);
      steps.push({ id: `03-endpoint-${endpoint.id}`, kind: "CLAIM_ENDPOINT", resourceKey });
    }
    steps.push({ id: "04-attach", kind: "ATTACH_RUNTIME", resourceKey: descriptor.runtimeRoot }); return steps;
  }
  async attach(input: RuntimeAttachmentRequest, policy: RuntimeAttachmentPolicy, actor: string): Promise<ProvisioningApplyOperation> {
    const snapshot = freezeProvisioningData(JSON.parse(JSON.stringify(input))) as RuntimeAttachmentRequest;
    if (snapshot.approved !== true || !actor.trim() || snapshot.digest !== attachmentDigest(snapshot.plan, snapshot.descriptor)) throw new ProvisioningApplyException({ code: "APPROVAL_REQUIRED", message: "Attachment requires approval of the verified manifest and plan." });
    const fresh = await this.preview(snapshot.plan, policy);
    if (fresh.digest !== snapshot.digest) throw new ProvisioningApplyException({ code: "ARTIFACT_DRIFT", message: "Approved runtime artifacts or policy resolution changed." });
    const time = this.clock(); const plan = snapshot.plan;
    const candidate: ProvisioningApplyOperation = { executionKind: "attachment", attachment: snapshot.descriptor, operationId: `attach_${plan.planId}`, plan, digest: snapshot.digest, actor,
      steps: this.steps(snapshot), result: { requestId: plan.requestId, planId: plan.planId, providerId: plan.providerId, serverId: plan.serverId, state: "PLANNED", outcome: "planned", issues: [] }, rollbackErrors: [], createdAt: time.now, updatedAt: time.now, lease: { owner: this.workerId, token: 1, expiresAt: time.expiresAt } };
    const begun = this.repository.begin(candidate);
    if (terminalProvisioningState(begun.operation.result.state)) return this.restoreTerminal(begun.operation);
    const op = begun.acquired ? begun.operation : this.repository.acquire(begun.operation.operationId, this.workerId, time.now, time.expiresAt);
    return this.run(op, policy);
  }
  async recover(id: string, policy: RuntimeAttachmentPolicy): Promise<ProvisioningApplyOperation> {
    const existing = this.repository.get(id);
    if (!existing || existing.executionKind !== "attachment") throw new Error("Attachment operation not found.");
    if (terminalProvisioningState(existing.result.state)) {
      if (existing.result.state === "PROVISIONED" && (await this.preview(existing.plan, policy)).digest !== existing.digest) throw new Error("Attached runtime has changed; reapproval required.");
      return this.restoreTerminal(existing);
    }
    const time = this.clock(); return this.run(this.repository.acquire(id, this.workerId, time.now, time.expiresAt), policy);
  }
  private restoreTerminal(op: ProvisioningApplyOperation) {
    if (op.result.state === "PROVISIONED") {
      const record = this.repository.attachmentRecords().find((item) => item.operationId === op.operationId);
      if (!record || !this.repository.attachmentIntent(op.operationId)?.receipt) throw new Error("Completed attachment is missing durable evidence.");
      this.adapter.attach(record, () => this.repository.assertAttachmentRecord(record));
    }
    return op;
  }
  private async run(initial: ProvisioningApplyOperation, policy: RuntimeAttachmentPolicy): Promise<ProvisioningApplyOperation> {
    let op = initial;
    if (["FAILED", "ROLLING_BACK"].includes(op.result.state)) return this.rollback(op);
    op = this.repository.transition(op, "APPLYING", this.clock().now);
    try {
      if (!op.attachment || (await this.preview(op.plan, policy)).digest !== op.digest) throw new Error("Runtime no longer matches approved attachment.");
      this.repository.intendAttachment(op, op.attachment, op.digest, this.clock().now);
      for (const step of op.steps.filter((step) => step.kind.startsWith("CLAIM_"))) {
        const time = this.clock(); if (this.repository.startStep(op, step, time.now, time.expiresAt)) this.repository.completeStep(op, step, { externalReferenceOnly: true }, this.clock().now);
      }
      await this.options.hooks?.afterClaims?.();
      if ((await this.preview(op.plan, policy)).digest !== op.digest) throw new Error("Runtime changed before attachment publication.");
      const existed = this.repository.attachmentRecords().some((record) => record.operationId === op.operationId);
      const step = op.steps.find((item) => item.kind === "ATTACH_RUNTIME")!; const time = this.clock();
      this.repository.startStep(op, step, time.now, time.expiresAt);
      // Publishing the reference and committing its receipt are deliberately separate commits.
      const record = this.repository.publishAttachment(op, this.clock().now);
      await this.options.hooks?.afterRecord?.();
      this.adapter.attach(record, () => this.repository.assertAttachmentFence(op, this.clock().now));
      await this.options.hooks?.afterProviderAttach?.();
      this.repository.receiptAttachment(op, this.clock().now, existed);
      await this.options.hooks?.afterReceipt?.();
      return this.repository.transition(op, "PROVISIONED", this.clock().now);
    } catch (error) {
      if (error instanceof ProvisioningInterrupted || (error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST")) throw error;
      const detail = error instanceof ProvisioningApplyException ? error.detail : { code: "ATTACHMENT_FAILED", message: error instanceof Error ? error.message : String(error) };
      op = this.repository.transition(op, "FAILED", this.clock().now, detail);
      return this.rollback(op);
    }
  }
  private rollback(initial: ProvisioningApplyOperation): ProvisioningApplyOperation {
    const op = this.repository.transition(initial, "ROLLING_BACK", this.clock().now);
    try {
      const intent = this.repository.attachmentIntent(op.operationId);
      if (intent) this.adapter.detach(intent.effectId, () => this.repository.assertAttachmentFence(op, this.clock().now));
      this.repository.removeAttachment(op, this.clock().now);
      return this.repository.finishRollback(op, this.clock().now, []);
    } catch (error) {
      if (error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST") throw error;
      return this.repository.finishRollback(op, this.clock().now, [{ code: "ATTACHMENT_ROLLBACK_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    }
  }
}
