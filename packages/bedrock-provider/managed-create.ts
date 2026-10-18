import type { ManagedCreationAdapter, ApprovedRuntimeBundle } from "../core/managed-create";
import { managedFailure, safeLeaf } from "../core/managed-filesystem";

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
  runtimeFileValidator: ManagedCreationAdapter["runtimeFileValidator"] = (file) => {
    if (file.content === undefined) return undefined;
    if (file.name === "configuration" && file.relativePath === "server.properties") {
      const expected = properties(Buffer.from(file.content));
      const defaults = file.validationPolicy as Record<string, string> | undefined;
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
