import type { IncomingMessage } from "node:http";

/** Upgrade headers only: never accept a credential in the URL or echo it as a protocol. */
export function websocketAuthorization(request: IncomingMessage): string | undefined {
  const origin = request.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== request.headers.host) return undefined; }
    catch { return undefined; }
  }
  // Existing header-authenticated clients keep their current authentication behavior.
  if (request.headers.authorization !== undefined) return request.headers.authorization;
  const raw = request.headers["sec-websocket-protocol"];
  if (typeof raw !== "string" || raw.length > 5600) return undefined;
  const protocols = raw.split(",").map(value => value.trim());
  if (protocols.length !== 2 || !protocols.includes("jbgh-admin")) return undefined;
  const encoded = protocols.find(value => value.startsWith("jbgh-auth."))?.slice("jbgh-auth.".length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (!bytes.length || bytes.length > 4096 || bytes.toString("base64url") !== encoded) return undefined;
    const key = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\r\n\u0000]/.test(key)) return undefined;
    return "Bearer " + key;
  } catch { return undefined; }
}

export function websocketProtocol(protocols: Set<string>): string | false {
  if (protocols.has("jbgh-admin")) return "jbgh-admin";
  return [...protocols].find(value => !value.startsWith("jbgh-auth.")) ?? false;
}
