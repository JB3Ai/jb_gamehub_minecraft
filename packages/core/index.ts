import { MinecraftProvider } from "../minecraft-provider/index";
import { InMemoryProviderManager } from "../provider-manager/index";

export interface CoreBootstrapConfig {
  minecraftServerDir?: string;
  minecraftHost?: string;
  minecraftJavaPort?: number;
  minecraftBedrockPort?: number;
  minecraftStartCommand?: string;
  minecraftStopCommand?: string;
}

export async function bootstrapCore(config: CoreBootstrapConfig = {}): Promise<InMemoryProviderManager> {
  const providerManager = new InMemoryProviderManager();

  const minecraftProvider = new MinecraftProvider({
    serverDir: config.minecraftServerDir || process.env.MINECRAFT_SERVER_DIR || process.cwd(),
    host: config.minecraftHost || process.env.MINECRAFT_HOST || "127.0.0.1",
    javaPort: config.minecraftJavaPort ?? Number(process.env.MINECRAFT_JAVA_PORT || 25565),
    bedrockPort: config.minecraftBedrockPort ?? Number(process.env.MINECRAFT_BEDROCK_PORT || 19132),
    startCommand: config.minecraftStartCommand || process.env.MINECRAFT_START_COMMAND,
    stopCommand: config.minecraftStopCommand || process.env.MINECRAFT_STOP_COMMAND,
  });

  await providerManager.register(minecraftProvider);
  return providerManager;
}
