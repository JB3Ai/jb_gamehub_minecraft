import type { ProvisioningConnection } from "../dashboard/provisioningTypes";
export type ReadinessStatus = "PASS" | "WARNING" | "BLOCKED";
export class HostReadinessClientError extends Error {
  constructor(readonly code: "INVALID_RESPONSE" | "UNAUTHENTICATED" | "FORBIDDEN" | "NETWORK_ERROR" | "READINESS_UNAVAILABLE") {
    super(code === "INVALID_RESPONSE" ? "GameHub returned an invalid readiness report. Recheck before continuing." : code === "UNAUTHENTICATED" || code === "FORBIDDEN" ? "An authorized administrator access key is required." : "Host readiness could not be checked. Review the connection and recheck.");
  }
}
export interface HostReadinessCheck { id: string; status: ReadinessStatus; title: string; message: string; remediation?: string; details?: Record<string, unknown> }
export interface HostReadinessReport { schemaVersion: 1; status: ReadinessStatus; checkedAt: string; platform: string; checks: HostReadinessCheck[]; readOnly: true; authorizationGranted: false; configuration: { configured: boolean; managedRuntimeCount: number; attachedRuntimeCount: number; preserveExisting: true } }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const status = (value: unknown): value is ReadinessStatus => ["PASS", "WARNING", "BLOCKED"].includes(String(value));
export function canContinueReadiness(report?: HostReadinessReport): boolean { return !!report && ["PASS", "WARNING"].includes(report.status) && !report.checks.some(check => check.status === "BLOCKED"); }
export function parseHostReadiness(value: unknown): HostReadinessReport {
  if (!object(value) || value.schemaVersion !== 1 || value.readOnly !== true || value.authorizationGranted !== false || !status(value.status) || !text(value.platform, 32) || !text(value.checkedAt, 64) || !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 512 || !value.checks.every(c => object(c) && text(c.id, 128) && status(c.status) && text(c.title, 120) && text(c.message, 2048) && (c.remediation === undefined || text(c.remediation, 2048)) && (c.details === undefined || object(c.details) && Object.values(c.details).every(detail => ["string", "boolean"].includes(typeof detail) || typeof detail === "number" && Number.isFinite(detail)))) || new Set(value.checks.map(c => c.id)).size !== value.checks.length || !object(value.configuration) || typeof value.configuration.configured !== "boolean" || value.configuration.preserveExisting !== true || ![value.configuration.managedRuntimeCount, value.configuration.attachedRuntimeCount].every(n => Number.isInteger(n) && n >= 0)) throw new HostReadinessClientError("INVALID_RESPONSE");
  const worst = value.checks.some(c => c.status === "BLOCKED") ? "BLOCKED" : value.checks.some(c => c.status === "WARNING") ? "WARNING" : "PASS";
  if (value.status !== worst) throw new HostReadinessClientError("INVALID_RESPONSE");
  return value as HostReadinessReport;
}
export async function assessHostReadiness(key: string, provider: string, signal?: AbortSignal): Promise<HostReadinessReport> {
  if (!key.trim()) throw new HostReadinessClientError("UNAUTHENTICATED");
  if (!["", "minecraft", "minecraft-bedrock"].includes(provider)) throw new Error("Choose a supported server type.");
  let response: Response;
  try { response = await fetch("/api/setup/readiness" + (provider ? "?provider=" + encodeURIComponent(provider) : ""), { headers: { authorization: "Bearer " + key }, signal, cache: "no-store" }); }
  catch { throw new HostReadinessClientError("NETWORK_ERROR"); }
  if (!response.ok) throw new HostReadinessClientError(response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : "READINESS_UNAVAILABLE");
  try { return parseHostReadiness(await response.json()); }
  catch { throw new HostReadinessClientError("INVALID_RESPONSE"); }
}
export function getHostReadiness(connection: ProvisioningConnection): Promise<HostReadinessReport> { return assessHostReadiness(connection.token, "", connection.signal); }
