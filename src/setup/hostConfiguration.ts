import type { ProvisioningConnection } from "../dashboard/provisioningTypes";
export interface HostSettings { storageRootId: string; databaseLocationId: string; javaRuntimeId?: string; bedrockRuntimeId?: string; javaPort: number; bedrockPort: number }
export interface HostConfigurationView {
  schemaVersion: 1; hostId: "local"; revision: number; catalogDigest: string; onboardingComplete: boolean;
  record?: HostSettings & { schemaVersion: 1; hostId: string; revision: number; updatedAt: string; configuredEnoughToProceed: true };
  choices: Record<"storage" | "databases" | "java" | "bedrock", Array<{ id: string; label: string }>>;
  defaults: { javaPort: number; bedrockPort: number };
  warnings?: string[];
}
export class HostConfigurationClientError extends Error {
  constructor(readonly code: string) { super(code === "CONFIGURATION_STALE" || code === "CATALOG_STALE" ? "Host settings changed. Reload configuration and review your choices before saving." : code === "UNAUTHENTICATED" || code === "FORBIDDEN" ? "An authorized administrator access key is required." : code === "SAVE_UNCONFIRMED" ? "GameHub could not confirm the save. Reload configuration before attempting another save." : "Host configuration could not be validated. Your choices have been kept; reload or ask your administrator."); }
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const port = (v: unknown) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 65535;
export function validHostSettings(settings: HostSettings | undefined, view: HostConfigurationView | undefined): boolean {
  return !!settings && !!view && port(settings.javaPort) && port(settings.bedrockPort) && view.choices.storage.some(c => c.id === settings.storageRootId) && view.choices.databases.some(c => c.id === settings.databaseLocationId) && !!(settings.javaRuntimeId || settings.bedrockRuntimeId) && (!settings.javaRuntimeId || view.choices.java.some(c => c.id === settings.javaRuntimeId)) && (!settings.bedrockRuntimeId || view.choices.bedrock.some(c => c.id === settings.bedrockRuntimeId));
}
export function parseHostConfiguration(value: unknown): HostConfigurationView {
  if (object(value) && value.warnings !== undefined && (!Array.isArray(value.warnings) || !value.warnings.every(code => ["WRITE_ACCESS_UNVERIFIED", "JAVA_PORT_OCCUPIED", "BEDROCK_PORT_OCCUPIED"].includes(code)))) throw new HostConfigurationClientError("INVALID_RESPONSE");
  if (!object(value) || value.schemaVersion !== 1 || value.hostId !== "local" || typeof value.onboardingComplete !== "boolean" || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.catalogDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.catalogDigest) || !object(value.choices) || !["storage", "databases", "java", "bedrock"].every(key => Array.isArray(value.choices[key]) && value.choices[key].length <= 64 && value.choices[key].every((choice: any) => object(choice) && id(choice.id) && typeof choice.label === "string" && choice.label.length > 0 && choice.label.length <= 120 && !/[\\/]/.test(choice.label)) && new Set(value.choices[key].map((c: any) => c.id)).size === value.choices[key].length) || !object(value.defaults) || !port(value.defaults.javaPort) || !port(value.defaults.bedrockPort)) throw new HostConfigurationClientError("INVALID_RESPONSE");
  const record = value.record;
  if (value.revision === 0 ? record !== undefined : !object(record) || record.schemaVersion !== 1 || record.hostId !== "local" || record.revision !== value.revision || record.configuredEnoughToProceed !== true || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt)) || !id(record.storageRootId) || !id(record.databaseLocationId) || record.javaRuntimeId !== undefined && !id(record.javaRuntimeId) || record.bedrockRuntimeId !== undefined && !id(record.bedrockRuntimeId) || !port(record.javaPort) || !port(record.bedrockPort)) throw new HostConfigurationClientError("INVALID_RESPONSE");
  return value as HostConfigurationView;
}
export function hostSettingsFromView(view: HostConfigurationView): HostSettings {
  const record = view.record;
  return { storageRootId: record?.storageRootId ?? view.choices.storage[0]?.id ?? "", databaseLocationId: record?.databaseLocationId ?? view.choices.databases[0]?.id ?? "", javaRuntimeId: record?.javaRuntimeId ?? (record ? undefined : view.choices.java[0]?.id), bedrockRuntimeId: record?.bedrockRuntimeId,
    javaPort: record?.javaPort ?? view.defaults.javaPort, bedrockPort: record?.bedrockPort ?? view.defaults.bedrockPort };
}
async function request(connection: ProvisioningConnection, body?: unknown): Promise<any> {
  let response: Response;
  try { response = await fetch("/api/setup/configuration", { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + connection.token, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: connection.signal }); }
  catch { throw new HostConfigurationClientError(body ? "SAVE_UNCONFIRMED" : "NETWORK_ERROR"); }
  let value: any; try { value = await response.json(); } catch { throw new HostConfigurationClientError(body ? "SAVE_UNCONFIRMED" : "INVALID_RESPONSE"); }
  if (!response.ok) throw new HostConfigurationClientError(response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : response.status === 409 && ["CONFIGURATION_STALE", "CATALOG_STALE"].includes(value?.error?.code) ? value.error.code : body && response.status >= 500 ? "SAVE_UNCONFIRMED" : "INVALID_CONFIGURATION");
  return value;
}
export async function getHostConfiguration(connection: ProvisioningConnection): Promise<HostConfigurationView> { return parseHostConfiguration(await request(connection)); }
export async function saveHostConfiguration(settings: HostSettings, view: HostConfigurationView, connection: ProvisioningConnection): Promise<HostConfigurationView> {
  if (!validHostSettings(settings, view)) throw new HostConfigurationClientError("INVALID_CONFIGURATION");
  const value = await request(connection, { schemaVersion: 1, expectedRevision: view.revision, catalogDigest: view.catalogDigest, approved: true, storage: { rootId: settings.storageRootId }, database: { locationId: settings.databaseLocationId }, ...(settings.javaRuntimeId ? { java: { runtimeId: settings.javaRuntimeId } } : {}), ...(settings.bedrockRuntimeId ? { bedrock: { runtimeId: settings.bedrockRuntimeId } } : {}), ports: { java: settings.javaPort, bedrock: settings.bedrockPort } });
  try {
    const saved = parseHostConfiguration(value);
    if (!saved.record || saved.catalogDigest !== view.catalogDigest || ![view.revision, view.revision + 1].includes(saved.revision) || !Object.entries(settings).every(([key, expected]) => saved.record![key as keyof typeof saved.record] === expected) || saved.record.javaRuntimeId !== settings.javaRuntimeId || saved.record.bedrockRuntimeId !== settings.bedrockRuntimeId) throw new Error();
    return saved;
  } catch { throw new HostConfigurationClientError("SAVE_UNCONFIRMED"); }
}
