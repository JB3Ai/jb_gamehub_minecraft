import type { ProvisioningEndpointRequest, ProvisioningIssue, ProvisioningReadonly, ServerProvisioningRequest } from "./provisioning";

export type ProvisioningProfile = ProvisioningReadonly<{
  providerId: string;
  version: string;
  runtimeKind: string;
  supportedModes: Array<"create" | "adopt">;
  defaultEndpoints: ProvisioningEndpointRequest[];
  requiredEndpoints: Array<{ id: string; protocol: string; transport: "tcp" | "udp" | "virtual" }>;
  storageRequirements: string[];
  runtimeRequirements: string[];
  configurationRequirements: string[];
  worldIntentSupport: string[];
  lifecycleCompatibility: string[];
  capabilities: { planning: true; preflight: true; apply: boolean };
  providerDefaults: Record<string, string | number | boolean>;
}>;

export type RuntimeArtifactRequirement =
  | { id: string; source: "target"; relativePath: string }
  | { id: string; source: "reference"; reference: string };
export interface ProfileRequirements {
  issues: ProvisioningIssue[];
  artifacts: RuntimeArtifactRequirement[];
}
export interface ProvisioningProfileAdapter {
  profile(): ProvisioningProfile;
  requirements(request: ServerProvisioningRequest): ProfileRequirements;
}
