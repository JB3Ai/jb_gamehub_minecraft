import { initialSetupState, setupWizardReducer } from "../../src/setup/useSetupWizard";
import type { HostReadinessReport } from "../../src/setup/hostReadiness";

export function readinessReport(status: "PASS" | "WARNING" | "BLOCKED" = "PASS"): HostReadinessReport {
  return { schemaVersion: 1, checkedAt: "2026-10-22T10:00:00Z", platform: "win32", status, readOnly: true, authorizationGranted: false,
    checks: [{ id: "host", status, title: "Windows host", message: "Deterministic fixture observation." }],
    configuration: { configured: true, managedRuntimeCount: 0, attachedRuntimeCount: 0, preserveExisting: true } };
}
/** Existing provisioning tests begin only after the independently tested readiness gate. */
export function readySetupState() {
  let state = setupWizardReducer(initialSetupState(), { type: "READINESS_STARTED", generation: 0 });
  state = setupWizardReducer(state, { type: "READINESS_LOADED", generation: 0, report: readinessReport() });
  return setupWizardReducer(state, { type: "OPTIONS_STARTED", generation: 0 });
}
