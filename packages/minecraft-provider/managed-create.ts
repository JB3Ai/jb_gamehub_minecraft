import { isIP } from "node:net";
import type { ManagedCreationAdapter } from "../core/managed-create";
import { managedFailure, safeLeaf } from "../core/managed-filesystem";

const protectedProperties = ["server-port", "server-ip", "level-name", "enable-rcon", "enable-query"] as const;

function activeProperties(bytes: Uint8Array): Map<string, string> {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { managedFailure("ARTIFACT_DRIFT"); }
  const properties = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    if (/^[ \t\f]*(?:[#!]|$)/.test(raw)) continue;
    const match = /^[ \t\f]*([A-Za-z0-9_.-]+)[ \t\f]*=[ \t\f]*(.*)$/.exec(raw);
    if (!match || properties.has(match[1])) managedFailure("ARTIFACT_DRIFT");
    // A continuation can consume the following protected key; unsupported syntax fails closed.
    const trailingSlashes = /\\+$/.exec(raw)?.[0].length ?? 0;
    if (trailingSlashes % 2) managedFailure("ARTIFACT_DRIFT");
    const [, key, value] = match;
    if (protectedProperties.some((property) => property === key) && value.includes("\\")) managedFailure("ARTIFACT_DRIFT");
    // Java ignores separator whitespace, but trailing value whitespace is meaningful.
    properties.set(key, value);
  }
  return properties;
}

export class JavaManagedCreation implements ManagedCreationAdapter {
  runtimeFileValidator: ManagedCreationAdapter["runtimeFileValidator"] = (file) => {
    if (file.name !== "configuration" || file.relativePath !== "server.properties" || file.content === undefined) return undefined;
    const expected = activeProperties(Buffer.from(file.content));
    if (protectedProperties.some((key) => !expected.has(key))) managedFailure("ARTIFACT_DRIFT");
    return (bytes) => {
      const actual = activeProperties(bytes);
      for (const key of protectedProperties) {
        if (!actual.has(key) || actual.get(key) !== expected.get(key)) managedFailure("ARTIFACT_DRIFT");
      }
    };
  };
  manifest: ManagedCreationAdapter["manifest"] = (request, profile, acceptance) => {
    const endpoint = request.endpoints[0], bind = profile.configuration.bindAddress;
    if (request.endpoints.length !== 1 || endpoint?.transport !== "tcp" || endpoint.protocol !== "java-paper" || endpoint.id !== "game" || endpoint.port.mode !== "fixed" || typeof bind !== "string" || isIP(bind) !== 4 || endpoint.bindAddress !== bind) managedFailure("ENDPOINT_UNSUPPORTED");
    if (profile.artifacts.length !== 1 || !profile.runtime || profile.runtime.compatibility !== "java-21" || !profile.acceptanceRef || !acceptance) managedFailure("JAVA_PROFILE_UNAVAILABLE");
    if (Object.keys(profile.configuration).some((key) => !["bindAddress", "worldName"].includes(key))) managedFailure("JAVA_PROFILE_UNAVAILABLE");
    const world = request.providerOptions?.worldName ?? profile.configuration.worldName;
    if (typeof world !== "string" || !safeLeaf(world)) managedFailure("UNSAFE_WORLD_NAME");
    return {
      worldName: world,
      externalRuntime: { name: "java-runtime", reference: profile.runtime.reference, sha256: profile.runtime.sha256 },
      files: [
        { name: "runtime", relativePath: "paper.jar", sourceRef: profile.artifacts[0].reference, sha256: profile.artifacts[0].sha256 },
        { name: "configuration", relativePath: "server.properties", content: `server-port=${endpoint.port.value}\nserver-ip=${bind}\nlevel-name=${world}\nenable-rcon=false\nenable-query=false\n` },
        { name: "license", relativePath: "eula.txt", content: "eula=true\n" },
      ],
    };
  };
}
