import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { ProvisioningApiOptions } from "./provisioning-api";
import type { HostObservation, StorageObservation } from "./host-readiness";
import type { OnboardingState } from "./onboarding";

export interface SetupSettings {
  storageRootId: string; databaseLocationId: string; javaRuntimeId?: string; bedrockRuntimeId?: string;
  javaPort: number; bedrockPort: number;
}
export interface SetupConfigurationRecord extends SetupSettings {
  schemaVersion: 1; hostId: string; revision: number; updatedAt: string; updatedBy: string;
  catalogDigest: string; configuredEnoughToProceed: true;
}
export interface SetupConfigurationRepository {
  onboarding(): OnboardingState;
  completeOnboarding(configurationRevision: number, catalogDigest: string, actor: string, now: string): OnboardingState;
  read(): SetupConfigurationRecord | undefined;
  save(settings: SetupSettings, expectedRevision: number, catalogDigest: string, actor: string, now: string): { record: SetupConfigurationRecord; unchanged: boolean };
}
export class SetupConfigurationError extends Error {
  constructor(readonly code: "INVALID_CONFIGURATION" | "CONFIGURATION_STALE" | "CATALOG_STALE" | "CONFIGURATION_UNAVAILABLE" | "CONFIGURATION_VALIDATION_FAILED" | "APPROVAL_REQUIRED", readonly status = 400) { super(code); }
}
export interface SetupChoice { id: string; label: string }
export interface SetupCatalog {
  digest: string;
  storage: Array<SetupChoice & { location: string }>;
  databases: Array<SetupChoice & { location: string }>;
  java: Array<SetupChoice & { location: string; sha256: string }>;
  bedrock: Array<SetupChoice & { location: string; sha256: string }>;
  defaults: { javaPort: number; bedrockPort: number };
}
export interface SetupConfigurationView {
  schemaVersion: 1; hostId: "local"; revision: number; catalogDigest: string;
  record?: Omit<SetupConfigurationRecord, "updatedBy" | "catalogDigest">;
  choices: { storage: SetupChoice[]; databases: SetupChoice[]; java: SetupChoice[]; bedrock: SetupChoice[] };
  defaults: { javaPort: number; bedrockPort: number };
  onboardingComplete: boolean;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (kind: string, value: unknown) => kind + "-" + digest(value).slice(0, 20);
/** Choices resolve only server-owned policy references. Never accepts a path from HTTP. */
export function setupCatalog(options: ProvisioningApiOptions, databasePath: string, defaults: SetupCatalog["defaults"]): SetupCatalog {
  const storage: SetupCatalog["storage"] = [], java: SetupCatalog["java"] = [], bedrock: SetupCatalog["bedrock"] = [];
  for (const [providerId, policy] of Object.entries(options.policies).sort(([a], [b]) => a.localeCompare(b))) {
    if (policy.hostId !== "local") throw new SetupConfigurationError("CONFIGURATION_UNAVAILABLE", 503);
    for (const [rootId, location] of Object.entries(policy.managedRoots).sort(([a], [b]) => a.localeCompare(b))) {
      storage.push({ id: id("root", [providerId, rootId]), label: `Managed storage ${storage.length + 1}`, location });
    }
    for (const [profileId, profile] of Object.entries(policy.managedCreate?.profiles ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (providerId === "minecraft" && profile.runtime) {
        const location = policy.artifactLocations[profile.runtime.reference];
        if (location) java.push({ id: id("java", [profileId, profile.runtime.reference]), label: `Approved Java runtime ${java.length + 1}`, location, sha256: profile.runtime.sha256 });
      }
      if (providerId === "minecraft-bedrock" && profile.bundle) {
        const bundle = policy.managedCreate?.bundles?.[profile.bundle.reference], source = bundle && policy.managedCreate?.bundleLocations?.[bundle.sourceRef];
        const executable = bundle?.files.find(file => file.relativePath === bundle.entrypoint);
        if (source && executable && bundle && !/^(?:[A-Za-z]:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(bundle.entrypoint)) bedrock.push({ id: id("bedrock", [profileId, profile.bundle.reference]), label: `Native Bedrock source ${bedrock.length + 1}`, location: source + "/" + bundle.entrypoint, sha256: executable.sha256 });
      }
    }
  }
  const bound = { storage, databases: [{ id: "default", label: "Current GameHub database", location: databasePath }], java, bedrock, defaults };
  if (storage.length > 32 || java.length > 64 || bedrock.length > 64) throw new SetupConfigurationError("CONFIGURATION_UNAVAILABLE", 503);
  return { ...bound, digest: digest(bound) };
}
export function publicSetupConfiguration(catalog: SetupCatalog, record?: SetupConfigurationRecord): SetupConfigurationView {
  const safe = (choices: SetupChoice[]) => choices.map(({ id, label }) => ({ id, label }));
  const publicRecord = record && { schemaVersion: record.schemaVersion, hostId: record.hostId, revision: record.revision, updatedAt: record.updatedAt, configuredEnoughToProceed: record.configuredEnoughToProceed, storageRootId: record.storageRootId, databaseLocationId: record.databaseLocationId, ...(record.javaRuntimeId ? { javaRuntimeId: record.javaRuntimeId } : {}), ...(record.bedrockRuntimeId ? { bedrockRuntimeId: record.bedrockRuntimeId } : {}), javaPort: record.javaPort, bedrockPort: record.bedrockPort };
  return { schemaVersion: 1, hostId: "local", revision: record?.revision ?? 0, catalogDigest: catalog.digest,
    ...(publicRecord ? { record: publicRecord } : {}), choices: { storage: safe(catalog.storage), databases: safe(catalog.databases), java: safe(catalog.java), bedrock: safe(catalog.bedrock) }, defaults: catalog.defaults, onboardingComplete: false };
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const fields = (value: unknown, allowed: string[]) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const reference = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
export function parseSetupConfiguration(body: unknown): { settings: SetupSettings; expectedRevision: number; catalogDigest: string } {
  if (!fields(body, ["schemaVersion", "expectedRevision", "catalogDigest", "approved", "storage", "database", "java", "bedrock", "ports"]) || !object(body) || body.schemaVersion !== 1 || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || typeof body.catalogDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.catalogDigest) || !fields(body.storage, ["rootId"]) || !reference(body.storage.rootId) || !fields(body.database, ["locationId"]) || !reference(body.database.locationId) || !fields(body.ports, ["java", "bedrock"]) || ![body.ports.java, body.ports.bedrock].every(port => Number.isInteger(port) && port >= 1 && port <= 65535) || [body.java, body.bedrock].some(runtime => runtime !== undefined && (!fields(runtime, ["runtimeId"]) || !reference(runtime.runtimeId)))) throw new SetupConfigurationError("INVALID_CONFIGURATION");
  if (body.approved !== true) throw new SetupConfigurationError("APPROVAL_REQUIRED");
  return { expectedRevision: body.expectedRevision, catalogDigest: body.catalogDigest, settings: { storageRootId: body.storage.rootId, databaseLocationId: body.database.locationId, ...(body.java ? { javaRuntimeId: body.java.runtimeId } : {}), ...(body.bedrock ? { bedrockRuntimeId: body.bedrock.runtimeId } : {}), javaPort: body.ports.java, bedrockPort: body.ports.bedrock } };
}
export interface SetupConfigurationProbes {
  storage(location: string): Promise<StorageObservation>;
  database(location: string): Promise<{ exists: boolean; readable: boolean; formatValid: boolean; locationAccess: string }>;
  fileHash(location: string): Promise<string>;
  host(): Promise<HostObservation>;
}
export async function validateSetupConfiguration(settings: SetupSettings, catalog: SetupCatalog, probes: SetupConfigurationProbes): Promise<string[]> {
  if (![settings.javaPort, settings.bedrockPort].every(port => Number.isInteger(port) && port >= 1 && port <= 65535)) throw new SetupConfigurationError("INVALID_CONFIGURATION");
  const root = catalog.storage.find(item => item.id === settings.storageRootId), database = catalog.databases.find(item => item.id === settings.databaseLocationId);
  const java = settings.javaRuntimeId && catalog.java.find(item => item.id === settings.javaRuntimeId), bedrock = settings.bedrockRuntimeId && catalog.bedrock.find(item => item.id === settings.bedrockRuntimeId);
  if (!root || !database || !java && !bedrock || settings.javaRuntimeId && !java || settings.bedrockRuntimeId && !bedrock) throw new SetupConfigurationError("INVALID_CONFIGURATION");
  try {
    const storage = await probes.storage(root.location), db = await probes.database(database.location), host = await probes.host();
    if (!storage.exists || storage.access === "denied" || storage.availableBytes < 1024n ** 3n || !db.exists || !db.readable || !db.formatValid || db.locationAccess === "denied" || host.platform !== "win32" || host.architecture !== "x64" || !host.capabilityChecksAvailable || !host.inventory.complete || !Array.isArray(host.inventory.bindings) || host.inventory.bindings.length > 32768 || !host.inventory.bindings.every(binding => binding && ["tcp", "udp"].includes(binding.transport) && isIP(binding.bindAddress) !== 0 && Number.isInteger(binding.port) && binding.port >= 1 && binding.port <= 65535)) throw new Error("UNREADY");
    for (const runtime of [java, bedrock]) if (runtime && (!/^[a-f0-9]{64}$/.test(runtime.sha256) || await probes.fileHash(runtime.location) !== runtime.sha256)) throw new Error("SOURCE_DRIFT");
    const warnings = ["WRITE_ACCESS_UNVERIFIED"];
    if (host.inventory.bindings.some(binding => binding.transport === "tcp" && binding.port === settings.javaPort)) warnings.push("JAVA_PORT_OCCUPIED");
    if (host.inventory.bindings.some(binding => binding.transport === "udp" && binding.port === settings.bedrockPort)) warnings.push("BEDROCK_PORT_OCCUPIED");
    return warnings;
  } catch { throw new SetupConfigurationError("CONFIGURATION_VALIDATION_FAILED", 422); }
}
