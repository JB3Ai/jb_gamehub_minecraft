import {
  DashboardState,
  OperationRecord,
  ProviderEvent,
  ServerInventoryItem,
  ServerLifecycleState,
  ValidationResult,
  WebSocketConnectionState,
  WorldRuntime,
} from "./types";

const MAX_EVENTS = 200;
const MAX_OPERATIONS = 100;

function toLifecycleState(status: string | undefined): ServerLifecycleState {
  if (status === "online" || status === "offline" || status === "starting" || status === "stopping") {
    return status;
  }
  return "unknown";
}

export function createInitialDashboardState(): DashboardState {
  return {
    loading: true,
    providers: {},
    servers: [],
    operations: [],
    worldsByServer: {},
    events: [],
    wsConnection: "connecting",
  };
}

export function upsertServer(servers: ServerInventoryItem[], next: ServerInventoryItem): ServerInventoryItem[] {
  const existingIndex = servers.findIndex((server) => server.id === next.id);
  if (existingIndex === -1) {
    return [...servers, next];
  }

  const copy = [...servers];
  copy[existingIndex] = { ...copy[existingIndex], ...next };
  return copy;
}

export function upsertOperation(operations: OperationRecord[], next: OperationRecord): OperationRecord[] {
  const existingIndex = operations.findIndex((operation) => operation.operationId === next.operationId);
  if (existingIndex === -1) {
    return [next, ...operations].slice(0, MAX_OPERATIONS);
  }

  const copy = [...operations];
  copy[existingIndex] = { ...copy[existingIndex], ...next };
  return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_OPERATIONS);
}

export function setWorldsForServer(state: DashboardState, serverId: string, worlds: WorldRuntime[]): DashboardState {
  return {
    ...state,
    worldsByServer: {
      ...state.worldsByServer,
      [serverId]: worlds,
    },
  };
}

export function setWorldValidation(
  state: DashboardState,
  serverId: string,
  worldId: string,
  validationResult: ValidationResult,
): DashboardState {
  const worlds = state.worldsByServer[serverId] || [];
  const nextWorlds: WorldRuntime[] = worlds.map((world) => {
    if (world.id !== worldId) {
      return world;
    }

    return {
      ...world,
      validationState: validationResult.valid ? "valid" : "invalid",
      validationResult,
    };
  });

  return {
    ...state,
    worldsByServer: {
      ...state.worldsByServer,
      [serverId]: nextWorlds,
    },
  };
}

export function markWorldValidating(state: DashboardState, serverId: string, worldId: string): DashboardState {
  const worlds = state.worldsByServer[serverId] || [];
  const nextWorlds: WorldRuntime[] = worlds.map((world) =>
    world.id === worldId ? { ...world, validationState: "validating" } : world,
  );

  return {
    ...state,
    worldsByServer: {
      ...state.worldsByServer,
      [serverId]: nextWorlds,
    },
  };
}

export function reduceConnectionState(
  current: WebSocketConnectionState,
  event: "socket_open" | "socket_close" | "socket_retry" | "socket_error",
): WebSocketConnectionState {
  if (event === "socket_open") {
    return "connected";
  }

  if (event === "socket_retry") {
    return current === "connected" ? "reconnecting" : "reconnecting";
  }

  if (event === "socket_close") {
    return "disconnected";
  }

  return current === "connected" ? "reconnecting" : "disconnected";
}

export function applyProviderEvent(state: DashboardState, incoming: ProviderEvent): DashboardState {
  const nextEvents = [incoming, ...state.events].slice(0, MAX_EVENTS);
  let nextState: DashboardState = {
    ...state,
    events: nextEvents,
  };

  if (incoming.type === "server.status.changed" && incoming.serverId) {
    nextState = {
      ...nextState,
      servers: nextState.servers.map((server) => {
        if (server.id !== incoming.serverId) {
          return server;
        }

        const lifecycle = toLifecycleState(incoming.status);
        return {
          ...server,
          status: lifecycle,
          availability: lifecycle === "online" || lifecycle === "starting",
          lastStatusUpdate: incoming.timestamp,
        };
      }),
    };
  }

  if (
    (incoming.type === "operation.created" ||
      incoming.type === "operation.started" ||
      incoming.type === "operation.completed" ||
      incoming.type === "operation.failed") &&
    incoming.payload &&
    typeof incoming.payload === "object"
  ) {
    const payload = incoming.payload as Partial<OperationRecord>;
    if (payload.operationId && payload.type && payload.status && payload.createdAt && payload.providerId) {
      nextState = {
        ...nextState,
        operations: upsertOperation(nextState.operations, payload as OperationRecord),
      };
    }
  }

  if (incoming.type === "world.validation.completed" && incoming.serverId && incoming.worldId) {
    const result = incoming.payload as ValidationResult | undefined;
    if (result) {
      nextState = setWorldValidation(nextState, incoming.serverId, incoming.worldId, result);
    }
  }

  return nextState;
}
