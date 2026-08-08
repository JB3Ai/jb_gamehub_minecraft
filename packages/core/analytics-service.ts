import {
  EventRecord,
  InMemoryProviderManager,
  OperationQuery,
  OperationRecord,
  ServerStatus,
} from "../provider-manager/index";

const MAX_ANALYTICS_RECORDS = 5000;

export interface AnalyticsWindow {
  from: string;
  to: string;
  limit: number;
  providerId?: string;
  serverId?: string;
  type?: string;
  state?: string;
}

interface DurationStats {
  averageMs: number | null;
  minMs: number | null;
  maxMs: number | null;
}

interface ServerUptimeMetrics {
  providerId: string;
  serverId: string;
  onlineDurationMs: number;
  offlineDurationMs: number;
  uptimePercentage: number | null;
  statusTransitions: number;
  incompleteHistory: boolean;
  liveStatus?: ServerStatus["status"];
  persistedStateStatus?: ServerStatus["status"];
  persistedStateStale?: boolean;
}

function toMs(input: string): number {
  return Date.parse(input);
}

function durationStats(values: number[]): DurationStats {
  if (values.length === 0) {
    return {
      averageMs: null,
      minMs: null,
      maxMs: null,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: Math.round(total / values.length),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}

function operationDurationMs(operation: OperationRecord): number | null {
  if (!operation.startedAt || !operation.completedAt) {
    return null;
  }

  const start = toMs(operation.startedAt);
  const end = toMs(operation.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return null;
  }

  return end - start;
}

function eventStatus(event: EventRecord): string | undefined {
  if (event.type !== "server.status.changed") {
    return undefined;
  }

  if (event.payload && typeof event.payload === "object") {
    const payload = event.payload as { status?: string };
    if (typeof payload.status === "string") {
      return payload.status;
    }
  }

  return undefined;
}

function computeUptimeFromTransitions(
  eventsAscending: EventRecord[],
  fromMs: number,
  toTimeMs: number,
  initialStatus?: string,
): { onlineDurationMs: number; offlineDurationMs: number; statusTransitions: number; incompleteHistory: boolean } {
  let cursor = fromMs;
  let current = initialStatus;
  let onlineDurationMs = 0;
  let offlineDurationMs = 0;
  let incompleteHistory = current !== "online" && current !== "offline";
  let statusTransitions = 0;

  for (const event of eventsAscending) {
    const eventTime = toMs(event.timestamp);
    if (Number.isNaN(eventTime) || eventTime < fromMs || eventTime > toTimeMs) {
      continue;
    }

    if (current === "online") {
      onlineDurationMs += Math.max(0, eventTime - cursor);
    } else if (current === "offline") {
      offlineDurationMs += Math.max(0, eventTime - cursor);
    }

    const next = eventStatus(event);
    if (next === "online" || next === "offline") {
      current = next;
      cursor = eventTime;
      statusTransitions += 1;
    } else {
      incompleteHistory = true;
    }
  }

  if (current === "online") {
    onlineDurationMs += Math.max(0, toTimeMs - cursor);
  } else if (current === "offline") {
    offlineDurationMs += Math.max(0, toTimeMs - cursor);
  }

  if (eventsAscending.length === 0 && incompleteHistory) {
    statusTransitions = 0;
  }

  return {
    onlineDurationMs,
    offlineDurationMs,
    statusTransitions,
    incompleteHistory,
  };
}

export class AnalyticsService {
  constructor(private readonly manager: InMemoryProviderManager) {}

  async summary(window: AnalyticsWindow) {
    const providers = this.manager.listProviders();
    const allServers = await this.manager.listServers();
    const scopedServers = allServers.filter(
      (server) => (!window.providerId || server.providerId === window.providerId) && (!window.serverId || server.id === window.serverId),
    );

    const operations = await this.manager.listOperations({
      providerId: window.providerId,
      serverId: window.serverId,
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const events = await this.manager.listEvents({
      providerId: window.providerId,
      serverId: window.serverId,
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const durations = operations.map(operationDurationMs).filter((value): value is number => value !== null);
    const validations = events.filter((event) => event.type === "world.validation.completed");
    const validationSuccesses = validations.filter((event) => {
      const payload = event.payload as { valid?: boolean } | undefined;
      return payload?.valid === true;
    }).length;

    let currentlyOnline = 0;
    let currentlyOffline = 0;
    for (const server of scopedServers) {
      const status = await this.manager.getServerStatus(server.id);
      if (status.status === "online") {
        currentlyOnline += 1;
      } else if (status.status === "offline") {
        currentlyOffline += 1;
      }
    }

    const duration = durationStats(durations);
    return {
      totals: {
        providers: window.providerId ? providers.filter((provider) => provider.id === window.providerId).length : providers.length,
        servers: scopedServers.length,
        currentlyOnline,
        currentlyOffline,
        operationsCompleted: operations.filter((item) => item.status === "completed").length,
        operationsFailed: operations.filter((item) => item.status === "failed").length,
        averageOperationDurationMs: duration.averageMs,
        validationSuccesses,
        validationFailures: validations.length - validationSuccesses,
      },
      recordLimitApplied: window.limit,
      incompleteHistory: operations.length >= window.limit || events.length >= window.limit,
    };
  }

  async provider(providerId: string, window: AnalyticsWindow) {
    const servers = (await this.manager.listServers(providerId)).filter((server) => !window.serverId || server.id === window.serverId);
    const operations = await this.manager.listOperations({
      providerId,
      serverId: window.serverId,
      from: window.from,
      to: window.to,
      limit: window.limit,
    });
    const events = await this.manager.listEvents({
      providerId,
      serverId: window.serverId,
      type: "server.status.changed",
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    let onlineCount = 0;
    let offlineCount = 0;
    for (const server of servers) {
      const status = await this.manager.getServerStatus(server.id);
      if (status.status === "online") {
        onlineCount += 1;
      } else if (status.status === "offline") {
        offlineCount += 1;
      }
    }

    const durations = operations.map(operationDurationMs).filter((value): value is number => value !== null);
    const duration = durationStats(durations);

    return {
      providerId,
      serverCount: servers.length,
      onlineCount,
      offlineCount,
      operationCount: operations.length,
      successfulOperations: operations.filter((operation) => operation.status === "completed").length,
      failedOperations: operations.filter((operation) => operation.status === "failed").length,
      averageOperationDurationMs: duration.averageMs,
      statusTransitions: events.length,
      recordLimitApplied: window.limit,
      incompleteHistory: operations.length >= window.limit || events.length >= window.limit,
    };
  }

  async server(providerId: string, serverId: string, window: AnalyticsWindow) {
    const operations = await this.manager.listOperations({
      providerId,
      serverId,
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const transitions = await this.manager.listEvents({
      providerId,
      serverId,
      type: "server.status.changed",
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const previousTransition = await this.manager.listEvents({
      providerId,
      serverId,
      type: "server.status.changed",
      to: window.from,
      limit: 1,
    });

    const orderedTransitions = [...transitions].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
    const priorStatus = previousTransition[0] ? eventStatus(previousTransition[0]) : undefined;
    const fromMs = toMs(window.from);
    const toRangeMs = toMs(window.to);

    const uptime = computeUptimeFromTransitions(orderedTransitions, fromMs, toRangeMs, priorStatus);
    const measuredDurationMs = uptime.onlineDurationMs + uptime.offlineDurationMs;

    const durations = operations.map(operationDurationMs).filter((value): value is number => value !== null);
    const duration = durationStats(durations);

    const validationOperations = operations.filter((operation) => operation.type === "world.validate");
    const liveStatus = await this.manager.getServerStatus(serverId);
    const persistedState = (await this.manager.listServerStates()).find(
      (item) => item.providerId === providerId && item.serverId === serverId,
    );

    return {
      providerId,
      serverId,
      uptimePercentage: measuredDurationMs > 0 ? Math.round((uptime.onlineDurationMs / measuredDurationMs) * 10000) / 100 : null,
      onlineDurationMs: uptime.onlineDurationMs,
      offlineDurationMs: uptime.offlineDurationMs,
      statusTransitions: uptime.statusTransitions,
      operationCount: operations.length,
      operationSuccessRate:
        operations.length > 0
          ? Math.round((operations.filter((operation) => operation.status === "completed").length / operations.length) * 10000) / 100
          : null,
      averageLifecycleDurationMs: duration.averageMs,
      validationCount: validationOperations.length,
      validationFailureCount: validationOperations.filter((operation) => operation.status === "failed").length,
      incompleteHistory: uptime.incompleteHistory || operations.length >= window.limit || transitions.length >= window.limit,
      liveState: {
        status: liveStatus.status,
      },
      persistedState: persistedState
        ? {
            status: persistedState.status,
            availability: persistedState.availability,
            lastSeenAt: persistedState.lastSeenAt,
            stale: Boolean(persistedState.metadata?.stale),
          }
        : undefined,
    };
  }

  async operations(window: AnalyticsWindow) {
    const query: OperationQuery = {
      providerId: window.providerId,
      serverId: window.serverId,
      from: window.from,
      to: window.to,
      limit: window.limit,
    };

    if (window.type) {
      query.type = window.type as OperationQuery["type"];
    }
    if (window.state) {
      query.state = window.state as OperationQuery["state"];
    }

    const operations = await this.manager.listOperations(query);
    const durations = operations.map(operationDurationMs).filter((value): value is number => value !== null);
    const duration = durationStats(durations);

    return {
      providerId: window.providerId,
      serverId: window.serverId,
      type: window.type,
      state: window.state,
      count: operations.length,
      startCount: operations.filter((operation) => operation.type === "server.start").length,
      stopCount: operations.filter((operation) => operation.type === "server.stop").length,
      restartCount: operations.filter((operation) => operation.type === "server.restart").length,
      successCount: operations.filter((operation) => operation.status === "completed").length,
      failureCount: operations.filter((operation) => operation.status === "failed").length,
      averageDurationMs: duration.averageMs,
      minimumDurationMs: duration.minMs,
      maximumDurationMs: duration.maxMs,
      recordLimitApplied: window.limit,
      incompleteHistory: operations.length >= window.limit,
    };
  }

  async events(window: AnalyticsWindow) {
    const events = await this.manager.listEvents({
      providerId: window.providerId,
      serverId: window.serverId,
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const grouped: Record<string, number> = {};
    for (const event of events) {
      grouped[event.type] = (grouped[event.type] || 0) + 1;
    }

    return {
      providerId: window.providerId,
      serverId: window.serverId,
      total: events.length,
      byType: grouped,
      recordLimitApplied: window.limit,
      incompleteHistory: events.length >= window.limit,
    };
  }

  async uptime(window: AnalyticsWindow) {
    const servers = (await this.manager.listServers(window.providerId)).filter((server) => !window.serverId || server.id === window.serverId);
    const data: ServerUptimeMetrics[] = [];

    for (const server of servers) {
      const metrics = await this.server(server.providerId, server.id, window);
      data.push({
        providerId: server.providerId,
        serverId: server.id,
        onlineDurationMs: metrics.onlineDurationMs,
        offlineDurationMs: metrics.offlineDurationMs,
        uptimePercentage: metrics.uptimePercentage,
        statusTransitions: metrics.statusTransitions,
        incompleteHistory: metrics.incompleteHistory,
        liveStatus: metrics.liveState?.status,
        persistedStateStatus: metrics.persistedState?.status,
        persistedStateStale: metrics.persistedState?.stale,
      });
    }

    return {
      providerId: window.providerId,
      serverId: window.serverId,
      servers: data,
      incompleteHistory: data.some((item) => item.incompleteHistory),
    };
  }

  async worldValidation(window: AnalyticsWindow) {
    const validations = await this.manager.listEvents({
      providerId: window.providerId,
      serverId: window.serverId,
      type: "world.validation.completed",
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const failedValidationOperations = await this.manager.listOperations({
      providerId: window.providerId,
      serverId: window.serverId,
      type: "world.validate",
      state: "failed",
      from: window.from,
      to: window.to,
      limit: window.limit,
    });

    const valid = validations.filter((event) => {
      const payload = event.payload as { valid?: boolean } | undefined;
      return payload?.valid === true;
    }).length;

    const invalid = validations.length - valid;
    const failed = failedValidationOperations.length;

    return {
      providerId: window.providerId,
      serverId: window.serverId,
      totalValidations: validations.length + failed,
      valid,
      invalid,
      failed,
      validationSuccessRate:
        validations.length + failed > 0 ? Math.round((valid / (validations.length + failed)) * 10000) / 100 : null,
      recentFailures: failedValidationOperations.slice(0, 5).map((operation) => ({
        operationId: operation.operationId,
        serverId: operation.serverId,
        providerId: operation.providerId,
        completedAt: operation.completedAt,
        message: operation.error?.message,
      })),
      recordLimitApplied: window.limit,
      incompleteHistory: validations.length >= window.limit || failedValidationOperations.length >= window.limit,
    };
  }

  async persistenceOverview(policy: { operationRetentionDays: number; eventRetentionDays: number; auditRetentionDays: number }) {
    const storage = await this.manager.getHistoryStorageStats();
    const oldestCandidates = [storage.oldestOperationAt, storage.oldestEventAt, storage.oldestAuditAt].filter(
      (value): value is string => Boolean(value),
    );

    return {
      retention: policy,
      databaseSizeBytes: storage.databaseSizeBytes,
      oldestRetainedRecordAt: oldestCandidates.length > 0 ? oldestCandidates.sort()[0] : undefined,
      oldestByDomain: {
        operations: storage.oldestOperationAt,
        events: storage.oldestEventAt,
        audits: storage.oldestAuditAt,
      },
    };
  }
}

export function resolveWindow(input: {
  window?: string;
  from?: string;
  to?: string;
  providerId?: string;
  serverId?: string;
  type?: string;
  state?: string;
  limit?: number;
}): AnalyticsWindow {
  const now = new Date();
  const to = input.to ? new Date(input.to) : now;

  if (Number.isNaN(to.getTime())) {
    throw new Error(`Invalid to timestamp: ${input.to}`);
  }

  let from: Date;
  if (input.from) {
    from = new Date(input.from);
    if (Number.isNaN(from.getTime())) {
      throw new Error(`Invalid from timestamp: ${input.from}`);
    }
  } else if (input.window === "7d") {
    from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (input.window === "30d") {
    from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  }

  if (from.getTime() >= to.getTime()) {
    throw new Error("from must be earlier than to");
  }

  const limit = input.limit && Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, MAX_ANALYTICS_RECORDS) : 2000;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    limit,
    providerId: input.providerId,
    serverId: input.serverId,
    type: input.type,
    state: input.state,
  };
}
