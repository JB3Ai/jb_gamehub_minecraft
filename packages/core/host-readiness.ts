import { isIP } from "node:net";

export type ReadinessStatus = "PASS" | "WARNING" | "BLOCKED";
export type HostReadinessStatus = ReadinessStatus;
export interface ReadinessCheck {
  id: string;
  category: "host" | "storage" | "network" | "runtime";
  status: ReadinessStatus;
  code: string;
  facts?: Record<string, string | number | boolean>;
}
export interface HostReadinessCheck extends ReadinessCheck { title: string; message: string; remediation?: string; details?: Record<string, string | number | boolean> }
export interface HostEndpoint { id: string; hostId: string; transport: "tcp" | "udp"; bindAddress: string; port: number }
export interface HostReadinessInput {
  locations: Array<{ id: string; path: string }>;
  endpoints: HostEndpoint[];
  reservations: Array<{ hostId: string; transport: "tcp" | "udp"; port: number }>;
  databasePath?: string;
  diskThresholds?: { minimumBytes: bigint; recommendedBytes: bigint };
  configuration?: { configured: boolean; managedRuntimeCount: number; attachedRuntimeCount: number };
}
export interface StorageObservation {
  exists: boolean;
  access: "allowed-advisory" | "denied";
  availableBytes: bigint;
}
export interface HostObservation {
  platform: string; architecture: string; elevated: boolean;
  capabilityChecksAvailable: boolean;
  inventory: { complete: boolean; bindings: Array<{ transport: "tcp" | "udp"; bindAddress: string; port: number }> };
}
export interface ReadinessProbes {
  host(): Promise<HostObservation>;
  storage(location: string): Promise<StorageObservation>;
  runtimes(): Promise<ReadinessCheck[]>;
  database?(location: string): Promise<{ exists: boolean; readable: boolean; formatValid: boolean; locationAccess: "allowed-advisory" | "denied" }>;
  now?(): Date;
}
export interface HostReadinessReport {
  schemaVersion: 1;
  checkedAt: string;
  platform: string;
  status: ReadinessStatus;
  checks: HostReadinessCheck[];
  readOnly: true;
  authorizationGranted: false;
  configuration: { configured: boolean; managedRuntimeCount: number; attachedRuntimeCount: number; preserveExisting: true };
}
function present(check: ReadinessCheck): HostReadinessCheck {
  const copy: Record<string, [string, string, string?]> = {
    WINDOWS_X64_AVAILABLE: ["Windows host", "Windows x64 host capabilities are available."],
    WINDOWS_CAPABILITIES_UNAVAILABLE: ["Windows host", "This host does not meet the Windows x64 capability requirements.", "Use a supported Windows x64 host with PowerShell 5 or newer and network inventory commands."],
    HOST_OBSERVATION_UNAVAILABLE: ["Windows host", "Host capabilities could not be inspected.", "Check host permissions and PowerShell availability, then recheck."],
    PROCESS_ELEVATED: ["Administrator access", "GameHub is running with administrator privileges."],
    PROCESS_NOT_ELEVATED: ["Administrator access", "GameHub is not elevated. Ordinary setup can continue where permissions allow.", "Use a private writable data location. Elevate only for a separately approved action that requires it."],
    STORAGE_WRITE_UNVERIFIED: ["Storage access", "The storage location is accessible; write permission has not been verified.", "Verify write access during storage configuration. This assessment does not create a probe file."],
    STORAGE_CREATION_REQUIRED: ["Storage location", "The proposed storage directory has not been created.", "Review and configure storage in the next step."],
    STORAGE_ACCESS_DENIED: ["Storage access", "The configured storage location is not accessible for setup.", "Choose an accessible private location or correct its permissions, then recheck."],
    STORAGE_PATH_UNSAFE: ["Storage location", "The configured location uses an unsupported path or link.", "Choose a local directory without symbolic links or junctions."],
    STORAGE_NOT_DIRECTORY: ["Storage location", "A configured storage path is not a directory.", "Review the configured storage location."],
    STORAGE_OBSERVATION_UNAVAILABLE: ["Storage location", "Storage readiness could not be inspected.", "Check the configured location and recheck."],
    STORAGE_NOT_CONFIGURED: ["Storage location", "No managed storage root is configured yet.", "Choose a storage location during runtime configuration."],
    DISK_SPACE_LOW: ["Free disk space", "Available space is below the configured diagnostic minimum.", "Free space or choose another location, then recheck."],
    DISK_SPACE_WARNING: ["Free disk space", "Available space is below the recommended diagnostic capacity.", "Free additional space before installing a runtime."],
    DISK_SPACE_AVAILABLE: ["Free disk space", "The diagnostic disk-space minimum is met. Runtime size checks still apply."],
    ENDPOINT_INVENTORY_COMPLETE: ["Network inventory", "Current TCP and UDP bindings were inspected."],
    ENDPOINT_INVENTORY_UNAVAILABLE: ["Network inventory", "A complete TCP/UDP inventory is unavailable.", "Check network-query permissions and recheck. Unknown ports are not assumed free."],
    ENDPOINTS_NOT_CONFIGURED: ["Required ports", "No approved endpoint defaults are configured yet.", "Review endpoint defaults during runtime configuration."],
    ENDPOINT_OBSERVED_FREE: ["Required port", "The selected connection port is currently free."],
    ENDPOINT_RESERVED: ["Required port", "An existing managed operation retains this port reservation.", "Preserve the existing runtime and choose an unused endpoint for a new server."],
    ENDPOINT_OCCUPIED: ["Required port", "The selected connection port is already in use.", "Review the listener or choose another approved port. Do not stop an existing server automatically."],
    ENDPOINT_STATUS_UNKNOWN: ["Required port", "Availability could not be confirmed.", "Resolve the inventory issue and recheck."],
    ENDPOINT_CONFIGURATION_INVALID: ["Required port", "An endpoint default is invalid.", "Ask the operator to review the approved endpoint configuration."],
    JAVA_VERSION_DISCOVERED: ["Java runtime", "A Java version was discovered. Compatibility and approval depend on the chosen runtime profile."],
    JAVA_NOT_DISCOVERED: ["Java runtime", "No Java runtime was discovered.", "Configure an approved runtime if you choose Java."],
    JAVA_REQUIRED_NOT_DISCOVERED: ["Java runtime", "The selected Java provider has no discovered runtime.", "Configure an approved Java runtime, then recheck."],
    JAVA_VERSION_UNAVAILABLE: ["Java runtime", "A Java candidate was found, but its version could not be verified.", "Review the approved runtime during runtime configuration."],
    JAVA_CONFIGURED_CANDIDATE_MISSING: ["Java runtime", "A configured Java candidate is missing.", "Correct the approved runtime reference or choose another provider."],
    JAVA_CANDIDATE_UNSAFE: ["Java runtime", "A Java candidate uses an unsupported file or link.", "Review the approved runtime location."],
    JAVA_CANDIDATE_UNREADABLE: ["Java runtime", "A Java candidate could not be inspected.", "Check permissions and recheck."],
    RUNTIME_DISCOVERY_UNAVAILABLE: ["Runtime discovery", "Runtime discovery could not complete.", "Check runtime configuration and recheck."],
    JAVA_PROFILE_NOT_CONFIGURED: ["Java prerequisites", "No approved Java runtime profile is configured.", "Configure an approved Java profile before creating a Java server."],
    JAVA_SOURCE_PATHS_AVAILABLE: ["Java prerequisites", "Required Java runtime and server source paths are present. Hash and approval validation remain separate."],
    JAVA_SOURCE_PATHS_MISSING: ["Java prerequisites", "Required Java runtime or server source files are missing.", "Correct the approved source references. This assessment will not download or install files."],
    BEDROCK_PROFILE_NOT_CONFIGURED: ["Bedrock prerequisites", "No approved Bedrock bundle profile is configured.", "Configure an approved native Bedrock bundle if you choose Bedrock."],
    BEDROCK_SOURCE_PATHS_AVAILABLE: ["Bedrock prerequisites", "Approved Bedrock bundle sources are present. Runtime dependency and hash validation remain separate."],
    BEDROCK_SOURCE_PATHS_MISSING: ["Bedrock prerequisites", "Required Bedrock bundle sources are missing or unsafe.", "Review the approved bundle references. Existing installs will not be changed."],
    DATABASE_READABLE: ["GameHub database", "The existing SQLite file is readable. It was not opened as a database or migrated. Write access remains unverified."],
    DATABASE_CREATION_REQUIRED: ["GameHub database", "A database has not been created at the configured location.", "Review the database location during configuration. This assessment does not create it."],
    DATABASE_LOCATION_UNAVAILABLE: ["GameHub database", "The database location cannot be safely inspected.", "Review its permissions and local path, then recheck."],
    DATABASE_UNREADABLE: ["GameHub database", "The configured file is unreadable or does not have a SQLite header.", "Review the database reference. Do not replace or delete an existing database."],
    DATABASE_NOT_CONFIGURED: ["GameHub database", "No database location is configured for this assessment.", "Review the database location during configuration."],
    HOST_ALREADY_CONFIGURED: ["Existing configuration", "GameHub already has approved provider/storage configuration. It will be preserved."],
    HOST_CONFIGURATION_REQUIRED: ["Existing configuration", "GameHub has not completed host configuration.", "Continue to storage/runtime configuration when blocking checks are resolved."],
    EXISTING_RUNTIMES_PRESERVED: ["Existing servers", "Existing managed or attached runtimes were found. This assessment does not change them."],
    NO_EXISTING_RUNTIMES: ["Existing servers", "No managed or attached runtime definitions were found."],
  };
  const [title, message, remediation] = copy[check.code] ?? ["Host readiness", "This check needs operator review.", "Review the host configuration and recheck."];
  return { ...check, title, message, ...(remediation ? { remediation } : {}), ...(check.facts ? { details: check.facts } : {}) };
}
export class ReadinessProbeError extends Error {
  constructor(readonly code: "STORAGE_PATH_UNSAFE" | "STORAGE_NOT_DIRECTORY" | "STORAGE_ACCESS_DENIED") { super(code); }
}
export function readinessStatus(checks: ReadinessCheck[]): ReadinessStatus {
  return checks.some(check => check.status === "BLOCKED") ? "BLOCKED" : checks.some(check => check.status === "WARNING") ? "WARNING" : "PASS";
}
const normalizedAddress = (address: string) => /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] ?? address.toLowerCase();
export function addressesOverlap(left: string, right: string): boolean {
  const a = normalizedAddress(left), b = normalizedAddress(right);
  return a === b || a === "::" || b === "::" || a === "0.0.0.0" && isIP(b) === 4 || b === "0.0.0.0" && isIP(a) === 4;
}
function validBinding(binding: HostObservation["inventory"]["bindings"][number]) {
  return binding && ["tcp", "udp"].includes(binding.transport) && typeof binding.bindAddress === "string" && isIP(binding.bindAddress) !== 0 && Number.isInteger(binding.port) && binding.port >= 1 && binding.port <= 65535;
}

/** Observations only. This service has no provisioning, lifecycle, policy-write or consent capability. */
export async function inspectHostReadiness(input: HostReadinessInput, probes: ReadinessProbes): Promise<HostReadinessReport> {
  const checkedAt = (probes.now?.() ?? new Date()).toISOString();
  const { minimumBytes: minimum, recommendedBytes: recommended } = input.diskThresholds ?? { minimumBytes: 1024n ** 3n, recommendedBytes: 2n * 1024n ** 3n };
  if (minimum < 0n || recommended < minimum) throw new Error("READINESS_THRESHOLD_INVALID");
  if (input.locations.length > 32 || input.endpoints.length > 128 || input.reservations.length > 32768) throw new Error("READINESS_CONFIGURATION_LIMIT");
  const checks: ReadinessCheck[] = [];
  let host: HostObservation | undefined;
  try { host = await probes.host(); }
  catch { checks.push({ id: "host.discovery", category: "host", status: "BLOCKED", code: "HOST_OBSERVATION_UNAVAILABLE" }); }
  if (host) {
    const supported = host.platform === "win32" && host.architecture === "x64" && host.capabilityChecksAvailable;
    checks.push({ id: "host.capabilities", category: "host", status: supported ? "PASS" : "BLOCKED", code: supported ? "WINDOWS_X64_AVAILABLE" : "WINDOWS_CAPABILITIES_UNAVAILABLE", facts: { platform: host.platform, architecture: host.architecture } });
    checks.push({ id: "host.elevation", category: "host", status: host.elevated ? "PASS" : "WARNING", code: host.elevated ? "PROCESS_ELEVATED" : "PROCESS_NOT_ELEVATED" });
  }
  const inventory = host?.inventory;
  const complete = inventory?.complete === true && Array.isArray(inventory.bindings) && inventory.bindings.length <= 32768 && inventory.bindings.every(validBinding);
  checks.push({ id: "network.inventory", category: "network", status: complete ? "PASS" : "BLOCKED", code: complete ? "ENDPOINT_INVENTORY_COMPLETE" : "ENDPOINT_INVENTORY_UNAVAILABLE" });
  if (!input.endpoints.length) checks.push({ id: "network.defaults", category: "network", status: "WARNING", code: "ENDPOINTS_NOT_CONFIGURED" });
  for (const endpoint of input.endpoints) {
    const conflict = complete && inventory.bindings.some(binding => binding.transport === endpoint.transport && binding.port === endpoint.port && addressesOverlap(binding.bindAddress, endpoint.bindAddress));
    const reserved = input.reservations.some(reservation => reservation.hostId === endpoint.hostId && reservation.transport === endpoint.transport && reservation.port === endpoint.port);
    const code = !validBinding(endpoint) ? "ENDPOINT_CONFIGURATION_INVALID" : !complete ? "ENDPOINT_STATUS_UNKNOWN" : conflict ? "ENDPOINT_OCCUPIED" : reserved ? "ENDPOINT_RESERVED" : "ENDPOINT_OBSERVED_FREE";
    checks.push({ id: endpoint.id, category: "network", status: ["ENDPOINT_CONFIGURATION_INVALID", "ENDPOINT_STATUS_UNKNOWN"].includes(code) ? "BLOCKED" : reserved || conflict ? "WARNING" : "PASS", code,
      facts: { transport: endpoint.transport, port: endpoint.port, reserved, reservationAcquired: false } });
  }
  if (!input.locations.length) checks.push({ id: "storage.defaults", category: "storage", status: "WARNING", code: "STORAGE_NOT_CONFIGURED" });
  for (const location of input.locations) {
    try {
      const observation = await probes.storage(location.path);
      if (observation.availableBytes < 0n) throw new Error("INVALID_CAPACITY");
      checks.push({ id: location.id + ".access", category: "storage", status: observation.access === "denied" ? "BLOCKED" : "WARNING",
        code: observation.access === "denied" ? "STORAGE_ACCESS_DENIED" : observation.exists ? "STORAGE_WRITE_UNVERIFIED" : "STORAGE_CREATION_REQUIRED",
        facts: { exists: observation.exists, writeTestPerformed: false } });
      // A diagnostic capacity floor, not a guarantee that any particular bundle fits.
      const bytes = observation.availableBytes;
      checks.push({ id: location.id + ".capacity", category: "storage", status: bytes < minimum ? "BLOCKED" : bytes < recommended ? "WARNING" : "PASS", code: bytes < minimum ? "DISK_SPACE_LOW" : bytes < recommended ? "DISK_SPACE_WARNING" : "DISK_SPACE_AVAILABLE", facts: { availableBytes: bytes.toString(), minimumBytes: minimum.toString(), recommendedBytes: recommended.toString() } });
    } catch (error) {
      checks.push({ id: location.id, category: "storage", status: "BLOCKED", code: error instanceof ReadinessProbeError ? error.code : "STORAGE_OBSERVATION_UNAVAILABLE" });
    }
  }
  try { checks.push(...await probes.runtimes()); }
  catch { checks.push({ id: "runtime.discovery", category: "runtime", status: "WARNING", code: "RUNTIME_DISCOVERY_UNAVAILABLE" }); }
  if (input.databasePath && probes.database) {
    try {
      const database = await probes.database(input.databasePath);
      const blocked = database.locationAccess === "denied" || database.exists && (!database.readable || !database.formatValid);
      checks.push({ id: "database", category: "storage", status: blocked ? "BLOCKED" : "WARNING", code: database.locationAccess === "denied" ? "DATABASE_LOCATION_UNAVAILABLE" : blocked ? "DATABASE_UNREADABLE" : database.exists ? "DATABASE_READABLE" : "DATABASE_CREATION_REQUIRED", facts: { configured: true, exists: database.exists, databaseOpened: false, writeTestPerformed: false } });
    } catch { checks.push({ id: "database", category: "storage", status: "BLOCKED", code: "DATABASE_LOCATION_UNAVAILABLE" }); }
  } else checks.push({ id: "database", category: "storage", status: "WARNING", code: "DATABASE_NOT_CONFIGURED" });
  const configuration = { ...(input.configuration ?? { configured: false, managedRuntimeCount: 0, attachedRuntimeCount: 0 }), preserveExisting: true as const };
  checks.push({ id: "configuration", category: "host", status: configuration.configured ? "PASS" : "WARNING", code: configuration.configured ? "HOST_ALREADY_CONFIGURED" : "HOST_CONFIGURATION_REQUIRED", facts: { configured: configuration.configured } });
  const existing = configuration.managedRuntimeCount + configuration.attachedRuntimeCount;
  checks.push({ id: "existing-runtimes", category: "host", status: "PASS", code: existing ? "EXISTING_RUNTIMES_PRESERVED" : "NO_EXISTING_RUNTIMES", facts: { managed: configuration.managedRuntimeCount, attached: configuration.attachedRuntimeCount, preserveExisting: true } });
  return { schemaVersion: 1, checkedAt, platform: host?.platform ?? process.platform, status: readinessStatus(checks), checks: checks.map(present), readOnly: true, authorizationGranted: false, configuration };
}
