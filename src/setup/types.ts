import type { SetupConfiguration, SetupOptionsResponse, SetupProviderId, SetupWizardStep, ProvisioningPlanResponse, ProvisioningPreflightResponse, ProvisioningApplyResponse } from "../dashboard/provisioningTypes";
export interface SetupWizardError { code?: string; message: string }
export interface SetupWizardState {
  step: SetupWizardStep; configuration: SetupConfiguration; options?: SetupOptionsResponse;
  loading: boolean; generation: number; error?: SetupWizardError;
  plan?: ProvisioningPlanResponse; preflight?: ProvisioningPreflightResponse;
  approved: boolean; apply?: ProvisioningApplyResponse;
  applyFailure?: "recheck" | "rolled-back" | "partial" | "unknown";
}
export type SetupWizardAction =
  | { type: "OPEN" | "RESET"; generation: number }
  | { type: "OPTIONS_STARTED"; generation: number }
  | { type: "CREDENTIAL_CHANGED"; generation: number }
  | { type: "OPTIONS_LOADED"; generation: number; options: SetupOptionsResponse }
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
