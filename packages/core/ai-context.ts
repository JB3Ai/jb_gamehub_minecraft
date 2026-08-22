import {
  AnalyticsService,
  AnalyticsWindow,
  resolveWindow,
} from "./analytics-service";
import {
  EventRecord,
  InMemoryProviderManager,
  OperationRecord,
  ProviderMetadata,
  ServerSummary,
} from "../provider-manager/index";

const MAX_CONTEXT_OPERATIONS = 15;
const MAX_CONTEXT_EVENTS = 15;
const MAX_SUMMARY_CHARS = 6000;

export interface AiContextServerSnapshot {
  id: string;
  providerId: string;
  name: string;
  status: string;
  availability: boolean;
}

export interface AiContextPackage {
  generatedAt: string;
  window: { from: string; to: string };
  providerId?: string;
  serverId?: string;
  providers: ProviderMetadata[];
  servers: AiContextServerSnapshot[];
  recentOperations: OperationRecord[];
  recentEvents: EventRecord[];
  analyticsSummary: Awaited<ReturnType<AnalyticsService["summary"]>>;
  worldValidation: Awaited<ReturnType<AnalyticsService["worldValidation"]>>;
  notes: string[];
  sources: string[];
}

export interface AiContextOptions {
  providerId?: string;
  serverId?: string;
  window?: "24h" | "7d" | "30d";
}

function truncate(value: unknown, maxLength = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

async function loadServerSnapshots(
  manager: InMemoryProviderManager,
  servers: ServerSummary[],
): Promise<AiContextServerSnapshot[]> {
  return Promise.all(
    servers.map(async (server) => {
      const status = await manager.getServerStatus(server.id);
      return {
        id: server.id,
        providerId: server.providerId,
        name: server.name,
        status: status.status,
        availability: status.status === "online" || status.status === "starting",
      };
    }),
  );
}

export async function assembleAiContext(
  manager: InMemoryProviderManager,
  analytics: AnalyticsService,
  options: AiContextOptions = {},
): Promise<AiContextPackage> {
  const window: AnalyticsWindow = resolveWindow({
    window: options.window,
    providerId: options.providerId,
    serverId: options.serverId,
  });

  const providers = manager.listProviders().filter((provider) => !options.providerId || provider.id === options.providerId);

  const allServers = await manager.listServers(options.providerId);
  const scopedServers = allServers.filter((server) => !options.serverId || server.id === options.serverId);
  const servers = await loadServerSnapshots(manager, scopedServers);

  const recentOperations = await manager.listOperations({
    providerId: options.providerId,
    serverId: options.serverId,
    from: window.from,
    to: window.to,
    limit: MAX_CONTEXT_OPERATIONS,
  });

  const recentEvents = await manager.listEvents({
    providerId: options.providerId,
    serverId: options.serverId,
    from: window.from,
    to: window.to,
    limit: MAX_CONTEXT_EVENTS,
  });

  const analyticsSummary = await analytics.summary(window);
  const worldValidation = await analytics.worldValidation(window);

  return {
    generatedAt: new Date().toISOString(),
    window: { from: window.from, to: window.to },
    providerId: options.providerId,
    serverId: options.serverId,
    providers,
    servers,
    recentOperations,
    recentEvents,
    analyticsSummary,
    worldValidation,
    notes: [
      "GameHub context is bounded and read-only; it does not include raw logs, credentials, or file contents.",
      "This assistant cannot start, stop, restart, delete, or modify anything in GameHub.",
    ],
    sources: ["providers", "servers", "operations", "events", "analytics", "worldValidation"],
  };
}

export function summarizeContextForPrompt(context: AiContextPackage): string {
  const lines: string[] = [];

  lines.push(`Window: ${context.window.from} to ${context.window.to}`);
  if (context.providerId) {
    lines.push(`Scoped provider: ${context.providerId}`);
  }
  if (context.serverId) {
    lines.push(`Scoped server: ${context.serverId}`);
  }

  lines.push(`Providers: ${context.providers.map((provider) => `${provider.id} (${provider.status})`).join(", ") || "none"}`);
  lines.push(
    `Servers: ${
      context.servers.map((server) => `${server.id}[${server.providerId}]=${server.status}`).join(", ") || "none"
    }`,
  );

  const summary = context.analyticsSummary.totals;
  lines.push(
    `Analytics summary: online=${summary.currentlyOnline}, offline=${summary.currentlyOffline}, ` +
      `opsCompleted=${summary.operationsCompleted}, opsFailed=${summary.operationsFailed}, ` +
      `avgOpDurationMs=${summary.averageOperationDurationMs ?? "n/a"}, ` +
      `validationPass=${summary.validationSuccesses}, validationFail=${summary.validationFailures}`,
  );

  lines.push(
    `World validation: total=${context.worldValidation.totalValidations}, valid=${context.worldValidation.valid}, ` +
      `invalid=${context.worldValidation.invalid}, failed=${context.worldValidation.failed}`,
  );

  if (context.recentOperations.length > 0) {
    lines.push("Recent operations:");
    for (const operation of context.recentOperations) {
      lines.push(
        `- ${operation.type} on ${operation.providerId}/${operation.serverId || "n/a"}: ${operation.status}` +
          (operation.error ? ` (${truncate(operation.error.message)})` : ""),
      );
    }
  }

  if (context.recentEvents.length > 0) {
    lines.push("Recent events:");
    for (const event of context.recentEvents) {
      lines.push(`- ${event.type} on ${event.providerId || "n/a"}/${event.serverId || "n/a"} at ${event.timestamp}`);
    }
  }

  lines.push(...context.notes);

  const summaryText = lines.join("\n");
  return summaryText.length > MAX_SUMMARY_CHARS ? `${summaryText.slice(0, MAX_SUMMARY_CHARS)}…` : summaryText;
}
