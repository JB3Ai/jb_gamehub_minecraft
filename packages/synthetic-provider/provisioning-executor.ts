import type { ProvisioningJson, ServerProvisioningPlan } from "../core/provisioning";
import type { ProvisioningApplyStep, ProvisioningEffect, ProvisioningSimulationExecutor } from "../core/provisioning-apply-contracts";

export interface SyntheticApplyHooks {
  beforeStep?: (step: ProvisioningApplyStep) => Promise<void>;
  afterStep?: (step: ProvisioningApplyStep) => Promise<void>;
  beforeCompensate?: (effect: ProvisioningEffect) => Promise<void>;
}
/** Describes simulation effects only; the repository atomically persists effects and receipts. */
export class SyntheticProvisioningExecutor implements ProvisioningSimulationExecutor {
  readonly executionMode = "simulation" as const;
  constructor(private readonly hooks: SyntheticApplyHooks = {}) {}
  async execute(step: ProvisioningApplyStep, plan: ServerProvisioningPlan): Promise<ProvisioningJson> {
    await this.hooks.beforeStep?.(step);
    return { simulated: true, kind: step.kind, serverId: plan.serverId, providerId: plan.providerId, displayName: plan.displayName, resourceKey: step.resourceKey };
  }
  async afterStep(step: ProvisioningApplyStep): Promise<void> { await this.hooks.afterStep?.(step); }
  async compensate(effect: ProvisioningEffect): Promise<void> { await this.hooks.beforeCompensate?.(effect); }
}
