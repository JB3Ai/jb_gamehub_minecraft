import { MinecraftProvider } from "../minecraft-provider/index";
import { InMemoryProviderManager } from "../provider-manager/index";
import { loadRuntimeConfig, RuntimeConfig } from "./runtime-config";

export interface CoreBootstrapConfig {
  minecraftServerDir?: string;
  minecraftHost?: string;
  minecraftJavaPort?: number;
  minecraftBedrockPort?: number;
  minecraftStartCommand?: string;
  minecraftStopCommand?: string;
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
  };

  const providerManager = new InMemoryProviderManager();

  const minecraftProvider = new MinecraftProvider({
    serverDir: runtime.minecraftServerDir,
    host: runtime.minecraftHost,
    javaPort: runtime.minecraftJavaPort,
    bedrockPort: runtime.minecraftBedrockPort,
    startCommand: runtime.minecraftStartCommand,
    stopCommand: runtime.minecraftStopCommand,
  });

  await providerManager.register(minecraftProvider);
  return providerManager;
}
