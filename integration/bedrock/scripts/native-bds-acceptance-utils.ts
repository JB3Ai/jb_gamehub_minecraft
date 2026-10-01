import dgram from "node:dgram";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AcceptanceStatus = "PASS" | "FAILED" | "BLOCKED";

export interface NativeBdsEvidence {
  milestone: "JBGH-021A";
  startedAt: string;
  completedAt?: string;
  status: AcceptanceStatus;
  blockerCode?: string;
  sourceBdsPath?: string;
  disposableBdsPath?: string;
  runtime?: {
    nodeVersion: string;
    bdsExecutablePath?: string;
    bdsExecutableSha256?: string;
    bdsVersion: "NOT_CAPTURED";
    gameHubCommit?: string;
  };
  providerId: "minecraft-bedrock";
  serverId: "bedrock-main";
  endpoint?: { host: string; port: number };
  world: "JBGH021AWorld";
  clientCommandConfigured: boolean;
  clientIdentity?: { xuidSha256: string; displayName?: string };
  observed: Record<string, boolean>;
  error?: string;
}

export function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function exists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export async function assertDisposableRuntime(runtimeDir: string, integrationRoot: string, marker: string): Promise<void> {
  if (!isInsideRoot(runtimeDir, integrationRoot)) {
    throw Object.assign(new Error(`Acceptance runtime must remain under ${integrationRoot}.`), { code: "BDS_ACCEPTANCE_PATH_UNSAFE" });
  }
  if (!(await exists(path.join(runtimeDir, marker)))) {
    throw Object.assign(new Error(`Refusing destructive acceptance cleanup without ${marker}.`), { code: "BDS_ACCEPTANCE_MARKER_MISSING" });
  }
}

export async function assertUdpPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const fail = (error: Error & { code?: string }) => {
      socket.close();
      reject(Object.assign(new Error(`Bedrock UDP port ${host}:${port} is unavailable: ${error.message}`), { code: "BDS_ACCEPTANCE_PORT_UNAVAILABLE" }));
    };
    socket.once("error", fail);
    socket.bind(port, host, () => socket.close(() => resolve()));
  });
}

export function deterministicServerProperties(port: number): string {
  return [
    "server-name=JB3 GameHub BDS Acceptance",
    "gamemode=creative",
    "difficulty=peaceful",
    "allow-cheats=true",
    "online-mode=true",
    `server-port=${port}`,
    "server-portv6=0",
    "level-name=JBGH021AWorld",
    "view-distance=6",
    "max-players=4",
    "allow-list=false",
    "default-player-permission-level=visitor",
    "content-log-console-output-enabled=true",
  ].join("\n") + "\n";
}

export function safeXuidReference(xuid: string): string {
  return createHash("sha256").update(xuid).digest("hex");
}
