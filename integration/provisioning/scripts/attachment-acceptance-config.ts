import path from "node:path";
export interface AttachmentAcceptanceConfig { kind: "java" | "bedrock"; root: string; evidence: string; serverId: string; artifact: string; java?: string; port: number; ipv6Port?: number }
export function attachmentAcceptanceConfig(kind: string | undefined, env: NodeJS.ProcessEnv): AttachmentAcceptanceConfig {
  if (kind !== "java" && kind !== "bedrock") throw new Error("Explicit java or bedrock acceptance mode required.");
  if (env.JBGH_ATTACHMENT_ACCEPTANCE_CONFIRM !== "START_STOP_EXISTING_TEST_RUNTIME") throw new Error("Explicit acceptance confirmation required.");
  const absolute = (name: string) => { const value = env[name]; if (!value || !path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error(`${name} must be an explicit absolute path.`); return path.resolve(value); };
  const root = absolute("JBGH_ATTACHMENT_RUNTIME_ROOT"); const evidence = absolute("JBGH_ATTACHMENT_EVIDENCE_DIR");
  const contains = (a: string, b: string) => { const relative = path.relative(a, b); return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
  if (contains(root, evidence) || contains(evidence, root)) throw new Error("Evidence directory and runtime must not overlap.");
  const serverId = env.JBGH_ATTACHMENT_SERVER_ID; const artifact = env.JBGH_ATTACHMENT_ARTIFACT;
  if (!serverId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(serverId)) throw new Error("Explicit safe server ID required.");
  if (!artifact || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(artifact) || artifact.includes("..")) throw new Error("Explicit safe artifact filename required.");
  const port = (name: string) => { const value = Number(env[name]); if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be an explicit port.`); return value; };
  return { kind, root, evidence, serverId, artifact, port: port("JBGH_ATTACHMENT_GAME_PORT"), ...(kind === "java" ? { java: absolute("JBGH_ATTACHMENT_JAVA_EXECUTABLE") } : { ipv6Port: port("JBGH_ATTACHMENT_IPV6_PORT") }) };
}

export async function attachmentAcceptanceEndpoint(
  config: Pick<AttachmentAcceptanceConfig, "kind" | "port">,
  readJavaProperties: () => Promise<string>,
): Promise<{ port: number; bindAddress: string }> {
  if (config.kind === "bedrock") return { port: config.port, bindAddress: "0.0.0.0" };
  const properties: Record<string, string> = Object.create(null);
  for (const raw of (await readJavaProperties()).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#!]/.test(line)) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line);
    if (!match) throw new Error("Java acceptance requires explicit key=value properties.");
    const key = match[1];
    if (key !== "server-port" && key !== "server-ip") continue;
    if (match[2].includes("\\")) throw new Error("Java acceptance requires unescaped endpoint properties.");
    properties[key] = match[2].trim();
  }
  if (!/^\d+$/.test(properties["server-port"] ?? "") || Number(properties["server-port"]) !== config.port) {
    throw new Error("Java server-port must equal JBGH_ATTACHMENT_GAME_PORT.");
  }
  return { port: config.port, bindAddress: properties["server-ip"] || "0.0.0.0" };
}
