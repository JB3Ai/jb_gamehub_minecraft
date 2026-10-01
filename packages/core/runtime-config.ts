export interface RuntimeConfig {
  minecraftServerDir: string;
  /** Filesystem root for an explicitly configured Bedrock content adapter; not a runtime declaration. */
  bedrockContentDir?: string;
  /** Bedrock Dedicated Server installation root. Presence enables the native runtime provider. */
  bedrockServerDir?: string;
  bedrockStartCommand?: string;
  bedrockStopCommand?: string;
  minecraftHost: string;
  minecraftJavaPort: number;
  minecraftBedrockPort: number;
  minecraftStartCommand?: string;
  minecraftStopCommand?: string;
  minecraftRconPort: number;
  minecraftRconPassword?: string;
  persistenceDbPath: string;
  operationRetentionDays: number;
  eventRetentionDays: number;
  auditRetentionDays: number;
  aiProvider: "gemini" | "openai" | "fallback";
  aiModel?: string;
  geminiApiKey?: string;
  openAiApiKey?: string;
}

function parsePort(raw: string | undefined, fallback: number, label: string): number {
  const value = raw && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  const value = raw && raw.trim() !== "" ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return value;
}

function parseAiProvider(raw: string | undefined): "gemini" | "openai" | "fallback" {
  if (raw === "gemini" || raw === "openai" || raw === "fallback") {
    return raw;
  }
  return "fallback";
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    minecraftServerDir: env.MINECRAFT_SERVER_DIR || process.cwd(),
    bedrockContentDir: env.BEDROCK_CONTENT_DIR || undefined,
    bedrockServerDir: env.BEDROCK_SERVER_DIR || undefined,
    bedrockStartCommand: env.BEDROCK_START_COMMAND || undefined,
    bedrockStopCommand: env.BEDROCK_STOP_COMMAND || undefined,
    minecraftHost: env.MINECRAFT_HOST || "127.0.0.1",
    minecraftJavaPort: parsePort(env.MINECRAFT_JAVA_PORT, 25565, "MINECRAFT_JAVA_PORT"),
    minecraftBedrockPort: parsePort(env.MINECRAFT_BEDROCK_PORT, 19132, "MINECRAFT_BEDROCK_PORT"),
    minecraftStartCommand: env.MINECRAFT_START_COMMAND || undefined,
    minecraftStopCommand: env.MINECRAFT_STOP_COMMAND || undefined,
    minecraftRconPort: parsePort(env.MINECRAFT_RCON_PORT, 25575, "MINECRAFT_RCON_PORT"),
    minecraftRconPassword: env.MINECRAFT_RCON_PASSWORD || undefined,
    persistenceDbPath: env.GAMEHUB_DB_PATH || "./data/gamehub.sqlite",
    operationRetentionDays: parsePositiveInt(env.OPERATION_RETENTION_DAYS, 90, "OPERATION_RETENTION_DAYS"),
    eventRetentionDays: parsePositiveInt(env.EVENT_RETENTION_DAYS, 30, "EVENT_RETENTION_DAYS"),
    auditRetentionDays: parsePositiveInt(env.AUDIT_RETENTION_DAYS, 365, "AUDIT_RETENTION_DAYS"),
    aiProvider: parseAiProvider(env.AI_PROVIDER),
    aiModel: env.AI_MODEL || undefined,
    geminiApiKey: env.GEMINI_API_KEY && env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY" ? env.GEMINI_API_KEY : undefined,
    openAiApiKey: env.OPENAI_API_KEY || undefined,
  };
}

export function runtimeConfigDiagnostics(config: RuntimeConfig): string[] {
  return [
    `MINECRAFT_SERVER_DIR=${config.minecraftServerDir}`,
    `BEDROCK_CONTENT_DIR=${config.bedrockContentDir || "not_configured"}`,
    `BEDROCK_SERVER_DIR=${config.bedrockServerDir || "not_configured"}`,
    `BEDROCK_START_COMMAND=${config.bedrockStartCommand ? "configured" : "not_configured"}`,
    `BEDROCK_STOP_COMMAND=${config.bedrockStopCommand ? "configured" : "not_configured"}`,
    `MINECRAFT_HOST=${config.minecraftHost}`,
    `MINECRAFT_JAVA_PORT=${config.minecraftJavaPort}`,
    `MINECRAFT_BEDROCK_PORT=${config.minecraftBedrockPort}`,
    `MINECRAFT_START_COMMAND=${config.minecraftStartCommand ? "configured" : "not_configured"}`,
    `MINECRAFT_STOP_COMMAND=${config.minecraftStopCommand ? "configured" : "not_configured"}`,
    `GAMEHUB_DB_PATH=${config.persistenceDbPath}`,
    `OPERATION_RETENTION_DAYS=${config.operationRetentionDays}`,
    `EVENT_RETENTION_DAYS=${config.eventRetentionDays}`,
    `AUDIT_RETENTION_DAYS=${config.auditRetentionDays}`,
    `AI_PROVIDER=${config.aiProvider}`,
    `AI_MODEL=${config.aiModel || "provider_default"}`,
    `GEMINI_API_KEY=${config.geminiApiKey ? "configured" : "not_configured"}`,
    `OPENAI_API_KEY=${config.openAiApiKey ? "configured" : "not_configured"}`,
  ];
}
