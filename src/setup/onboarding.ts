import type { ProvisioningConnection } from "../dashboard/provisioningTypes";
export interface OnboardingState {
  schemaVersion: 1; status: "INCOMPLETE" | "READY"; configurationRevision: number;
  completedAt?: string; currentConfigurationRevision: number; configurationChanged: boolean;
}
export class OnboardingClientError extends Error {
  constructor(readonly code: string) { super(code === "CONFIGURATION_STALE" ? "Host configuration changed. Reload and review it before completing setup." : code === "ONBOARDING_NOT_READY" ? "Host readiness needs attention. Recheck the host before completing setup." : code === "UNAUTHENTICATED" || code === "FORBIDDEN" ? "An authorized administrator access key is required." : "Setup completion could not be confirmed. Check the saved completion state before retrying."); }
}
export function parseOnboarding(value: any): OnboardingState {
  if (!value || value.schemaVersion !== 1 || !["INCOMPLETE", "READY"].includes(value.status) || !Number.isSafeInteger(value.configurationRevision) || value.configurationRevision < 0 || !Number.isSafeInteger(value.currentConfigurationRevision) || value.currentConfigurationRevision < 0 || typeof value.configurationChanged !== "boolean" || value.status === "READY" && (value.configurationRevision < 1 || typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))) || value.configurationChanged !== (value.status === "READY" && value.configurationRevision !== value.currentConfigurationRevision)) throw new OnboardingClientError("INVALID_RESPONSE");
  return value;
}
async function request(connection: ProvisioningConnection, configurationRevision?: number): Promise<OnboardingState> {
  let response: Response;
  try { response = await fetch("/api/setup/onboarding" + (configurationRevision === undefined ? "" : "/complete"), { method: configurationRevision === undefined ? "GET" : "POST", cache: "no-store", headers: { authorization: "Bearer " + connection.token, ...(configurationRevision === undefined ? {} : { "content-type": "application/json" }) }, ...(configurationRevision === undefined ? {} : { body: JSON.stringify({ configurationRevision }) }), signal: connection.signal }); }
  catch { throw new OnboardingClientError("COMPLETION_UNCONFIRMED"); }
  let value: any; try { value = await response.json(); } catch { throw new OnboardingClientError("INVALID_RESPONSE"); }
  if (!response.ok) throw new OnboardingClientError(response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : response.status === 409 && ["CONFIGURATION_STALE", "ONBOARDING_NOT_READY"].includes(value?.error?.code) ? value.error.code : "COMPLETION_UNCONFIRMED");
  return parseOnboarding(value);
}
export const getOnboarding = (connection: ProvisioningConnection) => request(connection);
export async function completeOnboarding(configurationRevision: number, connection: ProvisioningConnection): Promise<OnboardingState> {
  const result = await request(connection, configurationRevision);
  if (result.status !== "READY" || result.currentConfigurationRevision !== configurationRevision) throw new OnboardingClientError("COMPLETION_UNCONFIRMED");
  return result;
}
