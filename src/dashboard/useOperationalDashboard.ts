import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEvents,
  getOperation,
  getOperations,
  getProvider,
  getProviders,
  getServerStatus,
  getServers,
  getWorlds,
  runServerCommand,
  validateWorld,
} from "./apiClient";
import { DashboardEventStream } from "./eventStream";
import {
  applyProviderEvent,
  createInitialDashboardState,
  markWorldValidating,
  setWorldValidation,
  setWorldsForServer,
  upsertOperation,
} from "./state";
import { DashboardState, OperationRecord, ProviderEvent, ServerLifecycleState, WorldRuntime } from "./types";

function normalizeLifecycleState(status: string): ServerLifecycleState {
  if (status === "online" || status === "offline" || status === "starting" || status === "stopping") {
    return status;
  }
  return "unknown";
}

async function trackStatusTransition(
  serverId: string,
  expected: ServerLifecycleState,
  applyStatus: (status: ServerLifecycleState) => void,
): Promise<void> {
  const maxChecks = 25;
  for (let i = 0; i < maxChecks; i += 1) {
    const status = await getServerStatus(serverId);
    const normalized = normalizeLifecycleState(status.status);
    applyStatus(normalized);
    if (normalized === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

export function useOperationalDashboard() {
  const [state, setState] = useState<DashboardState>(createInitialDashboardState());
  const eventStreamRef = useRef<DashboardEventStream | null>(null);

  const selectedServer = useMemo(
    () => state.servers.find((server) => server.id === state.selectedServerId),
    [state.servers, state.selectedServerId],
  );

  const loadServerWorlds = useCallback(async (serverId: string) => {
    const worldsResponse = await getWorlds(serverId);
    const worlds: WorldRuntime[] = worldsResponse.worlds.map((world) => ({
      id: world.id,
      name: world.name,
      validationState: "not_validated",
    }));

    setState((current) => setWorldsForServer(current, serverId, worlds));
  }, []);

  const refreshData = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const providerList = await getProviders();
      const providerMap = Object.fromEntries(providerList.providers.map((provider) => [provider.id, provider]));

      const serversResponse = await getServers();
      const operationsResponse = await getOperations(100);
      const eventsResponse = await getEvents(200);
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
        servers: normalizedServers,
        selectedServerId,
        operations: operationsResponse.operations,
        events: persistedEvents,
      }));

      if (selectedServerId) {
        await loadServerWorlds(selectedServerId);
      }

      for (const provider of providerList.providers) {
        await getProvider(provider.id);
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [loadServerWorlds, state.selectedServerId]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    const stream = new DashboardEventStream(
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`,
      (event: ProviderEvent) => {
        setState((current) => applyProviderEvent(current, event));
      },
      (connection) => {
        setState((current) => ({ ...current, wsConnection: connection }));
      },
    );

    eventStreamRef.current = stream;
    stream.connect();

    return () => {
      stream.disconnect();
      eventStreamRef.current = null;
    };
  }, []);

  const selectServer = useCallback(
    async (serverId: string) => {
      setState((current) => ({ ...current, selectedServerId: serverId }));
      await loadServerWorlds(serverId);
      try {
        const status = await getServerStatus(serverId);
        setState((current) => ({
          ...current,
          servers: current.servers.map((server) =>
            server.id === serverId
              ? {
                  ...server,
                  status: normalizeLifecycleState(status.status),
                  availability: status.status === "online" || status.status === "starting",
                  lastStatusUpdate: new Date().toISOString(),
                }
              : server,
          ),
        }));
      } catch {
        // Keep existing status if status refresh fails.
      }
    },
    [loadServerWorlds],
  );

  const runCommand = useCallback(
    async (command: "start" | "stop" | "restart") => {
      if (!state.selectedServerId) {
        return;
      }

      try {
        const ref = await runServerCommand(state.selectedServerId, command);
        const operation = await getOperation(ref.operationId);
        setState((current) => ({
          ...current,
          operations: upsertOperation(current.operations, operation),
        }));

        const expectedStatus: ServerLifecycleState = command === "stop" ? "offline" : "online";
        await trackStatusTransition(state.selectedServerId, expectedStatus, (nextStatus) => {
          setState((current) => ({
            ...current,
            servers: current.servers.map((server) =>
              server.id === state.selectedServerId
                ? {
                    ...server,
                    status: nextStatus,
                    availability: nextStatus === "online" || nextStatus === "starting",
                    lastStatusUpdate: new Date().toISOString(),
                  }
                : server,
            ),
          }));
        });
      } catch (error) {
        const fallback: OperationRecord = {
          operationId: `ui_${Date.now()}`,
          type: command === "start" ? "server.start" : command === "stop" ? "server.stop" : "server.restart",
          providerId: selectedServer?.providerId || "unknown",
          serverId: state.selectedServerId,
          status: "failed",
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          error: {
            code: "COMMAND_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        };

        setState((current) => ({
          ...current,
          operations: upsertOperation(current.operations, fallback),
        }));
      }
    },
    [selectedServer?.providerId, state.selectedServerId],
  );

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
    if (state.selectedServerId) {
      const status = await getServerStatus(state.selectedServerId);
      setState((current) => ({
        ...current,
        servers: current.servers.map((server) =>
          server.id === state.selectedServerId
            ? {
                ...server,
                status: normalizeLifecycleState(status.status),
                availability: status.status === "online" || status.status === "starting",
                lastStatusUpdate: new Date().toISOString(),
              }
            : server,
        ),
      }));
    }
  }, [refreshData, state.selectedServerId]);

  return {
    state,
    selectedServer,
    selectServer,
    refreshData: applyManualRefresh,
    runCommand,
    runWorldValidation,
  };
}
