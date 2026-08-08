import { bootstrapCore } from "../packages/core/index";
import { loadRuntimeConfig, runtimeConfigDiagnostics } from "../packages/core/runtime-config";
import { ProviderDiagnostics, ValidationResult } from "../packages/provider-manager/index";

function maskSensitiveValue(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    return "<unset>";
  }

  if (/(password|secret|token|key|api)/i.test(name)) {
    return "<masked>";
  }

  return value;
}

function formatRefs(label: string, refs?: Array<{ uuid: string; version: string; source: string }>): string[] {
  const entries = refs && refs.length > 0 ? refs : [];
  if (entries.length === 0) {
    return [`${label}: none`];
  }

  return [
    `${label}:`,
    ...entries.map((ref) => `  - ${ref.uuid} @ ${ref.version} (${ref.source})`),
  ];
}

function resultFromChecks(options: {
  providerDiagnostics: ProviderDiagnostics;
  serverReachable: boolean;
  worldsCount: number;
  validation: ValidationResult;
}): "PASS" | "WARN" | "FAIL" {
  if (!options.providerDiagnostics.paperDetected && !options.providerDiagnostics.geyserDetected) {
    return "WARN";
  }

  if (!options.serverReachable) {
    return "WARN";
  }

  if (options.validation.errors.length > 0 || options.validation.invalidPacks.length > 0 || options.validation.missingPacks.length > 0) {
    return "WARN";
  }

  if (options.worldsCount === 0) {
    return "WARN";
  }

  return "PASS";
}

async function main() {
  const runtime = loadRuntimeConfig(process.env);
  const providerManager = await bootstrapCore({
    minecraftServerDir: runtime.minecraftServerDir,
    minecraftHost: runtime.minecraftHost,
    minecraftJavaPort: runtime.minecraftJavaPort,
    minecraftBedrockPort: runtime.minecraftBedrockPort,
    minecraftStartCommand: runtime.minecraftStartCommand,
    minecraftStopCommand: runtime.minecraftStopCommand,
  });

  const provider = providerManager.getProvider("minecraft");
  const providerDiagnostics = await provider.getDiagnostics();
  const server = (await providerManager.listServers())[0];

  if (!server) {
    throw new Error("Minecraft provider did not expose a server");
  }

  const status = await providerManager.getServerStatus(server.id);
  const worlds = await providerManager.getWorlds(server.id);
  const primaryWorld = worlds[0];
  const validation = primaryWorld
    ? await providerManager.validateWorld(server.id, primaryWorld.id)
    : {
        valid: false,
        missingPacks: [],
        invalidPacks: [],
        errors: [{ type: "world_not_found", message: "No worlds discovered" }],
      };

  const result = resultFromChecks({
    providerDiagnostics,
    serverReachable: status.status === "online",
    worldsCount: worlds.length,
    validation,
  });

  const bedrockEndpoint = `${runtime.minecraftHost}:${runtime.minecraftBedrockPort}`;

  const lines = [
    "GameHub Minecraft Provider Diagnostic",
    "",
    "Configuration",
    "--------------",
    `Server directory: ${runtime.minecraftServerDir}`,
    `Host: ${maskSensitiveValue("MINECRAFT_HOST", runtime.minecraftHost)}`,
    `Java port: ${maskSensitiveValue("MINECRAFT_JAVA_PORT", String(runtime.minecraftJavaPort))}`,
    `Bedrock/Geyser port: ${maskSensitiveValue("MINECRAFT_BEDROCK_PORT", String(runtime.minecraftBedrockPort))}`,
    "",
    "Provider",
    "--------------",
    `Minecraft provider: ${provider.metadata().name} (${provider.metadata().status})`,
    `Paper detected: ${providerDiagnostics.paperDetected ? "yes" : "no"}`,
    `Geyser detected: ${providerDiagnostics.geyserDetected ? "yes" : "no"}`,
    "",
    "Connectivity",
    "--------------",
    `Java TCP reachable: ${status.status === "online" ? "yes" : "no"} (${status.status})`,
    `Bedrock UDP configuration: ${bedrockEndpoint}`,
    `Server status: ${status.status}`,
    "",
    "Worlds",
    "--------------",
    `World count: ${worlds.length}`,
    `World names: ${worlds.length > 0 ? worlds.map((world) => world.name).join(", ") : "none"}`,
    "",
    "Content",
    "--------------",
    ...formatRefs("Behavior pack references", validation.behaviorPackRefs),
    ...formatRefs("Resource pack references", validation.resourcePackRefs),
    `Validation result: ${validation.valid ? "valid" : "invalid"}`,
    "",
    "Result",
    "--------------",
    result,
  ];

  for (const line of lines) {
    console.log(line);
  }
}

main().catch((err) => {
  console.error("GameHub Minecraft Provider Diagnostic failed");
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
