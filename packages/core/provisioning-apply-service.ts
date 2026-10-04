import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { freezeProvisioningData, parseProvisioningRequest, type ProvisioningPlanner, type ServerProvisioningPlan } from "./provisioning";
import { ProvisioningApplyException, ProvisioningInterrupted, provisioningDigest, terminalProvisioningState, type ProvisioningApplyRepository, type ProvisioningApplyRequest, type ProvisioningApplyOperation, type ProvisioningApplyError, type ProvisioningApplyStep, type ProvisioningSimulationExecutor } from "./provisioning-apply-contracts";

export interface ProvisioningApplyServiceOptions { now?: () => Date; leaseMs?: number; workerId?: string }
const failure = (error: unknown): ProvisioningApplyError => error instanceof ProvisioningApplyException ? error.detail : { code: "PROVISIONING_STEP_FAILED", message: error instanceof Error ? error.message : String(error) };

/** Simulation effects live exclusively behind the durable repository. No OS runtime operations. */
export class ProvisioningApplyService {
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly workerId: string;
  constructor(private readonly repository: ProvisioningApplyRepository, private readonly planner: ProvisioningPlanner, private readonly executor: ProvisioningSimulationExecutor, options: ProvisioningApplyServiceOptions = {}) {
    this.now = options.now ?? (() => new Date()); this.leaseMs = options.leaseMs ?? 30_000; this.workerId = options.workerId ?? randomUUID();
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0) throw new Error("leaseMs must be positive.");
  }
  private clock() { const now = this.now(); return { now: now.toISOString(), expiresAt: new Date(now.getTime() + this.leaseMs).toISOString() }; }
  private async validate(plan: ServerProvisioningPlan) {
    if (this.executor.executionMode !== "simulation") throw new ProvisioningApplyException({ code: "APPLY_UNSUPPORTED", message: "Only simulation execution is enabled." });
    const expected = await this.planner.plan(parseProvisioningRequest(plan.request));
    if (provisioningDigest(expected) !== provisioningDigest(plan)) throw new ProvisioningApplyException({ code: "PLAN_MISMATCH", message: "Plan no longer matches the provider adapter." });
    if (plan.mode !== "create") throw new ProvisioningApplyException({ code: "MODE_UNSUPPORTED", message: "Synthetic apply currently supports create only." });
  }
  private steps(plan: ServerProvisioningPlan): ProvisioningApplyStep[] {
    const storage = plan.managedPaths[0].reference;
    if (storage.mode !== "create") throw new Error("Create storage required.");
    const key = (...parts: string[]) => JSON.stringify(parts);
    const pathKey = key("path", plan.request.hostId, storage.rootId.toLowerCase(), storage.directoryName!.toLowerCase());
    const steps: ProvisioningApplyStep[] = [
      { id: "01-claim-server", kind: "CLAIM_SERVER_ID", resourceKey: key("server", plan.serverId) },
      { id: "02-claim-path", kind: "CLAIM_MANAGED_PATH", resourceKey: pathKey },
    ];
    const endpointKeys = new Set<string>();
    for (const endpoint of plan.request.endpoints) {
      let resourceKey: string;
      if (endpoint.transport === "virtual") resourceKey = key("endpoint", plan.request.hostId, "virtual", plan.serverId, endpoint.id);
      else {
        if (endpoint.port.mode !== "fixed" || !isIP(endpoint.bindAddress)) throw new ProvisioningApplyException({ code: "ENDPOINT_UNSUPPORTED", message: "Apply needs fixed literal-IP endpoint proposals; allocation is deferred." });
        // Conservatively claim the whole host/transport/port bucket, including wildcard aliases.
        resourceKey = key("endpoint", plan.request.hostId, endpoint.transport, String(endpoint.port.value));
      }
      if (endpointKeys.has(resourceKey)) throw new ProvisioningApplyException({ code: "ENDPOINT_OVERLAP", message: "Endpoint requests overlap the same logical claim bucket." });
      endpointKeys.add(resourceKey);
      steps.push({ id: `03-endpoint-${endpoint.id}`, kind: "CLAIM_ENDPOINT", resourceKey });
    }
    steps.sort((a, b) => a.id.localeCompare(b.id));
    steps.push({ id: "04-directory", kind: "CREATE_MANAGED_DIRECTORY", resourceKey: pathKey }, { id: "05-configuration", kind: "WRITE_CONFIGURATION", resourceKey: pathKey }, { id: "06-registration", kind: "REGISTER_SERVER", resourceKey: key("server", plan.serverId) });
    return steps;
  }
  async apply(input: ProvisioningApplyRequest, actor: string): Promise<ProvisioningApplyOperation> {
    if (input.approved !== true || input.digest !== provisioningDigest(input.plan) || !actor.trim()) throw new ProvisioningApplyException({ code: "APPROVAL_REQUIRED", message: "Explicit approval, matching digest and trusted actor are required." });
    // Snapshot before awaits: caller mutation cannot change approved work.
    const plan = freezeProvisioningData(JSON.parse(JSON.stringify(input.plan))) as ServerProvisioningPlan;
    const digest = input.digest;
    await this.validate(plan);
    const time = this.clock();
    const candidate: ProvisioningApplyOperation = {
      operationId: `apply_${plan.planId}`, plan, digest, actor, steps: this.steps(plan),
      result: { requestId: plan.requestId, planId: plan.planId, providerId: plan.providerId, serverId: plan.serverId, state: "PLANNED", outcome: "planned", issues: [] },
      rollbackErrors: [], createdAt: time.now, updatedAt: time.now, lease: { owner: this.workerId, token: 1, expiresAt: time.expiresAt },
    };
    const begun = this.repository.begin(candidate);
    if (terminalProvisioningState(begun.operation.result.state)) return this.snapshot(begun.operation);
    const operation = begun.acquired ? begun.operation : this.repository.acquire(begun.operation.operationId, this.workerId, time.now, time.expiresAt);
    return this.run(operation);
  }
  async recover(operationId: string): Promise<ProvisioningApplyOperation> {
    const existing = this.repository.get(operationId);
    if (!existing) throw new ProvisioningApplyException({ code: "OPERATION_NOT_FOUND", message: "Apply operation does not exist." });
    await this.validate(existing.plan);
    if (terminalProvisioningState(existing.result.state)) return this.snapshot(existing);
    const time = this.clock();
    return this.run(this.repository.acquire(operationId, this.workerId, time.now, time.expiresAt));
  }
  private snapshot(operation: ProvisioningApplyOperation): ProvisioningApplyOperation {
    // Public snapshots cannot modify repository state; JSON also guards durable value shape.
    return JSON.parse(JSON.stringify(operation));
  }
  private async run(operation: ProvisioningApplyOperation): Promise<ProvisioningApplyOperation> {
    let op = operation;
    if (["FAILED", "ROLLING_BACK"].includes(op.result.state)) return this.rollback(op);
    op = this.repository.transition(op, "APPLYING", this.clock().now);
    let activeStep: string | undefined;
    try {
      for (const step of op.steps) {
        activeStep = step.id;
        const time = this.clock();
        if (!this.repository.startStep(op, step, time.now, time.expiresAt)) continue;
        const value = await this.executor.execute(step, op.plan);
        this.repository.completeStep(op, step, value, this.clock().now);
        await this.executor.afterStep?.(step);
      }
      return this.snapshot(this.repository.transition(op, "PROVISIONED", this.clock().now));
    } catch (error) {
      if (error instanceof ProvisioningInterrupted || (error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST")) throw error;
      op = this.repository.transition(op, "FAILED", this.clock().now, { ...failure(error), ...(activeStep ? { stepId: activeStep } : {}) });
      return this.rollback(op);
    }
  }
  private async rollback(operation: ProvisioningApplyOperation): Promise<ProvisioningApplyOperation> {
    const op = this.repository.transition(operation, "ROLLING_BACK", this.clock().now);
    const errors: ProvisioningApplyError[] = [];
    const effects = this.repository.effects(op.operationId).filter((effect) => !effect.step.kind.startsWith("CLAIM_")).reverse();
    for (const effect of effects) {
      this.repository.compensate(op, effect, "compensating", this.clock().now);
      try {
        await this.executor.compensate(effect);
        this.repository.compensate(op, effect, "compensated", this.clock().now);
      } catch (error) {
        if (error instanceof ProvisioningInterrupted || (error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST")) throw error;
        const detail = failure(error); errors.push(detail);
        this.repository.compensate(op, effect, "compensation_failed", this.clock().now, detail);
        // Retain prerequisites of a resource whose compensation failed.
        break;
      }
    }
    return this.snapshot(this.repository.finishRollback(op, this.clock().now, errors));
  }
}
