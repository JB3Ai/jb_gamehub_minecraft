import { scopeRuntimeProvider } from "../provider-manager/scoped-runtime-provider";
import { createAttachedJavaRuntime } from "../minecraft-provider/attached-runtime";
import { createAttachedBedrockRuntime } from "../bedrock-provider/attached-runtime";
import { MinecraftProvider } from "../minecraft-provider/index";
import { BedrockProvider } from "../bedrock-provider/index";
import { InMemoryProviderManager } from "../provider-manager/index";
import { SyntheticProvider } from "../synthetic-provider/index";
import { FamilyService } from "./family-service";
import { evaluateParentalPolicy } from "./family-policy";
import { loadRuntimeConfig, RuntimeConfig } from "./runtime-config";
import { SqlitePersistenceRepository } from "./sqlite-repository";
import { EntitlementResolver, resolveEntitlements } from "./rewards";

export { FamilyService, evaluateParentalPolicy, EntitlementResolver, resolveEntitlements };

export interface CoreBootstrapConfig {
  minecraftServerDir?: string;
  bedrockServerDir?: string;
  bedrockStartCommand?: string;
  bedrockStopCommand?: string;
  minecraftHost?: string;
  minecraftJavaPort?: number;
  minecraftBedrockPort?: number;
  minecraftStartCommand?: string;
  minecraftStopCommand?: string;
  minecraftRconPort?: number;
  minecraftRconPassword?: string;
  persistenceDbPath?: string;
  operationRetentionDays?: number;
  eventRetentionDays?: number;
  auditRetentionDays?: number;
}

export async function bootstrapCore(config: CoreBootstrapConfig = {}): Promise<InMemoryProviderManager> {
  const runtime: RuntimeConfig = {
    ...loadRuntimeConfig(process.env),
    ...(config.minecraftServerDir ? { minecraftServerDir: config.minecraftServerDir } : {}),
    ...(config.bedrockServerDir ? { bedrockServerDir: config.bedrockServerDir } : {}),
    ...(config.bedrockStartCommand ? { bedrockStartCommand: config.bedrockStartCommand } : {}),
    ...(config.bedrockStopCommand ? { bedrockStopCommand: config.bedrockStopCommand } : {}),
    ...(config.minecraftHost ? { minecraftHost: config.minecraftHost } : {}),
    ...(typeof config.minecraftJavaPort === "number" ? { minecraftJavaPort: config.minecraftJavaPort } : {}),
    ...(typeof config.minecraftBedrockPort === "number" ? { minecraftBedrockPort: config.minecraftBedrockPort } : {}),
    ...(config.minecraftStartCommand ? { minecraftStartCommand: config.minecraftStartCommand } : {}),
    ...(config.minecraftStopCommand ? { minecraftStopCommand: config.minecraftStopCommand } : {}),
    ...(typeof config.minecraftRconPort === "number" ? { minecraftRconPort: config.minecraftRconPort } : {}),
    ...(config.minecraftRconPassword ? { minecraftRconPassword: config.minecraftRconPassword } : {}),
    ...(config.persistenceDbPath ? { persistenceDbPath: config.persistenceDbPath } : {}),
    ...(typeof config.operationRetentionDays === "number" ? { operationRetentionDays: config.operationRetentionDays } : {}),
    ...(typeof config.eventRetentionDays === "number" ? { eventRetentionDays: config.eventRetentionDays } : {}),
    ...(typeof config.auditRetentionDays === "number" ? { auditRetentionDays: config.auditRetentionDays } : {}),
  };

  const repository = new SqlitePersistenceRepository({
    filePath: runtime.persistenceDbPath,
  });

  const providerManager = new InMemoryProviderManager({
    repository,
    defaultActor: "local-admin",
  });
  await providerManager.initialize();

  const minecraftProvider = new MinecraftProvider({
    serverDir: runtime.minecraftServerDir,
    host: runtime.minecraftHost,
    javaPort: runtime.minecraftJavaPort,
    bedrockPort: runtime.minecraftBedrockPort,
    startCommand: runtime.minecraftStartCommand,
    stopCommand: runtime.minecraftStopCommand,
    rconPort: runtime.minecraftRconPort,
    rconPassword: runtime.minecraftRconPassword,
  });

  await providerManager.register(scopeRuntimeProvider(minecraftProvider, createAttachedJavaRuntime));
  const bedrockProvider = new BedrockProvider({
    serverDir: runtime.bedrockServerDir,
    host: runtime.minecraftHost,
    port: runtime.minecraftBedrockPort,
    startCommand: runtime.bedrockStartCommand,
    stopCommand: runtime.bedrockStopCommand,
  });
  await providerManager.register(scopeRuntimeProvider(bedrockProvider, createAttachedBedrockRuntime));
  const syntheticProvider = new SyntheticProvider();
  await providerManager.register(syntheticProvider);

  await providerManager.reconcileServerState();
  return providerManager;
}
