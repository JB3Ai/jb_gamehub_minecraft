import { isIP } from "node:net";
import type { ManagedCreationAdapter } from "../core/managed-create";
import { managedFailure, safeLeaf } from "../core/managed-filesystem";

export class JavaManagedCreation implements ManagedCreationAdapter {
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
