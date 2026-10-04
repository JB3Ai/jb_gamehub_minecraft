import { parseProvisioningRequest } from "../core/provisioning";
import { ProviderRuntimeAttachments } from "../core/provider-runtime-attachments";
import type { RuntimeAttachmentAdapter } from "../core/runtime-attachment";

export class BedrockRuntimeAttachments extends ProviderRuntimeAttachments {
  inspect: RuntimeAttachmentAdapter["inspect"] = async (plan, context) => {
    const request = parseProvisioningRequest(plan.request);
    const config: Record<string, string> = Object.create(null);
    for (const raw of (await context.readText("server.properties")).split(/\r?\n/)) {
      const line = raw.trim(); if (!line || /^[#!]/.test(line)) continue;
      const match = /^([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line);
      if (!match || line.includes("\\")) throw new Error("Attachment supports explicit, unescaped key=value properties only.");
      config[match[1]] = match[2].trim();
    }
    for (const key of ["server-port", "server-portv6"]) if (config[key] !== undefined && !/^\d+$/.test(config[key])) throw new Error("Invalid configured endpoint port.");
    const ports = [["0.0.0.0", Number(config["server-port"] ?? "19132")], ["::", Number(config["server-portv6"] ?? "19133")]] as const;
    if (request.endpoints.length !== ports.length || !ports.every(([address, port]) => request.endpoints.some((endpoint) => endpoint.transport === "udp" && endpoint.bindAddress === address && endpoint.port.mode === "fixed" && endpoint.port.value === port))) throw new Error("Bedrock IPv4/IPv6 endpoints do not match server.properties.");
    const world = config["level-name"];
    if (!world || (request.providerOptions?.worldName !== undefined && request.providerOptions.worldName !== world)) throw new Error("An explicit compatible level-name is required.");
    const relative = `worlds/${world}`;
    return { worlds: await context.directory(relative) ? [relative] : [] };
  };
}
