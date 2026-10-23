import type { ServerInventoryItem } from "./types";

export interface ConnectionAddress {
  edition: "java" | "bedrock";
  host: string;
  port: number;
  scope: "local" | "lan" | "external";
  address: string;
}

function safeHost(input: unknown): { host: string; scope: ConnectionAddress["scope"] } | undefined {
  if (typeof input !== "string" || !input || input.length > 253 || /[\s/\\<>?#@%]/.test(input)) return;
  let host = input.replace(/^\[([^\]]+)\]$/, "$1").toLowerCase();
  try {
    // URL validates IPv6 and normalizes mapped/alternate IP spellings before classification.
    const parsed = new URL(`http://${host.includes(":") ? `[${host}]` : host}`);
    if (parsed.port || parsed.username || parsed.password) return;
    host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch { return; }
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some(n => n > 255) || a === 0 || a >= 224) return;
    const scope = a === 127 ? "local" : a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 ? "lan" : "external";
    return { host, scope };
  }
  if (host.includes(":")) {
    if (host === "::" || /^ff/i.test(host) || /^fe[89ab]/i.test(host)) return;
    const mapped = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i.exec(host);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      const v4Host = safeHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      return v4Host ? { host, scope: v4Host.scope } : undefined;
    }
    return { host, scope: host === "::1" ? "local" : /^f[cd]/i.test(host) ? "lan" : "external" };
  }
  if (!host.split(".").every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) return;
  return { host, scope: host === "localhost" || host.endsWith(".localhost") ? "local" : !host.includes(".") || host.endsWith(".local") ? "lan" : "external" };
}

export function connectionAddresses(server: ServerInventoryItem): ConnectionAddress[] {
  const structured = server.connectionEndpoints;
  const endpoints = structured ?? [
    { protocol: "minecraft-java", transport: "tcp", display: server.endpoints.java },
    { protocol: "minecraft-bedrock", transport: "udp", display: server.endpoints.bedrock },
  ].filter(e => (server.providerId !== "minecraft-bedrock" || e.transport === "udp") && e.display && e.display !== "N/A").map(e => {
    const match = /^(?:\[([^\]]+)\]|([^:\s/]+)):(\d+)$/.exec(e.display!);
    return { ...e, host: match?.[1] || match?.[2], port: match ? Number(match[3]) : undefined, capabilities: undefined };
  });
  const result: ConnectionAddress[] = [];
  for (const e of endpoints.slice(0, 16)) {
    const edition = e.transport === "udp" && /bedrock|native-bds/i.test(e.protocol) ? "bedrock" : e.transport === "tcp" && /java/i.test(e.protocol) ? "java" : undefined;
    if (!edition || e.capabilities?.includes("unavailable") || e.capabilities?.length && !e.capabilities.includes("play")) continue;
    const normalized = safeHost(e.host);
    if (!normalized || !Number.isInteger(e.port) || e.port! < 1 || e.port! > 65535) continue;
    const address = edition === "java" ? `${normalized.host.includes(":") ? `[${normalized.host}]` : normalized.host}:${e.port}` : normalized.host;
    if (!result.some(r => r.edition === edition && r.host === normalized.host && r.port === e.port)) result.push({ edition, ...normalized, port: e.port!, address });
  }
  return result;
}

export function playerCountText(server: ServerInventoryItem, connected: boolean): string {
  if (server.status !== "online" || !Number.isInteger(server.players) || server.players! < 0) return "Players: —";
  return `Players: ${server.players}${connected ? "" : " (last reported)"}`;
}

export async function writeConnectionClipboard(value: string, clipboard?: Pick<Clipboard, "writeText">, secure = true): Promise<boolean> {
  if (!secure || !clipboard?.writeText) return false;
  try { await clipboard.writeText(value); return true; } catch { return false; }
}
