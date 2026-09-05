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
