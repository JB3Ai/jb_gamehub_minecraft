import path from "node:path";
import { BedrockProvider } from "./index";
import { ManagedBedrockRuntime } from "./managed-runtime";
import type { AttachedRuntimeFactory } from "../provider-manager/scoped-runtime-provider";

export const createAttachedBedrockRuntime: AttachedRuntimeFactory = async (record, _policy, boot) => {
  const artifact = record.descriptor.manifest.find((item) => item.name === "runtime")!;
  const endpoint = record.descriptor.endpoints.find((item) => item.transport === "udp" && item.bindAddress !== "::");
  if (!artifact.relativePath || !endpoint || endpoint.transport === "virtual" || endpoint.port.mode !== "fixed") throw new Error("Attached Bedrock runtime metadata is incomplete.");
  const executable = path.join(record.descriptor.runtimeRoot, artifact.relativePath);
  if (/["'\r\n]/.test(executable)) throw new Error("Unsupported executable path quoting.");
  const config = { providerId: record.descriptor.providerId, serverId: record.descriptor.serverId, serverDir: record.descriptor.runtimeRoot, host: endpoint.bindAddress, port: endpoint.port.value, startCommand: `"${executable}"` };
  if (record.descriptor.ownership === "MANAGED") {
    if (!boot) throw new Error("MANAGED_BOOT_CONTROL_UNAVAILABLE");
    return new ManagedBedrockRuntime(config, boot, record.descriptor.endpoints.map(item => {
      if (item.transport !== "udp" || item.port.mode !== "fixed") throw new Error("MANAGED_ENDPOINT_INVALID");
      return { host: item.bindAddress, port: item.port.value };
    }));
  }
  return new BedrockProvider(config);
};
