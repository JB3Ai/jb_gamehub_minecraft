export type ServerLifecycleState = "online" | "offline" | "starting" | "stopping" | "unknown";

export interface ProviderMetadata {
  id: string;
  name: string;
  version: string;
  status: "ready" | "degraded" | "offline";
}

export interface ProviderCapabilitiesResponse extends ProviderMetadata {
  capabilities: Record<string, boolean>;
}

export interface ProviderListResponse {
  providers: ProviderMetadata[];
}

export interface ServerInventoryItem {
  id: string;
  providerId: string;
  name: string;
  serverType: string;
  status: ServerLifecycleState | "error";
  availability: boolean;
  lastStatusUpdate: string;
  endpoints: {
    java: string;
    bedrock?: string;
  };
  diagnostics?: {
    paperDetected: boolean;
    geyserDetected: boolean;
  };
}

export interface ServerInventoryResponse {
  servers: ServerInventoryItem[];
}

export interface ServerStatusResponse {
  status: "online" | "offline" | "starting" | "stopping" | "error";
  players?: number;
  uptimeSeconds?: number;
}

export interface WorldSummary {
  id: string;
  name: string;
  path: string;
}

export interface WorldListResponse {
  worlds: WorldSummary[];
}

export interface ValidationIssue {
  type: string;
  uuid?: string;
  version?: string;
  source?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  missingPacks: ValidationIssue[];
  invalidPacks: ValidationIssue[];
  errors: ValidationIssue[];
  behaviorPackRefs?: Array<{ uuid: string; version: string; source: string }>;
  resourcePackRefs?: Array<{ uuid: string; version: string; source: string }>;
}

export interface OperationRef {
  operationId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

export interface OperationRecord {
  operationId: string;
  type: "server.start" | "server.stop" | "server.restart" | "world.validate";
  providerId: string;
  serverId?: string;
  worldId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: { code: string; message: string };
  result?: unknown;
}

export interface OperationListResponse {
  operations: OperationRecord[];
}

export interface ProviderEvent {
  type:
    | "connection.ready"
    | "operation.created"
    | "operation.started"
    | "operation.completed"
    | "operation.failed"
    | "server.status.changed"
    | "world.validation.completed";
  timestamp: string;
  providerId?: string;
  serverId?: string;
  worldId?: string;
  status?: string;
  operationId?: string;
  payload?: unknown;
  source?: "live" | "persisted";
}

export interface EventListResponse {
  events: ProviderEvent[];
}

export interface WorldRuntime {
  id: string;
  name: string;
  validationState: "not_validated" | "validating" | "valid" | "invalid" | "error";
  validationResult?: ValidationResult;
}

export type WebSocketConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface DashboardState {
  loading: boolean;
  error?: string;
  providers: Record<string, ProviderMetadata>;
  servers: ServerInventoryItem[];
  selectedServerId?: string;
  operations: OperationRecord[];
  worldsByServer: Record<string, WorldRuntime[]>;
  events: ProviderEvent[];
  wsConnection: WebSocketConnectionState;
}
