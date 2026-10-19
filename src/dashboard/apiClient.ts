import {
  AiAskRequest,
  AiAskResponse,
  AiAuditEntry,
  AiProvidersInfo,
  ChildProfile,
  FamilyOverride,
  FamilyPlaytime,
  FamilyRule,
  FamilySession,
  FamilySummary,
  FamilyEntitlements,
  FamilyReward,
  AnalyticsSummary,
  ApiEnvelope,
  EventListResponse,
  HistoryCleanupSummary,
  HistoryOverview,
  OperationListResponse,
  OperationRecord,
  OperationRef,
  ProviderCapabilitiesResponse,
  ProviderListResponse,
  ServerInventoryResponse,
  ServerStatusResponse,
  ValidationResult,
  WorldListResponse,
} from "./types";
import type { CreateProvisioningRequest, ProvisioningConnection, ProvisioningPlanResponse, ProvisioningPreflightResponse, SetupOptionsResponse, ProvisioningApplyRequest, ProvisioningApplyResponse } from "./provisioningTypes";

export function setupIssueMessage(code: string): string {
  if (code === "ENDPOINT_OCCUPIED") return "A selected connection port is already in use. Ask your administrator to update the setup.";
  if (code === "PATH_COLLISION" || code === "RESOURCE_CONFLICT") return "A server or reserved setup already uses this location. Ask your administrator to check it.";
  if (code === "LICENSE_ACCEPTANCE_REQUIRED") return "This approved setup needs administrator attention before it can be checked.";
  if (code === "UNSAFE_WORLD_NAME") return "Choose a simple world name without path characters, then check setup again.";
  return "This setup needs attention. Check your settings or ask your administrator to review the approved setup.";
}
export class ProvisioningClientError extends Error {
  constructor(readonly code: string, readonly status = 0) {
    super(code === "UNAUTHENTICATED" ? "Connect with an administrator access key to check setup."
      : code === "FORBIDDEN" ? "A GameHub administrator must continue."
      : ["ENDPOINT_OCCUPIED", "PATH_COLLISION", "RESOURCE_CONFLICT", "LICENSE_ACCEPTANCE_REQUIRED", "UNSAFE_WORLD_NAME"].includes(code) ? setupIssueMessage(code)
      : code === "INVALID_RESPONSE" ? "GameHub returned an unexpected setup response. Please reconnect and try again."
      : "Setup could not be checked. Your settings have been kept; check the connection or ask your administrator.");
  }
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 2048): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const providerId = (v: unknown) => v === "minecraft" || v === "minecraft-bedrock";
const endpoints = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 8 && v.every(e => object(e) && text(e.id, 64) && text(e.protocol, 64) && ["tcp", "udp"].includes(e.transport) && text(e.bindAddress, 128) && object(e.port) && e.port.mode === "fixed" && Number.isInteger(e.port.value) && e.port.value >= 1 && e.port.value <= 65535);
const issues = (v: unknown) => Array.isArray(v) && v.every(i => object(i) && text(i.code, 128) && ["blocking", "warning"].includes(i.severity));
const setupProfile = (f: unknown) => object(f) && text(f.profileRef, 64) && text(f.revision, 64) && text(f.label, 80) && object(f.defaults) && (f.defaults.worldName === undefined || text(f.defaults.worldName, 128)) && typeof f.available === "boolean" && (!f.available || object(f.requestDefaults) && text(f.requestDefaults.hostId, 64) && text(f.requestDefaults.rootId, 64) && endpoints(f.requestDefaults.endpoints) && (f.requestDefaults.serverId === undefined || typeof f.requestDefaults.serverId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(f.requestDefaults.serverId)));
const setupProvider = (p: unknown) => object(p) && providerId(p.providerId) && text(p.label, 80) && Array.isArray(p.profiles) && p.profiles.every(setupProfile) && new Set(p.profiles.map(f => f.profileRef)).size === p.profiles.length;
const createRequest = (r: unknown) => object(r) && r.schemaVersion === 1 && providerId(r.providerId) && text(r.serverId, 64) && text(r.displayName, 120) && text(r.hostId, 64) && object(r.storage) && r.storage.mode === "create" && text(r.storage.rootId, 64) && endpoints(r.endpoints) && object(r.providerOptions) && text(r.providerOptions.profileRef, 64) && text(r.providerOptions.worldName, 128);
async function setupRequest(route: string, connection: ProvisioningConnection, body?: unknown): Promise<any> {
  if (!connection.token.trim()) throw new ProvisioningClientError("UNAUTHENTICATED", 401);
  let response: Response;
  try { response = await fetch(`/api/provisioning${route}`, { method: body === undefined ? "GET" : "POST", signal: connection.signal,
    headers: { authorization: `Bearer ${connection.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch (error) { if (connection.signal?.aborted) throw error; throw new ProvisioningClientError("NETWORK_ERROR"); }
  let result: unknown;
  try { result = await response.json(); } catch { throw new ProvisioningClientError("INVALID_RESPONSE", response.status); }
  if (!response.ok && !(route === "/preflight" && response.status === 422 && object(result) && result.status === "FAIL" && issues(result.issues))) throw new ProvisioningClientError(object(result) && object(result.error) && text(result.error.code, 128) ? result.error.code : response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : "PREFLIGHT_FAILED", response.status);
  return result;
}
export async function getProvisioningSetupOptions(connection: ProvisioningConnection): Promise<SetupOptionsResponse> {
  const result = await setupRequest("/setup-options", connection);
  if (!object(result) || !Array.isArray(result.providers) || result.providers.length > 2 || !result.providers.every(setupProvider) || new Set(result.providers.map(p => p.providerId)).size !== result.providers.length) throw new ProvisioningClientError("INVALID_RESPONSE");
  return result as unknown as SetupOptionsResponse;
}
export async function createProvisioningPlan(request: CreateProvisioningRequest, connection: ProvisioningConnection): Promise<ProvisioningPlanResponse> {
  const result = await setupRequest("/plans", connection, request), plan = result?.plan;
  if (!object(result) || !text(result.digest, 128) || !object(plan) || plan.schemaVersion !== 1 || !text(plan.planId, 160) || !providerId(plan.providerId) || !text(plan.serverId, 64) || !text(plan.displayName, 120) || plan.mode !== "create" || !["planned", "blocked", "expired"].includes(plan.status) || !createRequest(plan.request) || !object(plan.validation) || typeof plan.validation.valid !== "boolean" || !issues(plan.validation.errors)) throw new ProvisioningClientError("INVALID_RESPONSE");
  return result as unknown as ProvisioningPlanResponse;
}
export async function preflightProvisioning(planId: string, connection: ProvisioningConnection): Promise<ProvisioningPreflightResponse> {
  const result = await setupRequest("/preflight", connection, { planId }), c = result?.creation;
  if (!object(result) || !["PASS", "WARN", "FAIL"].includes(result.status) || !issues(result.issues)) throw new ProvisioningClientError("INVALID_RESPONSE");
  if (result.status === "PASS" && (!object(c) || !/^[a-f0-9]{64}$/.test(c.digest) || c.ownership !== "MANAGED" || !text(c.profileId, 64) || !text(c.serverId, 64) || !text(c.directoryName, 128) || !text(c.worldName, 128) || c.startup !== "remain-stopped" || !endpoints(c.endpoints) || !Array.isArray(c.files) || !c.files.every(f => object(f) && text(f.name) && text(f.relativePath) && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isInteger(f.size) && f.size >= 0) || !Array.isArray(c.deferredValidations) || !c.deferredValidations.every(v => typeof v === "string"))) throw new ProvisioningClientError("INVALID_RESPONSE");
  return result as unknown as ProvisioningPreflightResponse;
}

export async function applyProvisioning(input: ProvisioningApplyRequest, connection: ProvisioningConnection): Promise<ProvisioningApplyResponse> {
  const result = await setupRequest("/applies", connection, input);
  if (!object(result) || !text(result.operationId, 200) || !providerId(result.providerId) || !text(result.serverId, 64) || !text(result.state, 80) || !text(result.outcome, 80) || result.ownership !== "MANAGED" || !Array.isArray(result.residuals) || !result.residuals.every(r => object(r) && text(r.code, 128) && (r.directoryName === undefined || text(r.directoryName, 128)) && (r.retainedClaims === undefined || Number.isInteger(r.retainedClaims) && r.retainedClaims >= 0)) || (result.error !== undefined && (!object(result.error) || !text(result.error.code, 128) || !text(result.error.message)))) throw new ProvisioningClientError("INVALID_RESPONSE");
  // Raw diagnostics and directory names are never displayed by the wizard.
  return result as unknown as ProvisioningApplyResponse;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) {
        message = body.error.message;
      }
    } catch {
      // fall through to status-only message
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function getProviders(): Promise<ProviderListResponse> {
  return parseResponse<ProviderListResponse>(await fetch("/api/providers"));
}

export async function getProvider(providerId: string): Promise<ProviderCapabilitiesResponse> {
  return parseResponse<ProviderCapabilitiesResponse>(await fetch(`/api/providers/${providerId}`));
}

export async function getServers(): Promise<ServerInventoryResponse> {
  return parseResponse<ServerInventoryResponse>(await fetch("/api/servers"));
}

export async function getServerStatus(serverId: string): Promise<ServerStatusResponse> {
  return parseResponse<ServerStatusResponse>(await fetch(`/api/servers/${serverId}/status`));
}

export async function getWorlds(serverId: string): Promise<WorldListResponse> {
  return parseResponse<WorldListResponse>(await fetch(`/api/servers/${serverId}/worlds`));
}

export async function validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
  return parseResponse<ValidationResult>(await fetch(`/api/servers/${serverId}/worlds/${worldId}/validate`, { method: "POST" }));
}

export async function getOperation(operationId: string): Promise<OperationRecord> {
  return parseResponse<OperationRecord>(await fetch(`/api/operations/${operationId}`));
}

export async function getOperations(limit = 100): Promise<OperationListResponse> {
  return parseResponse<OperationListResponse>(await fetch(`/api/operations?limit=${limit}`));
}

export async function getEvents(limit = 200): Promise<EventListResponse> {
  return parseResponse<EventListResponse>(await fetch(`/api/events?limit=${limit}`));
}

export async function runServerCommand(serverId: string, command: "start" | "stop" | "restart"): Promise<OperationRef> {
  return parseResponse<OperationRef>(
    await fetch(`/api/servers/${serverId}/${command}`, {
      method: "POST",
    }),
  );
}

export async function getAnalyticsSummary(params: { window?: "24h" | "7d" | "30d"; providerId?: string; serverId?: string } = {}) {
  const search = new URLSearchParams();
  search.set("window", params.window || "24h");
  if (params.providerId) {
    search.set("providerId", params.providerId);
  }
  if (params.serverId) {
    search.set("serverId", params.serverId);
  }
  return parseResponse<ApiEnvelope<AnalyticsSummary>>(await fetch(`/api/analytics/summary?${search.toString()}`));
}

export async function getHistoryOverview() {
  return parseResponse<ApiEnvelope<HistoryOverview>>(await fetch("/api/history/overview"));
}

export async function requestHistoryCleanup(actor = "dashboard-user") {
  return parseResponse<HistoryCleanupSummary>(
    await fetch("/api/history/cleanup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirm: "CLEANUP_HISTORY",
        actor,
      }),
    }),
  );
}

export async function getAiProvidersInfo(): Promise<AiProvidersInfo> {
  return parseResponse<AiProvidersInfo>(await fetch("/api/ai/providers"));
}

export async function askAiStudio(request: AiAskRequest): Promise<AiAskResponse> {
  return parseResponse<AiAskResponse>(
    await fetch("/api/ai/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    }),
  );
}

export async function getAiAuditTrail(limit = 50): Promise<{ audits: AiAuditEntry[] }> {
  return parseResponse<{ audits: AiAuditEntry[] }>(await fetch(`/api/ai/audit?limit=${limit}`));
}

export async function getFamilies(): Promise<{ families: FamilySummary[] }> {
  return parseResponse<{ families: FamilySummary[] }>(await fetch("/api/families"));
}

export async function getFamilyChildren(familyId: string): Promise<{ children: ChildProfile[] }> {
  return parseResponse<{ children: ChildProfile[] }>(await fetch(`/api/families/${familyId}/children`));
}

export async function getChildRules(childId: string): Promise<{ rules: FamilyRule[] }> {
  return parseResponse<{ rules: FamilyRule[] }>(await fetch(`/api/children/${childId}/rules`));
}

export async function getChildSessions(childId: string): Promise<{ sessions: FamilySession[] }> {
  return parseResponse<{ sessions: FamilySession[] }>(await fetch(`/api/children/${childId}/sessions?limit=20`));
}

export async function getChildPlaytime(childId: string): Promise<{ usage: FamilyPlaytime }> {
  return parseResponse<{ usage: FamilyPlaytime }>(await fetch(`/api/children/${childId}/playtime`));
}

export async function getChildOverrides(childId: string): Promise<{ overrides: FamilyOverride[] }> {
  return parseResponse<{ overrides: FamilyOverride[] }>(await fetch(`/api/children/${childId}/overrides`));
}

export async function getChildIdentities(childId: string): Promise<{ identities: Array<{ providerId: string; externalPlayerId: string }> }> {
  return parseResponse<{ identities: Array<{ providerId: string; externalPlayerId: string }> }>(
    await fetch(`/api/children/${childId}/identities`),
  );
}

export async function getChildRewards(childId: string): Promise<{ rewards: FamilyReward[] }> {
  return parseResponse<{ rewards: FamilyReward[] }>(await fetch(`/api/children/${childId}/rewards`));
}

export async function getChildEntitlements(
  childId: string,
  input: { providerId?: string; serverId?: string } = {},
): Promise<{ entitlements: FamilyEntitlements }> {
  const search = new URLSearchParams();
  if (input.providerId) search.set("providerId", input.providerId);
  if (input.serverId) search.set("serverId", input.serverId);
  return parseResponse<{ entitlements: FamilyEntitlements }>(
    await fetch(`/api/children/${childId}/entitlements?${search.toString()}`),
  );
}

export async function evaluateChildAccess(
  childId: string,
  input: { providerId: string; serverId: string; externalPlayerId: string },
): Promise<{ decision: { decision: string; reason: string; remainingMinutes?: number }; session?: FamilySession }> {
  return parseResponse<{ decision: { decision: string; reason: string; remainingMinutes?: number }; session?: FamilySession }>(
    await fetch(`/api/children/${childId}/evaluate-access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export interface ContentLibraryItem {
  contentId: string;
  sourcePath: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
  validationStatus: string;
  warnings: string[];
  compatibility: { status: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN"; issues: Array<{ code: string; message: string; severity: string }> };
  metadata: { markers: string[]; sourceKind: string };
  sourceManifestId?: string;
  scannedAt: string;
}

export interface ContentImportPlanResponse {
  operationId: string;
  contentId: string;
  contentType: string;
  sourcePath: string;
  stagingPath: string;
  destinationPath: string;
  compatibilityStatus: string;
  actions: string[];
  warnings: Array<{ code: string; message: string; severity: string }>;
  blockingIssues: Array<{ code: string; message: string; severity: string }>;
  requiresApproval: boolean;
  status: "planned" | "blocked";
}

export async function getContentSources(): Promise<{ root: string; sources: Array<{ path: string; kind: "file" | "directory" }> }> {
  return parseResponse(await fetch("/api/content/sources"));
}

export async function getContentItems(): Promise<{ items: ContentLibraryItem[] }> {
  return parseResponse(await fetch("/api/content"));
}

export async function scanContent(sourcePath: string, serverId = "minecraft-main"): Promise<{ report: { items: ContentLibraryItem[]; events: Array<{ type: string; timestamp: string }> } }> {
  return parseResponse(await fetch("/api/content/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourcePath, serverId }),
  }));
}

export async function createContentImportPlan(contentId: string, input: { serverId?: string; worldId?: string } = {}): Promise<{ plan: ContentImportPlanResponse }> {
  const response = await fetch("/api/content/import-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentId, serverId: input.serverId || "minecraft-main", worldId: input.worldId }),
  });
  if (response.status === 422) {
    return (await response.json()) as { plan: ContentImportPlanResponse };
  }
  return parseResponse(response);
}

export async function getContentImportPlan(operationId: string): Promise<{ plan: ContentImportPlanResponse }> {
  return parseResponse(await fetch(`/api/content/import-plans/${operationId}`));
}

export async function executeContentImportPlan(operationId: string): Promise<{ result: { status: string; installedPath?: string; error?: { code: string; message: string }; audit: Array<{ action: string; result: string; timestamp: string }> } }> {
  const response = await fetch(`/api/content/import-plans/${operationId}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approve: true }),
  });
  if (response.status === 409 || response.status === 422) {
    return (await response.json()) as { result: { status: string; installedPath?: string; error?: { code: string; message: string }; audit: Array<{ action: string; result: string; timestamp: string }> } };
  }
  return parseResponse(response);
}

export async function getContentInventory(): Promise<{ inventory: Array<{ contentType: string; path: string; items: Array<{ path: string; kind: string }> }> }> {
  return parseResponse(await fetch("/api/content/inventory"));
}

export async function getContentHistory(): Promise<{ audit: Array<{ action: string; result: string; timestamp: string; destinationPath?: string }> }> {
  return parseResponse(await fetch("/api/content/history"));
}
