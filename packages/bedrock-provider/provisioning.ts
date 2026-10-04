import { DescriptiveProvisioningPlanner } from "../core/provisioning-planner";
import { freezeProvisioningData } from "../core/provisioning";
import type { ProvisioningProfileAdapter, ProfileRequirements } from "../core/provisioning-profile";

export class BedrockProvisioningPlanner extends DescriptiveProvisioningPlanner {
  constructor(providerId = "minecraft-bedrock") {
    const adapter: ProvisioningProfileAdapter = {
      profile: () => freezeProvisioningData({
        providerId, version: "1", runtimeKind: "native-bds", supportedModes: ["create", "adopt"],
        defaultEndpoints: [{ id: "game", protocol: "native-bds", transport: "udp", bindAddress: "0.0.0.0", port: { mode: "fixed", value: 19132 } }],
        requiredEndpoints: [{ id: "game", protocol: "native-bds", transport: "udp" }],
        storageRequirements: ["New directory under approved root, or approved external adoption location"],
        runtimeRequirements: ["Native BDS executable matching the target operating system"],
        configurationRequirements: ["server.properties", "Explicit operator license acceptance before future apply"],
        worldIntentSupport: ["worldName: optional new-world name; no world import in this slice"],
        lifecycleCompatibility: ["server.start", "server.stop", "server.restart"],
        capabilities: { planning: true, preflight: true, apply: false },
        providerDefaults: { artifactFile: "bedrock_server.exe" },
      }),
      requirements: (request) => {
        const result: ProfileRequirements = { issues: [], artifacts: [] };
        const options = request.providerOptions ?? {};
        const allowed = ["artifactRef", "artifactFile", "worldName"];
        for (const [key, value] of Object.entries(options)) {
          if (!allowed.includes(key) || typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$/.test(value) || value.includes("..") || value.endsWith(".") || value.endsWith(" ")) {
            result.issues.push({ code: "INVALID_minecraft-bedrock_OPTION", severity: "blocking", field: `providerOptions.${key}`, message: "Unsupported option or unsafe reference/name." });
          }
        }
        if (request.storage.mode === "adopt" && options.artifactRef !== undefined) result.issues.push({ code: "UNSUPPORTED_OPTION_COMBINATION", severity: "blocking", field: "providerOptions.artifactRef", message: "Adoption inspects the existing artifact; it cannot stage another artifact." });
        if (request.storage.mode === "create" && options.artifactFile !== undefined) result.issues.push({ code: "UNSUPPORTED_OPTION_COMBINATION", severity: "blocking", field: "providerOptions.artifactFile", message: "artifactFile selects an existing adoption artifact only." });
        if (request.storage.mode === "adopt") {
          result.artifacts.push({ id: "runtime", source: "target", relativePath: String(options.artifactFile ?? "bedrock_server.exe") }, { id: "configuration", source: "target", relativePath: "server.properties" });
        } else if (typeof options.artifactRef === "string") {
          result.artifacts.push({ id: "runtime", source: "reference", reference: options.artifactRef });
        } else result.issues.push({ code: "ARTIFACT_REFERENCE_REQUIRED", severity: "blocking", field: "providerOptions.artifactRef", message: "An approved runtime artifact reference is required for create." });
        
        return result;
      },
    };
    super(providerId, "native-bds-plan-v1", "Native BDS", () => new Date(), adapter);
  }
}
