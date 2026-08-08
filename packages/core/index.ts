import { MinecraftProvider } from "../minecraft-provider/index";
import { InMemoryProviderManager } from "../provider-manager/index";
import { SyntheticProvider } from "../synthetic-provider/index";
import { loadRuntimeConfig, RuntimeConfig } from "./runtime-config";
import { SqlitePersistenceRepository } from "./sqlite-repository";

export interface CoreBootstrapConfig {
  minecraftServerDir?: string;
  minecraftHost?: string;
  minecraftJavaPort?: number;
  minecraftBedrockPort?: number;
  minecraftStartCommand?: string;
  minecraftStopCommand?: string;
  persistenceDbPath?: string;
  operationRetentionDays?: number;
  eventRetentionDays?: number;
  auditRetentionDays?: number;
}

export async function bootstrapCore(config: CoreBootstrapConfig = {}): Promise<InMemoryProviderManager> {
  const runtime: RuntimeConfig = {
    ...loadRuntimeConfig(process.env),
    ...(config.minecraftServerDir ? { minecraftServerDir: config.minecraftServerDir } : {}),
    ...(config.minecraftHost ? { minecraftHost: config.minecraftHost } : {}),
    ...(typeof config.minecraftJavaPort === "number" ? { minecraftJavaPort: config.minecraftJavaPort } : {}),
    ...(typeof config.minecraftBedrockPort === "number" ? { minecraftBedrockPort: config.minecraftBedrockPort } : {}),
    ...(config.minecraftStartCommand ? { minecraftStartCommand: config.minecraftStartCommand } : {}),
    ...(config.minecraftStopCommand ? { minecraftStopCommand: config.minecraftStopCommand } : {}),
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
  });

  await providerManager.register(minecraftProvider);
  const syntheticProvider = new SyntheticProvider();
  await providerManager.register(syntheticProvider);

  await providerManager.reconcileServerState();
  return providerManager;
}
