import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getAnalyticsSummary,
  getEvents,
  getHistoryOverview,
  getOperation,
  getOperations,
  getProvider,
  getProviders,
  getServerStatus,
  getServers,
  getWorlds,
  getWebSocketOptions,
  requestHistoryCleanup,
  runServerCommand,
  validateWorld,
} from "./apiClient";
import { DashboardEventStream } from "./eventStream";
import { getDashboardAccessKey, subscribeAdminConnection } from "./adminConnection";
import {
  applyProviderEvent,
  applyServerObservation,
  mergeServerInventory,
  createInitialDashboardState,
  markWorldValidating,
  setWorldValidation,
  setWorldsForServer,
  upsertOperation,
} from "./state";
import { DashboardState, ProviderEvent, ServerLifecycleState, WorldRuntime } from "./types";

import { LifecycleCommands } from "./lifecycleCommands";
import { sessionCommandJournal } from "./commandJournal";
import { sameServer, inventoryKey, lifecycleOperation, unresolvedOperation, type ServerKey } from "./homeModel";

function normalizeLifecycleState(status: string): ServerLifecycleState {
  if (status === "online" || status === "offline" || status === "starting" || status === "stopping") {
    return status;
  }
  return "unknown";
}

export function useOperationalDashboard() {
  const [state, setState] = useState<DashboardState>(createInitialDashboardState());
  const eventStreamRef = useRef<DashboardEventStream | null>(null);
  const accessKey = useSyncExternalStore(subscribeAdminConnection, getDashboardAccessKey, getDashboardAccessKey);
  const refreshGeneration = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; refreshGeneration.current++; }; }, []);
  const observeStatus = useCallback((key: ServerKey, status: Awaited<ReturnType<typeof getServerStatus>>) => {
    if (!mounted.current) return;
    setState(current => applyServerObservation(current, key, status, status.requestedAt ?? Date.now()));
  }, []);
  const commandRunner = useRef<LifecycleCommands | null>(null);
  if (!commandRunner.current) commandRunner.current = new LifecycleCommands({
    allowed: (key, command) => {
      const current = stateRef.current, server = current.servers.find(s => sameServer(s, key));
      return current.commandsAuthorized === true && !current.loading && !!server && !server.statusUnconfirmed && !unresolvedOperation(current.operations, key)
        && server.status === (command === "start" ? "offline" : "online");
    },
    request: (key, command) => runServerCommand(key.serverId, command, key.providerId),
    operation: getOperation,
    status: key => getServerStatus(key.serverId, key.providerId),
    observed: observeStatus,
    operationObserved: operation => { if (mounted.current) setState(current => ({ ...current, operations: upsertOperation(current.operations, operation) })); },
    journal: sessionCommandJournal(),
    changed: (pendingCommands, commandErrors, commandRecoveries, commandRecoveryBlocked) => { if (mounted.current) setState(current => ({ ...current, pendingCommands, commandErrors, commandRecoveries, commandRecoveryBlocked })); },
  });
  useEffect(() => { commandRunner.current?.restore(); return () => commandRunner.current?.dispose(); }, []);
  const refreshStatuses = useCallback(async () => {
    if (!stateRef.current.commandsAuthorized) return;
    await Promise.all(stateRef.current.servers.map(async server => {
      const key = inventoryKey(server), requestedAt = Date.now();
      try {
        const status = await getServerStatus(key.serverId, key.providerId);
        // A newer live event wins over an older in-flight status read.
        const latest = stateRef.current.servers.find(s => sameServer(s, key));
        if (latest && (!Number.isFinite(Date.parse(latest.lastStatusUpdate)) || Date.parse(latest.lastStatusUpdate) <= requestedAt)) observeStatus(key, status);
      } catch {
        if (mounted.current) setState(current => applyServerObservation(current, key, undefined, requestedAt));
      }
    }));
    // External commands must also settle when their terminal WebSocket event was missed.
    await Promise.all(stateRef.current.operations.filter(op => lifecycleOperation(op) && ["queued", "running"].includes(op.status)).map(async op => {
      try {
        const latest = await getOperation(op.operationId);
        if (mounted.current && latest.operationId === op.operationId && latest.providerId === op.providerId && latest.serverId === op.serverId) {
          setState(current => ({ ...current, operations: upsertOperation(current.operations, latest) }));
        }
      } catch { /* Keep unresolved controls locked; the next read may confirm the outcome. */ }
    }));
    await commandRunner.current?.refresh();
  }, [observeStatus]);
  useEffect(() => {
    let disposed = false;
    const poll = async () => { await refreshStatuses(); if (!disposed) timer = setTimeout(poll, 5000); };
    let timer = setTimeout(poll, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [refreshStatuses, accessKey]);

  const selectedServer = useMemo(
    () => state.servers.find((server) => server.id === state.selectedServerId && (!state.selectedProviderId || server.providerId === state.selectedProviderId)),
    [state.servers, state.selectedServerId, state.selectedProviderId],
  );

  const loadServerWorlds = useCallback(async (serverId: string, providerId?: string) => {
    const worldsResponse = await getWorlds(serverId, providerId);
    const worlds: WorldRuntime[] = worldsResponse.worlds.map((world) => ({
      id: world.id,
      name: world.name,
      validationState: "not_validated",
    }));

    setState((current) => setWorldsForServer(current, serverId, worlds));
  }, []);

  const refreshData = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const connection = await getWebSocketOptions();
      if (generation !== refreshGeneration.current) return;
      setState(current => ({ ...current, commandsAuthorized: !connection.authenticationRequired || !!accessKey }));
      const providerList = await getProviders();
      const providerMap = Object.fromEntries(providerList.providers.map((provider) => [provider.id, provider]));

      const inventoryRequestedAt = Date.now();
      const serversResponse = await getServers();
      if (generation !== refreshGeneration.current) return;
      if (connection.authenticationRequired && !accessKey) {
        setState(current => ({ ...current, loading: false, error: undefined, providers: providerMap,
          servers: serversResponse.servers.map(server => ({ ...server, status: normalizeLifecycleState(server.status) })),
          selectedServerId: serversResponse.servers.some(server => server.id === current.selectedServerId) ? current.selectedServerId : serversResponse.servers[0]?.id,
          operations: [], events: [], worldsByServer: {}, analyticsSummary: undefined, persistenceOverview: undefined }));
        return;
      }
      const [operationsResponse, eventsResponse, analyticsResponse, historyOverviewResponse] = await Promise.all([
        getOperations(100), getEvents(200), getAnalyticsSummary({ window: "24h" }), getHistoryOverview(),
      ]);
      if (generation !== refreshGeneration.current) return;
      const normalizedServers = serversResponse.servers.map((server) => ({
        ...server,
        status: normalizeLifecycleState(server.status),
      }));
      const persistedEvents = eventsResponse.events.map((event) => ({
        ...event,
        source: "persisted" as const,
      }));

      const selectedServerId =
        state.selectedServerId && normalizedServers.some((server) => server.id === state.selectedServerId)
          ? state.selectedServerId
          : normalizedServers[0]?.id;

      setState((current) => ({
        ...current,
        loading: false,
        error: undefined,
        providers: providerMap,
        servers: mergeServerInventory(current.servers, normalizedServers, inventoryRequestedAt),
        selectedServerId,
        operations: operationsResponse.operations,
        events: persistedEvents,
        analyticsSummary: analyticsResponse.data,
        persistenceOverview: historyOverviewResponse.data,
        cleanupState: current.cleanupState === "running" ? "running" : "idle",
        cleanupMessage: current.cleanupState === "running" ? current.cleanupMessage : undefined,
      }));

      if (selectedServerId) {
        try { await loadServerWorlds(selectedServerId, normalizedServers.find(s => s.id === selectedServerId && (!state.selectedProviderId || s.providerId === state.selectedProviderId))?.providerId); }
        catch { /* Missing optional world details must not block a successful inventory/status refresh. */ }
      }

      for (const provider of providerList.providers) {
        await getProvider(provider.id);
      }
    } catch (error) {
      if (generation !== refreshGeneration.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [loadServerWorlds, state.selectedServerId, state.selectedProviderId, accessKey]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    let disposed = false;
    let stream: DashboardEventStream | undefined;
    void getWebSocketOptions().then(options => {
      if (disposed) return;
      if (options.authenticationRequired && !accessKey) {
        setState(current => ({ ...current, wsConnection: "disconnected" }));
        return;
      }
      stream = new DashboardEventStream(
        `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`,
        (event: ProviderEvent) => { if (!disposed) setState(current => applyProviderEvent(current, event)); },
        connection => { if (!disposed) setState(current => ({ ...current, wsConnection: connection })); },
        accessKey || undefined,
      );
      eventStreamRef.current = stream;
      stream.connect();
    }).catch(() => { if (!disposed) setState(current => ({ ...current, wsConnection: "disconnected" })); });
    return () => {
      disposed = true;
      stream?.disconnect();
      eventStreamRef.current = null;
    };
  }, [accessKey]);

  const selectServer = useCallback(
    async (serverId: string, providerId?: string) => {
      setState((current) => ({ ...current, selectedServerId: serverId, selectedProviderId: providerId }));
      try { await loadServerWorlds(serverId, providerId); } catch { /* Status remains independently refreshable. */ }
      try {
        const status = await getServerStatus(serverId, providerId);
        const server = stateRef.current.servers.find(s => s.id === serverId && (!providerId || s.providerId === providerId));
        if (server) observeStatus(inventoryKey(server), status);
      } catch {
        // Keep existing status if status refresh fails.
      }
    },
    [loadServerWorlds, observeStatus],
  );

  const showProvisionedServer = useCallback(async (providerId: string, serverId: string, open: boolean) => {
    // Inventory is independent of optional authenticated history/analytics panels.
    const inventory = await getServers();
    if (!inventory.servers.some(server => server.providerId === providerId && server.id === serverId)) throw new Error("Created server is not yet in inventory.");
    setState(current => ({ ...current, loading: false,
      servers: inventory.servers.map(server => ({ ...server, status: normalizeLifecycleState(server.status) })),
      selectedServerId: open ? serverId : current.selectedServerId,
      selectedProviderId: open ? providerId : current.selectedProviderId,
    }));
  }, []);

  const runCommand = useCallback(async (command: "start" | "stop" | "restart", key?: ServerKey) => {
    const server = selectedServer;
    const target = key || (server && inventoryKey(server));
    if (target) await commandRunner.current?.submit(target, command);
  }, [selectedServer]);

  const runWorldValidation = useCallback(
    async (worldId: string) => {
      if (!state.selectedServerId) {
        return;
      }

      setState((current) => markWorldValidating(current, state.selectedServerId!, worldId));
      try {
        const result = await validateWorld(state.selectedServerId, worldId);
        setState((current) => setWorldValidation(current, state.selectedServerId!, worldId, result));
      } catch (error) {
        setState((current) => ({
          ...current,
          worldsByServer: {
            ...current.worldsByServer,
            [state.selectedServerId!]: (current.worldsByServer[state.selectedServerId!] || []).map((world) =>
              world.id === worldId
                ? {
                    ...world,
                    validationState: "error",
                    validationResult: {
                      valid: false,
                      missingPacks: [],
                      invalidPacks: [],
                      errors: [
                        {
                          type: "validation_error",
                          message: error instanceof Error ? error.message : String(error),
                        },
                      ],
                    },
                  }
                : world,
            ),
          },
        }));
      }
    },
    [state.selectedServerId],
  );

  const applyManualRefresh = useCallback(async () => {
    await refreshData();
    await refreshStatuses();
  }, [refreshData, refreshStatuses]);

  const previousConnection = useRef(state.wsConnection);
  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = state.wsConnection;
    if (state.wsConnection === "connected" && previous === "reconnecting") void applyManualRefresh();
  }, [state.wsConnection, applyManualRefresh]);

  const cleanupHistory = useCallback(async () => {
    setState((current) => ({
      ...current,
      cleanupState: "running",
      cleanupMessage: "Cleaning historical records...",
    }));

    try {
      const cleanup = await requestHistoryCleanup("dashboard-user");
      const historyOverviewResponse = await getHistoryOverview();
      const analyticsResponse = await getAnalyticsSummary({ window: "24h" });

      setState((current) => ({
        ...current,
        persistenceOverview: historyOverviewResponse.data,
        analyticsSummary: analyticsResponse.data,
        cleanupState: "completed",
        cleanupMessage:
          `Cleanup completed: operations=${cleanup.cleanup.operationsDeleted}, events=${cleanup.cleanup.eventsDeleted}, audit=${cleanup.cleanup.auditDeleted}`,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        cleanupState: "failed",
        cleanupMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  return {
    state,
    selectedServer,
    selectServer,
    showProvisionedServer,
    refreshData: applyManualRefresh,
    runCommand,
    recheckCommand: (key: ServerKey) => commandRunner.current?.recheck(key),
    associateCommand: (key: ServerKey, operationId: string, reviewed: boolean) => commandRunner.current?.associate(key, operationId, reviewed),
    runWorldValidation,
    cleanupHistory,
  };
}
