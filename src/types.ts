export type ServerType =
  | 'Paper'
  | 'Purpur'
  | 'Spigot'
  | 'Vanilla'
  | 'Fabric'
  | 'Forge'
  | 'Bedrock'
  | 'Geyser Bridge';

export type ServerStatus = 'online' | 'offline' | 'updating' | 'starting' | 'stopped';

export interface MinecraftServer {
  id: string;
  name: string;
  tagline: string;
  type: ServerType;
  version: string;
  status: ServerStatus;
  ip: string;
  port: number;
  bedrockPort?: number;
  playersOnline: number;
  maxPlayers: number;
  tps: number;
  cpuPercent: number;
  ramUsageGb: number;
  ramMaxGb: number;
  pingMs: number;
  geyserBridgeEnabled: boolean;
  pvpEnabled: boolean;
  viewDistance: number;
  simulationDistance: number;
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  motd: string;
  worldCount: number;
  pluginCount: number;
  lastBackup: string;
}

export interface Player {
  id: string;
  username: string;
  skinUuid: string;
  pingMs: number;
  world: string;
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator';
  isOp: boolean;
  joinedAt: string;
  device: 'Java (PC)' | 'Bedrock (iOS)' | 'Bedrock (Xbox)' | 'Bedrock (Switch)' | 'Bedrock (Android)';
}

export interface PluginItem {
  id: string;
  name: string;
  author: string;
  description: string;
  rating: number; // 1-5
  downloads: string;
  category: 'Security' | 'Permissions' | 'WorldEdit' | 'Economy' | 'Crossplay' | 'Optimization' | 'Fun';
  version: string;
  installedVersion?: string;
  status: 'installed' | 'update_available' | 'not_installed';
  iconUrl?: string;
  paperCompatible: boolean;
  fabricCompatible?: boolean;
}

export interface WorldItem {
  id: string;
  name: string;
  type: 'Overworld' | 'Nether' | 'The End' | 'Skyblock' | 'Adventure' | 'City' | 'Fantasy' | 'Jurassic';
  sizeMb: number;
  seed: string;
  entities: number;
  chunksLoaded: number;
  isDefault: boolean;
  thumbnail: string;
  downloadable?: boolean;
  author?: string;
  rating?: number;
}

export interface PerformanceMetric {
  time: string;
  tps: number;
  cpu: number;
  ram: number;
  players: number;
  ping: number;
}

export interface ConsoleLog {
  id: string;
  timestamp: string;
  type: 'INFO' | 'WARN' | 'ERROR' | 'CHAT' | 'ACTION';
  message: string;
  source?: string;
}

export interface BackupItem {
  id: string;
  name: string;
  timestamp: string;
  sizeMb: number;
  type: 'auto' | 'manual' | 'ai_snapshot';
  worldCount: number;
  pluginCount: number;
  status: 'completed' | 'in_progress' | 'restoring';
}

export interface Project {
  id: string;
  name: string;
  tagline: string;
  category: 'Family' | 'Education' | 'Creator' | 'Community' | 'Custom';
  icon: string;
  servers: MinecraftServer[];
  activeServerId: string;
  worlds: WorldItem[];
  plugins: PluginItem[];
  backups: BackupItem[];
  players: Player[];
  createdAt: string;
  lastUpdated: string;
}

export interface CopilotMessage {
  id: string;
  sender: 'user' | 'jb_ai';
  text: string;
  timestamp: string;
  actionExecuted?: {
    type: string;
    description: string;
    details?: any;
  };
  sources?: string[];
}
