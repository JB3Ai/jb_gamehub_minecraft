import type { ManagedCreationAdapter } from "../core/managed-create";
import type { AttachedRuntimeFactory } from "../provider-manager/scoped-runtime-provider";
import { canonicalProvisioningJson } from "../core/provisioning";
import { managedFailure } from "../core/managed-filesystem";
import { SyntheticProvider } from "./index";

export class SyntheticManagedCreation implements ManagedCreationAdapter {
  manifest: ManagedCreationAdapter["manifest"] = (request, profile) => {
    if (request.endpoints.some((endpoint) => endpoint.transport !== "virtual") || profile.artifacts.length || profile.runtime || profile.acceptanceRef) managedFailure("SYNTHETIC_PROFILE_UNAVAILABLE");
    return { files: [{ name: "configuration", relativePath: "runtime.json", content: canonicalProvisioningJson({ providerId: request.providerId, configuration: profile.configuration }) + "\n" }] };
  };
}
export const createScopedSyntheticRuntime: AttachedRuntimeFactory = async (record) => new SyntheticProvider({ providerId: record.descriptor.providerId, serverId: record.descriptor.serverId });
