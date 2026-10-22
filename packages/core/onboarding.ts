export interface OnboardingState {
  schemaVersion: 1;
  status: "INCOMPLETE" | "READY";
  completedAt?: string;
  completedBy?: string;
  configurationRevision: number;
}
export interface OnboardingView extends Omit<OnboardingState, "completedBy"> {
  currentConfigurationRevision: number;
  configurationChanged: boolean;
}
export class OnboardingError extends Error {
  readonly status = 409;
  constructor(readonly code: "CONFIGURATION_STALE" | "ONBOARDING_NOT_READY") { super(code); }
}
export function publicOnboarding(state: OnboardingState, currentRevision: number): OnboardingView {
  return { schemaVersion: 1, status: state.status, configurationRevision: state.configurationRevision,
    ...(state.completedAt ? { completedAt: state.completedAt } : {}), currentConfigurationRevision: currentRevision,
    configurationChanged: state.status === "READY" && state.configurationRevision !== currentRevision };
}
