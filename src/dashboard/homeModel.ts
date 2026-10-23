import type { DashboardState, OperationRecord, ServerInventoryItem } from "./types";
import { connectionAddresses } from "./connectionExperience";

export interface ServerKey { providerId: string; serverId: string }
export type ServerCommand = "start" | "stop" | "restart";
export const serverIdentity = (key: ServerKey) => JSON.stringify([key.providerId, key.serverId]);
export const inventoryKey = (server: ServerInventoryItem): ServerKey => ({ providerId: server.providerId, serverId: server.id });
export const sameServer = (server: ServerInventoryItem, key: ServerKey) => server.providerId === key.providerId && server.id === key.serverId;
export const lifecycleLabels: Record<string, string> = { online: "Running", offline: "Stopped", starting: "Starting…", stopping: "Stopping…", unknown: "Status unavailable", error: "Status unavailable" };
export const lifecycleOperation = (op: OperationRecord) => ["server.start", "server.stop", "server.restart"].includes(op.type);
export const unresolvedOperation = (operations: OperationRecord[], key: ServerKey) => operations.some(op => op.providerId === key.providerId && op.serverId === key.serverId && lifecycleOperation(op) && ["queued", "running"].includes(op.status));

// A bind address is not necessarily an address that a player's device can reach.
export function connectionInfo(server: ServerInventoryItem): { host: string; port: number; local: boolean } | undefined {
  const endpoint = connectionAddresses(server).find(e => e.edition === (server.providerId === "minecraft-bedrock" ? "bedrock" : "java"));
  return endpoint && { host: endpoint.host, port: endpoint.port, local: endpoint.scope === "local" };
}

export function relativeTime(timestamp: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(timestamp)) / 1000);
  if (!Number.isFinite(seconds)) return "Time unavailable";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) { const n = Math.floor(seconds / 60); return `${n} minute${n === 1 ? "" : "s"} ago`; }
  if (seconds < 86400) { const n = Math.floor(seconds / 3600); return `${n} hour${n === 1 ? "" : "s"} ago`; }
  if (seconds < 172800) return "Yesterday";
  return new Date(timestamp).toLocaleDateString();
}

export function recentActivity(state: DashboardState) {
  return state.operations.filter(op => lifecycleOperation(op) && ["completed", "failed"].includes(op.status)
    || op.type === "server.provision.apply" && op.status === "completed" && (op.result as { state?: string } | undefined)?.state === "PROVISIONED")
    .flatMap(op => {
      const server = state.servers.find(s => s.providerId === op.providerId && s.id === op.serverId);
      if (!server) return [];
      const verb = op.type.slice(7);
      return [{ id: op.operationId, message: op.type === "server.provision.apply" ? `${server.name} created` : op.status === "failed" ? `${server.name} could not ${verb}` : `${server.name} ${verb === "stop" ? "stopped" : verb === "restart" ? "restarted" : "started"}`,
        timestamp: op.completedAt || op.createdAt, failed: op.status === "failed" }];
    }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 5);
}
