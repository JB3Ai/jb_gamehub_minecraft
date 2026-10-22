import type { SetupConfiguration, SetupOptionsResponse, SetupProviderId, SetupWizardStep, ProvisioningPlanResponse, ProvisioningPreflightResponse, ProvisioningApplyResponse, ReconciledSetup } from "../dashboard/provisioningTypes";
import type { HostReadinessReport } from "./hostReadiness";
export type { HostReadinessReport, HostReadinessCheck } from "./hostReadiness";
export interface SetupWizardError { code?: string; message: string }
export interface SetupWizardState {
  step: SetupWizardStep; configuration: SetupConfiguration; options?: SetupOptionsResponse;
  loading: boolean; generation: number; error?: SetupWizardError;
  readiness?: HostReadinessReport;
  plan?: ProvisioningPlanResponse; preflight?: ProvisioningPreflightResponse;
  approved: boolean; apply?: ProvisioningApplyResponse;
  applyFailure?: "recheck" | "rolled-back" | "partial" | "unknown";
}
export type SetupWizardAction =
  | { type: "OPEN" | "RESET"; generation: number }
  | { type: "OPTIONS_STARTED"; generation: number }
  | { type: "READINESS_STARTED"; generation: number }
  | { type: "READINESS_LOADED"; generation: number; report: HostReadinessReport }
  | { type: "READINESS_FAILED"; generation: number; error: SetupWizardError }
  | { type: "CREDENTIAL_CHANGED"; generation: number }
  | { type: "OPTIONS_LOADED"; generation: number; options: SetupOptionsResponse }
  | { type: "RECONCILE_STARTED"; generation: number }
  | { type: "RECONCILED"; generation: number; result: ReconciledSetup }
  | { type: "SELECT_PROVIDER"; providerId: SetupProviderId; serverId: string; generation: number }
  | { type: "UPDATE_CONFIGURATION"; patch: Partial<Pick<SetupConfiguration, "displayName" | "worldName" | "profileRef">>; serverId?: string; generation: number }
  | { type: "PLAN_STARTED"; generation: number }
  | { type: "PLAN_CREATED"; generation: number; plan: ProvisioningPlanResponse }
  | { type: "PREFLIGHT_PASSED" | "PREFLIGHT_FAILED"; generation: number; preflight: ProvisioningPreflightResponse }
  | { type: "BACK"; generation: number }
  | { type: "APPROVAL_CHANGED"; generation: number; approved: boolean }
  | { type: "APPLY_STARTED"; generation: number }
  | { type: "APPLY_SUCCEEDED"; generation: number; result: ProvisioningApplyResponse }
  | { type: "APPLY_FAILED"; generation: number; result?: ProvisioningApplyResponse; code?: string; status?: number }
  | { type: "COMPLETE"; generation: number }
  | { type: "ERROR"; generation: number; error: SetupWizardError };
