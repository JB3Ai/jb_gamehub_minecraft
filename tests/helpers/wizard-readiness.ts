import { initialSetupState, setupWizardReducer } from "../../src/setup/useSetupWizard";
import type { HostReadinessReport } from "../../src/setup/hostReadiness";
import type { HostConfigurationView } from "../../src/setup/hostConfiguration";

export function hostConfigurationView(revision = 0): HostConfigurationView {
  return { schemaVersion: 1, hostId: "local", revision, catalogDigest: "b".repeat(64), onboardingComplete: false,
    choices: { storage: [{ id: "root", label: "Managed root" }], databases: [{ id: "default", label: "Current database" }], java: [{ id: "java", label: "Java runtime" }], bedrock: [] }, defaults: { javaPort: 25565, bedrockPort: 19132 },
    ...(revision ? { record: { schemaVersion: 1 as const, hostId: "local", revision, updatedAt: "2026-10-22T10:00:00Z", configuredEnoughToProceed: true as const, storageRootId: "root", databaseLocationId: "default", javaRuntimeId: "java", javaPort: 25565, bedrockPort: 19132 } } : {}) };
}

export function readinessReport(status: "PASS" | "WARNING" | "BLOCKED" = "PASS"): HostReadinessReport {
  return { schemaVersion: 1, checkedAt: "2026-10-22T10:00:00Z", platform: "win32", status, readOnly: true, authorizationGranted: false,
    checks: [{ id: "host", status, title: "Windows host", message: "Deterministic fixture observation." }],
    configuration: { configured: true, managedRuntimeCount: 0, attachedRuntimeCount: 0, preserveExisting: true } };
}
/** Existing provisioning tests begin only after the independently tested readiness gate. */
export function readySetupState() {
  let state = setupWizardReducer(initialSetupState(), { type: "READINESS_STARTED", generation: 0 });
  state = setupWizardReducer(state, { type: "READINESS_LOADED", generation: 0, report: readinessReport() });
  state = setupWizardReducer(state, { type: "HOST_LOAD_STARTED", generation: 0 });
  state = setupWizardReducer(state, { type: "HOST_LOADED", generation: 0, view: hostConfigurationView() });
  state = setupWizardReducer(state, { type: "HOST_REVIEW", generation: 0 });
  state = setupWizardReducer(state, { type: "HOST_SAVE_STARTED", generation: 0 });
  state = setupWizardReducer(state, { type: "HOST_SAVED", generation: 0, view: hostConfigurationView(1) });
  state = setupWizardReducer(state, { type: "ONBOARDING_READY", generation: 0, onboarding: { schemaVersion: 1, status: "READY", configurationRevision: 1, currentConfigurationRevision: 1, configurationChanged: false, completedAt: "2026-10-22T12:00:00Z" } });
  return setupWizardReducer(state, { type: "OPTIONS_STARTED", generation: 0 });
}
