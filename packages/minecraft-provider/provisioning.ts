import { DescriptiveProvisioningPlanner } from "../core/provisioning-planner";
import { freezeProvisioningData } from "../core/provisioning";
import type { ProvisioningProfileAdapter, ProfileRequirements } from "../core/provisioning-profile";

export class JavaProvisioningPlanner extends DescriptiveProvisioningPlanner {
  constructor(providerId = "minecraft") {
    const adapter: ProvisioningProfileAdapter = {
      profile: () => freezeProvisioningData({
        providerId, version: "1", runtimeKind: "java-paper", supportedModes: ["create", "adopt"],
        defaultEndpoints: [{ id: "game", protocol: "java-paper", transport: "tcp", bindAddress: "0.0.0.0", port: { mode: "fixed", value: 25565 } }],
        requiredEndpoints: [{ id: "game", protocol: "java-paper", transport: "tcp" }],
        storageRequirements: ["New directory under approved root, or approved external adoption location"],
        runtimeRequirements: ["Paper artifact", "Java 21 runtime reference"],
        configurationRequirements: ["server.properties", "Explicit operator license acceptance before future apply"],
        worldIntentSupport: ["worldName: optional new-world name; no world import in this slice"],
        lifecycleCompatibility: ["server.start", "server.stop", "server.restart"],
        capabilities: { planning: true, preflight: true, apply: false },
        providerDefaults: { artifactFile: "paper.jar" },
      }),
      requirements: (request) => {
        const result: ProfileRequirements = { issues: [], artifacts: [] };
        const options = request.providerOptions ?? {};
        const allowed = ["artifactRef", "artifactFile", "worldName", "javaRuntimeRef"];
        for (const [key, value] of Object.entries(options)) {
          if (!allowed.includes(key) || typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$/.test(value) || value.includes("..") || value.endsWith(".") || value.endsWith(" ")) {
            result.issues.push({ code: "INVALID_minecraft_OPTION", severity: "blocking", field: `providerOptions.${key}`, message: "Unsupported option or unsafe reference/name." });
          }
        }
        if (request.storage.mode === "adopt" && options.artifactRef !== undefined) result.issues.push({ code: "UNSUPPORTED_OPTION_COMBINATION", severity: "blocking", field: "providerOptions.artifactRef", message: "Adoption inspects the existing artifact; it cannot stage another artifact." });
        if (request.storage.mode === "create" && options.artifactFile !== undefined) result.issues.push({ code: "UNSUPPORTED_OPTION_COMBINATION", severity: "blocking", field: "providerOptions.artifactFile", message: "artifactFile selects an existing adoption artifact only." });
        if (request.storage.mode === "adopt") {
          result.artifacts.push({ id: "runtime", source: "target", relativePath: String(options.artifactFile ?? "paper.jar") }, { id: "configuration", source: "target", relativePath: "server.properties" });
        } else if (typeof options.artifactRef === "string") {
          result.artifacts.push({ id: "runtime", source: "reference", reference: options.artifactRef });
        } else result.issues.push({ code: "ARTIFACT_REFERENCE_REQUIRED", severity: "blocking", field: "providerOptions.artifactRef", message: "An approved runtime artifact reference is required for create." });
        if (typeof options.javaRuntimeRef === "string") result.artifacts.push({ id: "java-runtime", source: "reference", reference: options.javaRuntimeRef });
        else result.issues.push({ code: "RUNTIME_REFERENCE_REQUIRED", severity: "blocking", field: "providerOptions.javaRuntimeRef", message: "An approved Java runtime executable reference is required." });
        return result;
      },
    };
    super(providerId, "java-paper-plan-v1", "Java/Paper", () => new Date(), adapter);
  }
}
