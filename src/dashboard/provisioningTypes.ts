/** Public HTTP projections only; no imports of private provider/policy models. */
export type SetupProviderId = "minecraft" | "minecraft-bedrock";
export type SetupWizardStep = "choose-provider" | "configure" | "preflight" | "review" | "provisioning" | "complete" | "error";
export interface SetupEndpoint {
  id: string; protocol: string; transport: "tcp" | "udp"; bindAddress: string;
  port: { mode: "fixed"; value: number };
}
export interface SetupProfileOption {
  profileRef: string; revision: string; label: string; defaults: { worldName?: string };
  available: boolean;
  storage?: { rootId: string; directoryName: string };
  requestDefaults?: { hostId: string; endpoints: SetupEndpoint[]; serverId?: string };
}
export interface SetupProviderOption { providerId: SetupProviderId; label: string; profiles: SetupProfileOption[] }
export interface SetupOptionsResponse { providers: SetupProviderOption[] }
export interface SetupConfiguration {
  providerId?: SetupProviderId; profileRef?: string; serverId: string; displayName: string; worldName: string;
}
export interface ProvisioningIssue { code: string; severity: "blocking" | "warning" }
export interface CreateProvisioningRequest {
  schemaVersion: 1; providerId: SetupProviderId; serverId: string; displayName: string; hostId: string;
  storage: { mode: "create"; rootId: string; directoryName: string };
  endpoints: SetupEndpoint[]; providerOptions: { profileRef: string; worldName: string };
}
export interface PublicProvisioningPlan {
  schemaVersion: 1; planId: string; providerId: SetupProviderId; serverId: string; displayName: string; mode: "create";
  status: "planned" | "blocked" | "expired"; request: CreateProvisioningRequest;
  validation: { valid: boolean; errors: ProvisioningIssue[] };
}
export interface ProvisioningPlanResponse { plan: PublicProvisioningPlan; digest: string }
export interface PublicCreationPreview {
  digest: string; ownership: "MANAGED"; profileId: string; serverId: string; directoryName: string;
  files: Array<{ name: string; relativePath: string; sha256: string; size: number }>;
  endpoints: SetupEndpoint[]; worldName: string; startup: "remain-stopped";
  deferredValidations: string[];
  bundle?: { version: string; digest: string; fileCount: number; totalBytes: number };
}
export interface ProvisioningPreflightResponse {
  status: "PASS" | "WARN" | "FAIL"; issues: ProvisioningIssue[]; creation?: PublicCreationPreview;
}
export interface ProvisioningConnection { token: string; signal?: AbortSignal }
export interface ProvisioningApplyRequest { planId: string; digest: string; approved: true }
export interface ProvisioningApplyResponse {
  operationId: string; providerId: SetupProviderId; serverId: string;
  state: string; outcome: string; ownership: "MANAGED";
  error?: { code: string; message: string };
  residuals: Array<{ code: string; directoryName?: string; retainedClaims?: number }>;
}
/** Read-only reconciliation of a previously submitted CREATE. It never approves or applies. */
export interface ReconciledSetup {
  plan: ProvisioningPlanResponse;
  preflight: ProvisioningPreflightResponse;
  apply: ProvisioningApplyResponse;
}
