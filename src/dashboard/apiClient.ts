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
  PlayerPresence,
} from "./types";
import type { CreateProvisioningRequest, ProvisioningConnection, ProvisioningPlanResponse, ProvisioningPreflightResponse, SetupOptionsResponse, ProvisioningApplyRequest, ProvisioningApplyResponse, ReconciledSetup } from "./provisioningTypes";
import { getDashboardAccessKey } from "./adminConnection";
export { getHostReadiness } from "../setup/hostReadiness";

function dashboardFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers), key = getDashboardAccessKey();
  if (key && input.startsWith("/api/") && !headers.has("authorization")) headers.set("authorization", "Bearer " + key);
  return fetch(input, { ...init, headers });
}

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
      : code === "OUTCOME_UNCONFIRMED" ? "GameHub could not confirm a completed setup for this reference. Keep the reference for your administrator. Do not create it again."
      : code === "INVALID_RESPONSE" ? "GameHub returned an unexpected setup response. Please reconnect and try again."
      : "Setup could not be checked. Your settings have been kept; check the connection or ask your administrator.");
  }
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 2048): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const providerId = (v: unknown) => v === "minecraft" || v === "minecraft-bedrock";
const endpoints = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 8 && v.every(e => object(e) && text(e.id, 64) && text(e.protocol, 64) && ["tcp", "udp"].includes(e.transport) && text(e.bindAddress, 128) && object(e.port) && e.port.mode === "fixed" && Number.isInteger(e.port.value) && e.port.value >= 1 && e.port.value <= 65535);
const issues = (v: unknown) => Array.isArray(v) && v.every(i => object(i) && text(i.code, 128) && ["blocking", "warning"].includes(i.severity));
const reference = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const setupStorage = (v: unknown) => object(v) && reference(v.rootId) && reference(v.directoryName) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v.directoryName);
const setupProfile = (f: unknown) => object(f) && text(f.profileRef, 64) && text(f.revision, 64) && text(f.label, 80) && object(f.defaults) && (f.defaults.worldName === undefined || text(f.defaults.worldName, 128)) && typeof f.available === "boolean" && (!f.available || setupStorage(f.storage) && object(f.requestDefaults) && text(f.requestDefaults.hostId, 64) && endpoints(f.requestDefaults.endpoints) && (f.requestDefaults.serverId === undefined || reference(f.requestDefaults.serverId)));
const setupProvider = (p: unknown) => object(p) && providerId(p.providerId) && text(p.label, 80) && Array.isArray(p.profiles) && p.profiles.every(setupProfile) && new Set(p.profiles.map(f => f.profileRef)).size === p.profiles.length;
const createRequest = (r: unknown) => object(r) && r.schemaVersion === 1 && providerId(r.providerId) && text(r.serverId, 64) && text(r.displayName, 120) && text(r.hostId, 64) && setupStorage(r.storage) && r.storage.mode === "create" && endpoints(r.endpoints) && object(r.providerOptions) && text(r.providerOptions.profileRef, 64) && text(r.providerOptions.worldName, 128);
async function setupRequest(route: string, connection: ProvisioningConnection, body?: unknown, base = "/api/provisioning"): Promise<any> {
  if (!connection.token.trim()) throw new ProvisioningClientError("UNAUTHENTICATED", 401);
  let response: Response;
  try { response = await dashboardFetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST", signal: connection.signal,
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
  return parseSetupPlan(await setupRequest("/plans", connection, request));
}
function parseSetupPlan(result: any): ProvisioningPlanResponse {
  const plan = result?.plan;
  if (!object(result) || !text(result.digest, 128) || !object(plan) || plan.schemaVersion !== 1 || !text(plan.planId, 160) || !providerId(plan.providerId) || !text(plan.serverId, 64) || !text(plan.displayName, 120) || plan.mode !== "create" || !["planned", "blocked", "expired"].includes(plan.status) || !createRequest(plan.request) || !object(plan.validation) || typeof plan.validation.valid !== "boolean" || !issues(plan.validation.errors)) throw new ProvisioningClientError("INVALID_RESPONSE");
  return result as unknown as ProvisioningPlanResponse;
}
export async function preflightProvisioning(planId: string, connection: ProvisioningConnection): Promise<ProvisioningPreflightResponse> {
  return parseSetupPreflight(await setupRequest("/preflight", connection, { planId }));
}
function parseSetupPreflight(result: any): ProvisioningPreflightResponse {
  const c = result?.creation;
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

export async function reconcileProvisioning(planId: string, connection: ProvisioningConnection): Promise<ReconciledSetup> {
  if (!/^plan_[a-f0-9]{64}$/.test(planId)) throw new ProvisioningClientError("OUTCOME_UNCONFIRMED");
  const stored = await setupRequest(`/plans/${encodeURIComponent(planId)}`, connection);
  const plan = parseSetupPlan(stored), p = plan.plan;
  const preflight = parseSetupPreflight({ status: "PASS", issues: [], creation: stored.creation });
  const c = preflight.creation!;
  if (p.planId !== planId || p.providerId !== p.request.providerId || p.serverId !== p.request.serverId || p.displayName !== p.request.displayName || c.serverId !== p.serverId || c.profileId !== p.request.providerOptions.profileRef || c.directoryName !== p.request.storage.directoryName || c.worldName !== p.request.providerOptions.worldName || JSON.stringify(c.endpoints) !== JSON.stringify(p.request.endpoints)) throw new ProvisioningClientError("INVALID_RESPONSE");
  const query = new URLSearchParams({ providerId: p.providerId, serverId: p.serverId, type: "server.provision.apply", limit: "500" });
  const history = await setupRequest(`/operations?${query}`, connection, undefined, "/api");
  if (!object(history) || !Array.isArray(history.operations)) throw new ProvisioningClientError("INVALID_RESPONSE");
  const matches = history.operations.filter(o => object(o) && o.providerId === p.providerId && o.serverId === p.serverId && o.type === "server.provision.apply" && object(o.result) && o.result.planId === planId);
  // A missing/ambiguous match is never evidence that another CREATE would be safe.
  if (matches.length !== 1 || !text(matches[0].operationId, 200)) throw new ProvisioningClientError("OUTCOME_UNCONFIRMED");
  const operation = await setupRequest(`/operations/${encodeURIComponent(matches[0].operationId)}`, connection, undefined, "/api"), r = operation?.result;
  if (!object(operation) || operation.operationId !== matches[0].operationId || operation.providerId !== p.providerId || operation.serverId !== p.serverId || operation.type !== "server.provision.apply" || operation.status !== "completed" || operation.error || !object(r) || r.planId !== planId || r.providerId !== p.providerId || r.serverId !== p.serverId || r.state !== "PROVISIONED" || r.outcome !== "applied" || !Array.isArray(r.issues) || r.issues.length !== 0) throw new ProvisioningClientError("OUTCOME_UNCONFIRMED");
  const inventory = await setupRequest("/servers", connection, undefined, "/api");
  if (!object(inventory) || !Array.isArray(inventory.servers) || inventory.servers.filter(s => object(s) && s.providerId === p.providerId && s.id === p.serverId && s.ownership === "MANAGED" && s.status === "offline").length !== 1) throw new ProvisioningClientError("OUTCOME_UNCONFIRMED");
  return { plan, preflight, apply: { operationId: operation.operationId, providerId: p.providerId, serverId: p.serverId, state: "PROVISIONED", outcome: "applied", ownership: "MANAGED", residuals: [] } };
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

export async function getWebSocketOptions(): Promise<{ authenticationRequired: boolean }> {
  const result = await parseResponse<{ authenticationRequired: boolean }>(await dashboardFetch("/api/websocket-options"));
  if (typeof result?.authenticationRequired !== "boolean") throw new Error("Live connection settings unavailable.");
  return result;
}

export async function getProviders(): Promise<ProviderListResponse> {
  return parseResponse<ProviderListResponse>(await dashboardFetch("/api/providers"));
}

export async function getProvider(providerId: string): Promise<ProviderCapabilitiesResponse> {
  return parseResponse<ProviderCapabilitiesResponse>(await dashboardFetch(`/api/providers/${providerId}`));
}

export async function getServers(): Promise<ServerInventoryResponse> {
  return parseResponse<ServerInventoryResponse>(await dashboardFetch("/api/servers"));
}

function serverRoute(serverId: string, providerId?: string): string {
  return providerId ? `/api/providers/${encodeURIComponent(providerId)}/servers/${encodeURIComponent(serverId)}` : `/api/servers/${encodeURIComponent(serverId)}`;
}
export async function getServerStatus(serverId: string, providerId?: string): Promise<ServerStatusResponse> {
  const requestedAt = Date.now();
  const value = await lifecycleRead<ServerStatusResponse>(`${serverRoute(serverId, providerId)}/status`);
  if (!value || !["online", "offline", "starting", "stopping", "error"].includes(value.status)) throw new Error("Server status unavailable.");
  return { ...value, requestedAt };
}

export class PlayerPresenceError extends Error {
  constructor(readonly status = 0) { super(status === 401 || status === 403 ? "Connect as an administrator to view player names." : "Player names are unavailable. Refresh to check again."); }
}
export async function getPlayerPresence(providerId: string, serverId: string, signal?: AbortSignal): Promise<PlayerPresence> {
  let response: Response;
  try { response = await dashboardFetch(`${serverRoute(serverId, providerId)}/players`, { signal }); }
  catch { throw new PlayerPresenceError(); }
  if (!response.ok) throw new PlayerPresenceError(response.status);
  let value: PlayerPresence;
  try { value = await response.json(); } catch { throw new PlayerPresenceError(); }
  if (!value || value.providerId !== providerId || value.serverId !== serverId || !["available", "not-running", "unsupported"].includes(value.state) || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) || typeof value.namesComplete !== "boolean" || !Array.isArray(value.players) || value.players.length > 256
    || value.players.some(p => !p || typeof p.displayName !== "string" || !p.displayName.trim() || p.displayName.length > 64 || /[\p{C}<>\\/:=@]/u.test(p.displayName)) || value.state !== "available" && value.players.length) throw new PlayerPresenceError();
  return { providerId, serverId, state: value.state, observedAt: value.observedAt, namesComplete: value.namesComplete, players: value.players.map(({ displayName }) => ({ displayName })) };
}

export async function getWorlds(serverId: string, providerId?: string): Promise<WorldListResponse> {
  return parseResponse<WorldListResponse>(await dashboardFetch(`${serverRoute(serverId, providerId)}/worlds`));
}

export async function validateWorld(serverId: string, worldId: string): Promise<ValidationResult> {
  return parseResponse<ValidationResult>(await dashboardFetch(`/api/servers/${serverId}/worlds/${worldId}/validate`, { method: "POST" }));
}

export async function getOperation(operationId: string): Promise<OperationRecord> {
  return lifecycleRead<OperationRecord>(`/api/operations/${encodeURIComponent(operationId)}`);
}

async function lifecycleRead<T>(url: string): Promise<T> {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try { return await parseResponse<T>(await dashboardFetch(url, { signal: abort.signal })); }
  finally { clearTimeout(timer); }
}

export async function getOperations(limit = 100): Promise<OperationListResponse> {
  return parseResponse<OperationListResponse>(await dashboardFetch(`/api/operations?limit=${limit}`));
}

export async function getEvents(limit = 200): Promise<EventListResponse> {
  return parseResponse<EventListResponse>(await dashboardFetch(`/api/events?limit=${limit}`));
}

export class LifecycleRequestError extends Error {
  constructor(readonly rejected: boolean) { super("Server command could not be confirmed."); }
}
export async function runServerCommand(serverId: string, command: "start" | "stop" | "restart", providerId?: string): Promise<OperationRef> {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
  try {
  let response: Response;
  try { response = await dashboardFetch(`${serverRoute(serverId, providerId)}/${command}`, { method: "POST", signal: abort.signal }); }
  catch { throw new LifecycleRequestError(false); }
  if (!response.ok) throw new LifecycleRequestError([400, 401, 403, 404, 405, 409, 422].includes(response.status));
  try {
    const ref = await response.json();
    if (!ref || typeof ref.operationId !== "string" || !["queued", "running", "completed", "failed", "cancelled"].includes(ref.status)) throw new Error();
    return ref;
  } catch { throw new LifecycleRequestError(false); }
  } finally { clearTimeout(timer); }
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
  return parseResponse<ApiEnvelope<AnalyticsSummary>>(await dashboardFetch(`/api/analytics/summary?${search.toString()}`));
}

export async function getHistoryOverview() {
  return parseResponse<ApiEnvelope<HistoryOverview>>(await dashboardFetch("/api/history/overview"));
}

export async function requestHistoryCleanup(actor = "dashboard-user") {
  return parseResponse<HistoryCleanupSummary>(
    await dashboardFetch("/api/history/cleanup", {
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
  return parseResponse<AiProvidersInfo>(await dashboardFetch("/api/ai/providers"));
}

export async function askAiStudio(request: AiAskRequest): Promise<AiAskResponse> {
  return parseResponse<AiAskResponse>(
    await dashboardFetch("/api/ai/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    }),
  );
}

export async function getAiAuditTrail(limit = 50): Promise<{ audits: AiAuditEntry[] }> {
  return parseResponse<{ audits: AiAuditEntry[] }>(await dashboardFetch(`/api/ai/audit?limit=${limit}`));
}

export async function getFamilies(): Promise<{ families: FamilySummary[] }> {
  return parseResponse<{ families: FamilySummary[] }>(await dashboardFetch("/api/families"));
}

export async function getFamilyChildren(familyId: string): Promise<{ children: ChildProfile[] }> {
  return parseResponse<{ children: ChildProfile[] }>(await dashboardFetch(`/api/families/${familyId}/children`));
}

export async function getChildRules(childId: string): Promise<{ rules: FamilyRule[] }> {
  return parseResponse<{ rules: FamilyRule[] }>(await dashboardFetch(`/api/children/${childId}/rules`));
}

export async function getChildSessions(childId: string): Promise<{ sessions: FamilySession[] }> {
  return parseResponse<{ sessions: FamilySession[] }>(await dashboardFetch(`/api/children/${childId}/sessions?limit=20`));
}

export async function getChildPlaytime(childId: string): Promise<{ usage: FamilyPlaytime }> {
  return parseResponse<{ usage: FamilyPlaytime }>(await dashboardFetch(`/api/children/${childId}/playtime`));
}

export async function getChildOverrides(childId: string): Promise<{ overrides: FamilyOverride[] }> {
  return parseResponse<{ overrides: FamilyOverride[] }>(await dashboardFetch(`/api/children/${childId}/overrides`));
}

export async function getChildIdentities(childId: string): Promise<{ identities: Array<{ providerId: string; externalPlayerId: string }> }> {
  return parseResponse<{ identities: Array<{ providerId: string; externalPlayerId: string }> }>(
    await dashboardFetch(`/api/children/${childId}/identities`),
  );
}

export async function getChildRewards(childId: string): Promise<{ rewards: FamilyReward[] }> {
  return parseResponse<{ rewards: FamilyReward[] }>(await dashboardFetch(`/api/children/${childId}/rewards`));
}

export async function getChildEntitlements(
  childId: string,
  input: { providerId?: string; serverId?: string } = {},
): Promise<{ entitlements: FamilyEntitlements }> {
  const search = new URLSearchParams();
  if (input.providerId) search.set("providerId", input.providerId);
  if (input.serverId) search.set("serverId", input.serverId);
  return parseResponse<{ entitlements: FamilyEntitlements }>(
    await dashboardFetch(`/api/children/${childId}/entitlements?${search.toString()}`),
  );
}

export async function evaluateChildAccess(
  childId: string,
  input: { providerId: string; serverId: string; externalPlayerId: string },
): Promise<{ decision: { decision: string; reason: string; remainingMinutes?: number }; session?: FamilySession }> {
  return parseResponse<{ decision: { decision: string; reason: string; remainingMinutes?: number }; session?: FamilySession }>(
    await dashboardFetch(`/api/children/${childId}/evaluate-access`, {
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
  return parseResponse(await dashboardFetch("/api/content/sources"));
}

export async function getContentItems(): Promise<{ items: ContentLibraryItem[] }> {
  return parseResponse(await dashboardFetch("/api/content"));
}

export async function scanContent(sourcePath: string, serverId = "minecraft-main"): Promise<{ report: { items: ContentLibraryItem[]; events: Array<{ type: string; timestamp: string }> } }> {
  return parseResponse(await dashboardFetch("/api/content/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourcePath, serverId }),
  }));
}

export async function createContentImportPlan(contentId: string, input: { serverId?: string; worldId?: string } = {}): Promise<{ plan: ContentImportPlanResponse }> {
  const response = await dashboardFetch("/api/content/import-plans", {
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
  return parseResponse(await dashboardFetch(`/api/content/import-plans/${operationId}`));
}

export async function executeContentImportPlan(operationId: string): Promise<{ result: { status: string; installedPath?: string; error?: { code: string; message: string }; audit: Array<{ action: string; result: string; timestamp: string }> } }> {
  const response = await dashboardFetch(`/api/content/import-plans/${operationId}/execute`, {
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
  return parseResponse(await dashboardFetch("/api/content/inventory"));
}

export async function getContentHistory(): Promise<{ audit: Array<{ action: string; result: string; timestamp: string; destinationPath?: string }> }> {
  return parseResponse(await dashboardFetch("/api/content/history"));
}
