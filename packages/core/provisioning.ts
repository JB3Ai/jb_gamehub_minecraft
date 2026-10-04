/** Planning-only contracts. This module has no filesystem, network or runtime dependencies. */
export type ProvisioningJson = null | boolean | number | string | ProvisioningJson[] | { [key: string]: ProvisioningJson };
export type ProvisioningStorage =
  | { mode: "create"; rootId: string; directoryName?: string }
  | { mode: "adopt"; locationRef: string };
export type ProvisioningEndpointRequest =
  | { id: string; protocol: string; transport: "virtual" }
  | {
      id: string;
      protocol: string;
      transport: "tcp" | "udp";
      bindAddress: string;
      port: { mode: "fixed"; value: number } | { mode: "allocate"; poolId: string };
    };

export interface ServerProvisioningRequest {
  schemaVersion: 1;
  providerId: string;
  serverId?: string;
  displayName?: string;
  hostId: string;
  storage: ProvisioningStorage;
  endpoints: ProvisioningEndpointRequest[];
  providerOptions?: Record<string, ProvisioningJson>;
}

export interface ProvisioningIssue {
  code: string;
  severity: "warning" | "blocking";
  field: string;
  message: string;
}
export interface ProvisioningValidationResult {
  valid: boolean;
  errors: ProvisioningIssue[];
}
export type ProvisioningState = "REQUESTED" | "PLANNED" | "VALIDATED" | "APPLYING"
  | "PROVISIONED" | "STARTING" | "READY" | "FAILED" | "ROLLING_BACK"
  | "ROLLED_BACK" | "PARTIALLY_ROLLED_BACK";
export type ProvisioningPlanStatus = "planned" | "blocked" | "expired";
export type ProvisioningOutcome = "planned" | "applied" | "failed" | "rolled-back" | "partially-rolled-back";

export interface ManagedPathDescriptor {
  ownership: "managed" | "external";
  reference: ProvisioningStorage;
  resolved: false; // Structural reference only; no filesystem inspection in 022B.
}
export interface EndpointReservationDescriptor {
  hostId: string;
  request: ProvisioningEndpointRequest;
  status: "unreserved"; // No actual allocation or bind probe in this slice.
}
export interface ProvisioningPlannedOperation {
  id: string;
  kind: "CREATE_MANAGED_DIRECTORY" | "WRITE_CONFIGURATION" | "INSPECT_EXISTING_RUNTIME" | "RESERVE_ENDPOINT" | "REGISTER_SERVER";
  description: string;
  dependsOn: string[];
  resourceRef: string;
  descriptiveOnly: true;
}
export type ProvisioningReadonly<T> = T extends object ? { readonly [K in keyof T]: ProvisioningReadonly<T[K]> } : T;
export type ServerProvisioningPlan = ProvisioningReadonly<{
  schemaVersion: 1;
  requestId: string;
  planId: string;
  serverId: string;
  providerId: string;
  adapterVersion: string;
  mode: ProvisioningStorage["mode"];
  displayName: string;
  request: ServerProvisioningRequest;
  managedPaths: ManagedPathDescriptor[];
  endpoints: EndpointReservationDescriptor[];
  operations: ProvisioningPlannedOperation[];
  warnings: ProvisioningIssue[];
  validation: ProvisioningValidationResult;
  status: ProvisioningPlanStatus;
  createdAt: string;
  requiresApproval: true;
}>;
export interface ProvisioningResult {
  requestId: string;
  planId: string;
  serverId: string;
  providerId: string;
  outcome: ProvisioningOutcome;
  state: ProvisioningState;
  issues: ProvisioningIssue[];
}
export interface ProvisioningPlanner {
  plan(request: ServerProvisioningRequest): Promise<ServerProvisioningPlan>;
}

export class ProvisioningValidationError extends Error {
  readonly code = "PROVISIONING_REQUEST_INVALID";
  constructor(readonly issues: ProvisioningIssue[]) {
    super("Provisioning request is invalid.");
    this.name = "ProvisioningValidationError";
  }
}
export class ProvisioningCapabilityError extends Error {
  readonly code = "PROVISIONING_UNSUPPORTED";
  constructor(providerId: string) {
    super(`Provider '${providerId}' does not support provisioning planning.`);
    this.name = "ProvisioningCapabilityError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function reference(value: unknown): value is string {
  return typeof value === "string" && referencePattern.test(value);
}

/** Reject lossy/non-data JSON (including accessors) without interpreting option keys. */
function jsonData(value: unknown, ancestors = new Set<object>(), depth = 0, budget = { nodes: 10_000 }): boolean {
  if (--budget.nodes < 0 || depth > 32) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 16_384;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || (!Array.isArray(value) && !object(value)) || ancestors.has(value)) return false;
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && (keys.length !== value.length + 1 || !keys.every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key))))) return false;
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor) || !jsonData(descriptor.value, ancestors, depth + 1, budget)) return false;
  }
  ancestors.delete(value);
  return true;
}

export function validateProvisioningRequest(input: unknown): ProvisioningValidationResult {
  const errors: ProvisioningIssue[] = [];
  const error = (field: string, message: string, code = "INVALID_FIELD") => errors.push({ code, severity: "blocking", field, message });
  if (!object(input) || !jsonData(input)) {
    error("request", "Expected bounded plain JSON data without functions, accessors or runtime handles.", "INVALID_JSON_DATA");
    return { valid: false, errors };
  }
  const keys = (value: Record<string, unknown>, allowed: string[], field: string) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) error(`${field}.${key}`, "Unknown or mutually exclusive field.");
  };
  const ref = (value: unknown, field: string) => { if (!reference(value)) error(field, "Expected a 1-64 character identifier using letters, digits, hyphens or underscores."); };
  keys(input, ["schemaVersion", "providerId", "serverId", "displayName", "hostId", "storage", "endpoints", "providerOptions"], "request");
  if (input.schemaVersion !== 1) error("schemaVersion", "Expected schema version 1.");
  ref(input.providerId, "providerId");
  ref(input.hostId, "hostId");
  if ("serverId" in input) ref(input.serverId, "serverId");
  if ("displayName" in input && (typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(input.displayName))) error("displayName", "Expected a nonblank display name of at most 120 characters without control characters.");
  if (!object(input.storage)) error("storage", "An explicit create or adopt storage mode is required.");
  else if (input.storage.mode === "create") {
    keys(input.storage, ["mode", "rootId", "directoryName"], "storage");
    ref(input.storage.rootId, "storage.rootId");
    if ("directoryName" in input.storage) {
      ref(input.storage.directoryName, "storage.directoryName");
      if (typeof input.storage.directoryName === "string" && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(input.storage.directoryName)) error("storage.directoryName", "Reserved device names cannot be directory names.");
    }
  } else if (input.storage.mode === "adopt") {
    keys(input.storage, ["mode", "locationRef"], "storage");
    ref(input.storage.locationRef, "storage.locationRef");
  } else error("storage.mode", "Mode must explicitly be create or adopt.");
  if ("providerOptions" in input && !object(input.providerOptions)) error("providerOptions", "Provider options must be a plain JSON object.");
  if (!Array.isArray(input.endpoints) || input.endpoints.length > 64) error("endpoints", "Expected an array of at most 64 endpoint requests.");
  else {
    const ids = new Set<string>();
    const definitions = new Set<string>();
    input.endpoints.forEach((endpoint, index) => {
      const field = `endpoints[${index}]`;
      if (!object(endpoint)) { error(field, "Expected an endpoint object."); return; }
      ref(endpoint.id, `${field}.id`);
      ref(endpoint.protocol, `${field}.protocol`);
      if (typeof endpoint.id === "string") {
        if (ids.has(endpoint.id)) error(`${field}.id`, "Duplicate endpoint ID.", "DUPLICATE_ENDPOINT");
        ids.add(endpoint.id);
      }
      if (endpoint.transport === "virtual") keys(endpoint, ["id", "protocol", "transport"], field);
      else if (endpoint.transport === "tcp" || endpoint.transport === "udp") {
        keys(endpoint, ["id", "protocol", "transport", "bindAddress", "port"], field);
        if (typeof endpoint.bindAddress !== "string" || !endpoint.bindAddress || endpoint.bindAddress.length > 253 || !/^[A-Za-z0-9.:%_-]+$/.test(endpoint.bindAddress)) error(`${field}.bindAddress`, "Expected a nonblank address without whitespace or URL/path syntax.");
        if (!object(endpoint.port)) error(`${field}.port`, "Expected a fixed port or allocation pool.");
        else if (endpoint.port.mode === "fixed") {
          keys(endpoint.port, ["mode", "value"], `${field}.port`);
          if (!Number.isInteger(endpoint.port.value) || (endpoint.port.value as number) < 1 || (endpoint.port.value as number) > 65535) error(`${field}.port.value`, "Port must be an integer from 1 to 65535.");
        } else if (endpoint.port.mode === "allocate") {
          keys(endpoint.port, ["mode", "poolId"], `${field}.port`);
          ref(endpoint.port.poolId, `${field}.port.poolId`);
        } else error(`${field}.port.mode`, "Expected fixed or allocate.");
      } else error(`${field}.transport`, "Expected tcp, udp or virtual.");
      // Labels/protocols cannot disguise duplicate concrete socket requests.
      const { id: _id, protocol, ...binding } = endpoint;
      const definition = canonicalProvisioningJson(endpoint.transport === "virtual" ? { protocol, ...binding } : binding);
      if (definitions.has(definition)) error(field, "Duplicate endpoint definition.", "DUPLICATE_ENDPOINT");
      definitions.add(definition);
    });
  }
  return { valid: errors.length === 0, errors };
}

export function parseProvisioningRequest(input: unknown): ServerProvisioningRequest {
  const validation = validateProvisioningRequest(input);
  if (!validation.valid) throw new ProvisioningValidationError(validation.errors);
  return JSON.parse(canonicalProvisioningJson(input)) as ServerProvisioningRequest;
}

/** Object-key order is immaterial; array order is retained as part of request identity. */
export function canonicalProvisioningJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalProvisioningJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalProvisioningJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function freezeProvisioningData<T>(value: T): ProvisioningReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeProvisioningData(child);
    Object.freeze(value);
  }
  return value as ProvisioningReadonly<T>;
}
