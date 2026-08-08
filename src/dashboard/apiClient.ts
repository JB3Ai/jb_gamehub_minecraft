import {
  EventListResponse,
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
