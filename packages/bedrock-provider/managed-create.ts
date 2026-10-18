import type { ManagedCreationAdapter, ApprovedRuntimeBundle } from "../core/managed-create";
import { managedFailure, safeLeaf } from "../core/managed-filesystem";
import fs from "node:fs";
import { hashFile, sameIdentity } from "../core/managed-filesystem";
import type { ManagedCreatePreview, ResolvedRuntimeBundle } from "../core/managed-create";
import type { ProvisioningJson } from "../core/provisioning";

/** This compatibility boundary is deliberately build-specific; never resolve 'latest'. */
export const managedBedrockCompatibility = Object.freeze({ version: "1.26.51.1", platform: "win32", architecture: "x64", transport: "raknet", policy: "bds-1.26.51.1-raknet-v1" });
const configurationNames = ["server.properties", "allowlist.json", "permissions.json"];
const additionalKeys = new Set(["gamemode", "force-gamemode", "difficulty", "max-players", "view-distance", "tick-distance", "player-idle-timeout", "max-threads", "level-seed", "texturepack-required"]);

function text(bytes: Uint8Array): string {
  try {
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (value.startsWith("\ufeff") || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(value)) managedFailure("ARTIFACT_DRIFT");
    return value;
  } catch { managedFailure("ARTIFACT_DRIFT"); }
}
function properties(bytes: Uint8Array): Map<string, string> {
  const result = new Map<string, string>();
  for (const raw of text(bytes).split(/\r?\n/)) {
    if (/^[ \t\f]*(?:[#!]|$)/.test(raw)) continue;
    const match = /^[ \t\f]*([A-Za-z0-9_.-]+)[ \t\f]*=[ \t\f]*([^\r\n]*)$/.exec(raw);
    if (!match || raw.includes("\\") || result.has(match[1])) managedFailure("ARTIFACT_DRIFT");
    result.set(match[1], match[2]);
  }
  return result;
}
function validateBundle(bundle: Readonly<ApprovedRuntimeBundle> | undefined): asserts bundle is Readonly<ApprovedRuntimeBundle> {
  const pin = managedBedrockCompatibility;
  if (!bundle || bundle.runtimeKind !== "native-bds" || bundle.platform !== pin.platform || bundle.architecture !== pin.architecture || bundle.version !== pin.version || bundle.transport !== pin.transport || bundle.entrypoint !== "bedrock_server.exe" || !Array.isArray(bundle.files)) managedFailure("BEDROCK_PROFILE_UNAVAILABLE");
  // Templates may be approved/read, but installed policy, player data and runtime state are never copied.
  const forbidden = /^(?:worlds|logs|log|crash_dumps|captures|stats|development_behavior_packs|development_resource_packs|development_skin_packs)(?:\/|$)/i;
  for (const file of bundle.files) {
    if (forbidden.test(file.relativePath) || /^(?:\.jbgh-|eula\.txt$|whitelist\.json$)/i.test(file.relativePath)) managedFailure("INVALID_BUNDLE");
    if (configurationNames.includes(file.relativePath.toLowerCase())) {
      if (!configurationNames.includes(file.relativePath) || file.classification !== "protected-config") managedFailure("INVALID_BUNDLE");
    } else if (file.classification !== "immutable-runtime") managedFailure("INVALID_BUNDLE");
  }
  if (bundle.directories?.some((directory) => forbidden.test(directory))) managedFailure("INVALID_BUNDLE");
  // G-C1 records possible output roles, but grants none: no durable boot authorization exists yet.
  if (bundle.runtimeOutputs?.some((output) => output.relativePath !== "worlds" || output.kind !== "directory")) managedFailure("INVALID_BUNDLE");
  if (!bundle.files.some((file) => file.relativePath === "bedrock_server_how_to.html" && file.classification === "immutable-runtime")) managedFailure("BEDROCK_PROFILE_UNAVAILABLE");
}

export class BedrockManagedCreation implements ManagedCreationAdapter {
  readonly lifecycleDeferred = true;
  bootPolicy(preview: Readonly<ManagedCreatePreview>, bundle?: Readonly<ResolvedRuntimeBundle>): ProvisioningJson {
    validateBundle(bundle?.manifest);
    if (!preview.worldName || !safeLeaf(preview.worldName) || bundle!.manifestDigest !== preview.bundle?.manifestDigest) managedFailure("BOOT_POLICY_UNAVAILABLE");
    const template = bundle!.files.find(file => file.relativePath === "server.properties");
    const generated = preview.files.find(file => file.name === "configuration");
    if (!template?.sourcePath || !template.sourceIdentity || !generated?.content || template.size > 64 * 1024) managedFailure("BOOT_POLICY_UNAVAILABLE");
    const observed = hashFile(template.sourcePath, 64 * 1024);
    if (observed.sha256 !== template.sha256 || !sameIdentity(observed.identity, template.sourceIdentity)) managedFailure("ARTIFACT_DRIFT");
    const protectedKeys = properties(Buffer.from(generated.content));
    const defaults = Object.fromEntries([...properties(fs.readFileSync(template.sourcePath))].filter(([key]) => !protectedKeys.has(key)));
    return { schemaVersion: 1, id: "bds-1.26.51.1-managed-boot-v1", bundleVersion: managedBedrockCompatibility.version,
      transport: "raknet", worldName: preview.worldName, endpoints: preview.plan.request.endpoints as unknown as ProvisioningJson,
      configurationTemplateHash: template.sha256, configurationDefaults: { ...defaults, ...(generated.validationPolicy as Record<string, string> ?? {}) },
      outputs: ["selected-world-level-metadata", "selected-world-leveldb", "packet-statistics.txt", "empty-development_behavior_packs", "empty-development_resource_packs", "empty-development_skin_packs"],
      maxEntries: 10000, maxTotalBytes: 512 * 1024 * 1024, maxWorldFileBytes: 64 * 1024 * 1024 };
  }
  runtimeOutputPolicy: ManagedCreationAdapter["runtimeOutputPolicy"] = (preview, value) => {
    const policy = value as { id?: string; worldName?: string };
    if (policy.id !== "bds-1.26.51.1-managed-boot-v1" || policy.worldName !== preview.worldName || !preview.worldName) managedFailure("BOOT_POLICY_UNAVAILABLE");
    const world = "worlds/" + preview.worldName;
    return { maxEntries: 10000, maxTotalBytes: 512 * 1024 * 1024, allows: (relative, kind, size) => {
      if (relative.split("/").length > 4 || size > 64 * 1024 * 1024) return false;
      if (kind === "directory") return ["worlds", world, world + "/db", "development_behavior_packs", "development_resource_packs", "development_skin_packs"].includes(relative);
      if (relative === "packet-statistics.txt") return size <= 1024 * 1024;
      if (["level.dat", "level.dat_old", "levelname.txt"].some(name => relative === world + "/" + name)) return true;
      if (!relative.startsWith(world + "/db/")) return false;
      return /^(?:CURRENT|LOCK|LOG|LOG\.old|MANIFEST-[0-9]{6,20}|[0-9]{6,20}\.(?:ldb|sst|log|dbtmp))$/.test(relative.slice((world + "/db/").length));
    } };
  };
  runtimeFileValidator: ManagedCreationAdapter["runtimeFileValidator"] = (file, bootPolicy) => {
    if (file.content === undefined) return undefined;
    if (file.name === "configuration" && file.relativePath === "server.properties") {
      const expected = properties(Buffer.from(file.content));
      const defaults = { ...((bootPolicy as { configurationDefaults?: Record<string, string> } | undefined)?.configurationDefaults ?? {}), ...(file.validationPolicy as Record<string, string> ?? {}) };
      return (bytes) => {
        const actual = properties(bytes);
        for (const [key, value] of expected) if (!actual.has(key) || actual.get(key) !== value) managedFailure("ARTIFACT_DRIFT");
        for (const [key, value] of actual) if (!expected.has(key) && (!defaults || !Object.hasOwn(defaults, key) || defaults[key] !== value)) managedFailure("ARTIFACT_DRIFT");
      };
    }
    if (["allowlist", "permissions"].includes(file.name) && configurationNames.includes(file.relativePath)) return (bytes) => {
      let value: unknown;
      try { value = JSON.parse(text(bytes)); } catch { managedFailure("ARTIFACT_DRIFT"); }
      if (!Array.isArray(value) || value.length !== 0) managedFailure("ARTIFACT_DRIFT");
    };
    return undefined;
  };
  manifest: ManagedCreationAdapter["manifest"] = (request, profile, acceptance, bundle) => {
    validateBundle(bundle);
    const config = profile.configuration, pin = managedBedrockCompatibility;
    if (profile.providerId !== "minecraft-bedrock" || profile.revision !== "1" || profile.artifacts.length || profile.runtime || !profile.bundle || config.compatibility !== pin.policy || config.transport !== pin.transport || config.bundleVersion !== pin.version || config.runtimeKind !== "native-bds" || Object.keys(config).some((key) => !["runtimeKind", "compatibility", "transport", "bundleVersion", "worldName", "additionalDefaults"].includes(key))) managedFailure("BEDROCK_PROFILE_UNAVAILABLE");
    if (!profile.acceptanceRef || !acceptance || acceptance.providerId !== request.providerId || acceptance.bundleDigest !== profile.bundle.digest || acceptance.serverId !== request.serverId || Date.parse(acceptance.acceptedAt) > Date.now() || /<|>|REAL_OPERATOR|ISO-8601_ACCEPTANCE_TIMESTAMP|REAL_EULA_TERMS_REFERENCE/.test([acceptance.actor, acceptance.termsRef].join(" "))) managedFailure("LICENSE_ACCEPTANCE_REQUIRED");
    const v4 = request.endpoints.find((endpoint) => endpoint.id === "game-v4"), v6 = request.endpoints.find((endpoint) => endpoint.id === "game-v6");
    if (request.endpoints.length !== 2 || !v4 || !v6 || v4.transport !== "udp" || v6.transport !== "udp" || v4.protocol !== "native-bds" || v6.protocol !== "native-bds" || v4.bindAddress !== "0.0.0.0" || v6.bindAddress !== "::" || v4.port.mode !== "fixed" || v6.port.mode !== "fixed" || v4.port.value === v6.port.value) managedFailure("ENDPOINT_UNSUPPORTED");
    const world = request.providerOptions?.worldName ?? config.worldName;
    if (typeof world !== "string" || !safeLeaf(world)) managedFailure("UNSAFE_WORLD_NAME");
    const defaults = config.additionalDefaults ?? {};
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults) || Object.entries(defaults).some(([key, value]) => !additionalKeys.has(key) || typeof value !== "string" || /[\\\r\n\u0000]/.test(value))) managedFailure("BEDROCK_PROFILE_UNAVAILABLE");
    return { bundle: profile.bundle, worldName: world, files: [
      { name: "configuration", relativePath: "server.properties", validationPolicy: defaults, content:
        `server-name=JB3 Bedrock Managed\ntransport=raknet\nserver-port=${v4.port.value}\nserver-portv6=${v6.port.value}\nlevel-name=${world}\nonline-mode=true\nallow-list=true\nallow-cheats=false\ndefault-player-permission-level=member\nenable-lan-visibility=false\nallow-inbound-script-debugging=false\nallow-outbound-script-debugging=false\nscript-debugger-auto-attach=disabled\n` },
      { name: "allowlist", relativePath: "allowlist.json", content: "[]\n" },
      { name: "permissions", relativePath: "permissions.json", content: "[]\n" },
    ] };
  };
}
