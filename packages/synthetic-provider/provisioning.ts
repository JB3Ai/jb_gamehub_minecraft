import { DescriptiveProvisioningPlanner } from "../core/provisioning-planner";
import { freezeProvisioningData } from "../core/provisioning";
import type { ProvisioningProfileAdapter } from "../core/provisioning-profile";

export class SyntheticProvisioningPlanner extends DescriptiveProvisioningPlanner {
  constructor(providerId = "synthetic", now: () => Date = () => new Date()) {
    const profileAdapter: ProvisioningProfileAdapter = {
      profile: () => freezeProvisioningData({
        providerId, version: "1", runtimeKind: "synthetic",
        supportedModes: ["create", "adopt"],
        defaultEndpoints: [{ id: "control", protocol: "synthetic-control", transport: "virtual" }],
        requiredEndpoints: [], storageRequirements: ["Approved root or adoption reference"],
        runtimeRequirements: [], configurationRequirements: [], worldIntentSupport: [],
        lifecycleCompatibility: ["server.start", "server.stop", "server.restart"],
        capabilities: { planning: true, preflight: true, apply: false }, providerDefaults: {},
      }),
      requirements: () => ({ issues: [], artifacts: [] }),
    };
    super(providerId, "synthetic-plan-v1", "Synthetic", now, profileAdapter);
  }
}
