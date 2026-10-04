import { parseProvisioningRequest } from "../core/provisioning";
import { ProviderRuntimeAttachments } from "../core/provider-runtime-attachments";
import type { RuntimeAttachmentAdapter } from "../core/runtime-attachment";

export class JavaRuntimeAttachments extends ProviderRuntimeAttachments {
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
    const endpoint = request.endpoints[0];
    const port = Number(config["server-port"] ?? "25565");
    if (request.endpoints.length !== 1 || endpoint?.transport !== "tcp" || endpoint.port.mode !== "fixed" || endpoint.port.value !== port || endpoint.bindAddress !== (config["server-ip"] || "0.0.0.0")) throw new Error("Java endpoint does not match server.properties.");
    if (config["enable-rcon"]?.toLowerCase() === "true" || config["enable-query"]?.toLowerCase() === "true") throw new Error("Attachment of auxiliary Java listeners is not supported in this slice.");
    const world = config["level-name"];
    if (!world || (request.providerOptions?.worldName !== undefined && request.providerOptions.worldName !== world)) throw new Error("An explicit compatible level-name is required.");
    return { worlds: await context.directory(world) ? [world] : [] };
  };
}
