export interface RuntimeConfig {
  minecraftServerDir: string;
  minecraftHost: string;
  minecraftJavaPort: number;
  minecraftBedrockPort: number;
  minecraftStartCommand?: string;
  minecraftStopCommand?: string;
  persistenceDbPath: string;
  operationRetentionDays: number;
  eventRetentionDays: number;
  auditRetentionDays: number;
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

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    minecraftServerDir: env.MINECRAFT_SERVER_DIR || process.cwd(),
    minecraftHost: env.MINECRAFT_HOST || "127.0.0.1",
    minecraftJavaPort: parsePort(env.MINECRAFT_JAVA_PORT, 25565, "MINECRAFT_JAVA_PORT"),
    minecraftBedrockPort: parsePort(env.MINECRAFT_BEDROCK_PORT, 19132, "MINECRAFT_BEDROCK_PORT"),
    minecraftStartCommand: env.MINECRAFT_START_COMMAND || undefined,
    minecraftStopCommand: env.MINECRAFT_STOP_COMMAND || undefined,
    persistenceDbPath: env.GAMEHUB_DB_PATH || "./data/gamehub.sqlite",
    operationRetentionDays: parsePositiveInt(env.OPERATION_RETENTION_DAYS, 90, "OPERATION_RETENTION_DAYS"),
    eventRetentionDays: parsePositiveInt(env.EVENT_RETENTION_DAYS, 30, "EVENT_RETENTION_DAYS"),
    auditRetentionDays: parsePositiveInt(env.AUDIT_RETENTION_DAYS, 365, "AUDIT_RETENTION_DAYS"),
  };
}

export function runtimeConfigDiagnostics(config: RuntimeConfig): string[] {
  return [
    `MINECRAFT_SERVER_DIR=${config.minecraftServerDir}`,
    `MINECRAFT_HOST=${config.minecraftHost}`,
    `MINECRAFT_JAVA_PORT=${config.minecraftJavaPort}`,
    `MINECRAFT_BEDROCK_PORT=${config.minecraftBedrockPort}`,
    `MINECRAFT_START_COMMAND=${config.minecraftStartCommand ? "configured" : "not_configured"}`,
    `MINECRAFT_STOP_COMMAND=${config.minecraftStopCommand ? "configured" : "not_configured"}`,
    `GAMEHUB_DB_PATH=${config.persistenceDbPath}`,
    `OPERATION_RETENTION_DAYS=${config.operationRetentionDays}`,
    `EVENT_RETENTION_DAYS=${config.eventRetentionDays}`,
    `AUDIT_RETENTION_DAYS=${config.auditRetentionDays}`,
  ];
}
