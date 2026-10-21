import path from "node:path";
import type { ProvisioningApiOptions } from "../../../packages/core/provisioning-api";
import type { ServerProvisioningRequest } from "../../../packages/core/provisioning";
import { creationHash } from "../../../packages/core/managed-create";

/** Review data only. No filesystem, policy mutation, operator consent or execution. */
export function buildSetupWizardDrafts(source: ProvisioningApiOptions["policies"]) {
  const policies: ProvisioningApiOptions["policies"] = {};
  const proposedSetup: Record<string, NonNullable<ProvisioningApiOptions["policies"][string]["setup"]>> = {};
  const requests: ServerProvisioningRequest[] = [];
  const review: Array<Record<string, unknown>> = [];
  const choices = [
    { providerId: "minecraft", sourceProfileId: "approved", profileId: "java-023c-approved", serverId: "java-023c-live", acceptanceRef: "java-023c-license", oldServerId: "java-022g-live", label: "Java family server",
      endpoints: [{ id: "game", protocol: "java-paper", transport: "tcp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 27061 } }] },
    { providerId: "minecraft-bedrock", sourceProfileId: "bedrock-raknet-approved", profileId: "bedrock-023c-raknet-approved", serverId: "bedrock-023c-live", acceptanceRef: "bedrock-023c-license", oldServerId: "bedrock-022g-live", label: "Bedrock family server",
      endpoints: [{ id: "game-v4", protocol: "native-bds", transport: "udp", bindAddress: "0.0.0.0", port: { mode: "fixed", value: 29242 } }, { id: "game-v6", protocol: "native-bds", transport: "udp", bindAddress: "::", port: { mode: "fixed", value: 29243 } }] },
  ] as const;
  for (const choice of choices) {
    const original = source[choice.providerId], managed = original?.managedCreate;
    const prior = managed?.profiles[choice.sourceProfileId], root = original?.managedRoots.root;
    if (!original || !managed || managed.filesystem !== "local-exclusive" || !prior || prior.providerId !== choice.providerId || !root || !path.isAbsolute(root) || !prior.revision || typeof prior.configuration.worldName !== "string") throw new Error("Approved source profile/root/defaults required for " + choice.providerId);
    if (managed.profiles[choice.profileId] || managed.acceptances[choice.acceptanceRef]) throw new Error("Draft references must be fresh.");
    const profile = structuredClone(prior); profile.acceptanceRef = choice.acceptanceRef;
    const artifactLocations: Record<string, string> = {};
    for (const artifact of [...profile.artifacts, ...(profile.runtime ? [profile.runtime] : [])]) {
      if (!/^[a-f0-9]{64}$/i.test(artifact.sha256) || !original.artifactLocations[artifact.reference]) throw new Error("Pinned artifact source required.");
      artifactLocations[artifact.reference] = original.artifactLocations[artifact.reference];
    }
    const bundles = {}, bundleLocations = {};
    if (choice.providerId === "minecraft-bedrock") {
      const bundle = profile.bundle && managed.bundles?.[profile.bundle.reference];
      if (!bundle || bundle.version !== "1.26.51.1" || bundle.transport !== "raknet" || !/^[a-f0-9]{64}$/i.test(profile.bundle!.digest) || creationHash(bundle) !== profile.bundle!.digest || !managed.bundleLocations?.[bundle.sourceRef]) throw new Error("Pinned approved RakNet BDS lineage required.");
      bundles[profile.bundle!.reference] = structuredClone(bundle);
      bundleLocations[bundle.sourceRef] = managed.bundleLocations[bundle.sourceRef];
    }
    const endpoints = structuredClone(choice.endpoints) as unknown as ServerProvisioningRequest["endpoints"];
    policies[choice.providerId] = {
      hostId: original.hostId, managedRoots: { root }, artifactLocations, adoptionRoots: [], adoptionLocations: {},
      protectedPaths: [...new Set([...(original.protectedPaths ?? []), ...Object.values(original.adoptionLocations), path.join(root, choice.oldServerId)])],
      managedCreate: { filesystem: "local-exclusive", profiles: { [choice.profileId]: profile }, acceptances: {},
        ...(managed.maxArtifactBytes !== undefined ? { maxArtifactBytes: managed.maxArtifactBytes } : {}),
        ...(managed.protectedPaths ? { protectedPaths: structuredClone(managed.protectedPaths) } : {}),
        ...(profile.bundle ? { bundles, bundleLocations } : {}), endpointInventory: { complete: false, bindings: [] } },
      // Proposed defaults are separate: loading this draft keeps wizard choices unavailable.
      setup: { profiles: {} },
    };
    proposedSetup[choice.providerId] = { profiles: { [choice.profileId]: { rootId: "root", directoryName: choice.serverId, endpoints, label: choice.label } } };
    requests.push({ schemaVersion: 1, providerId: choice.providerId, serverId: choice.serverId, displayName: choice.label, hostId: original.hostId,
      storage: { mode: "create", rootId: "root", directoryName: choice.serverId }, endpoints,
      providerOptions: { profileRef: choice.profileId, worldName: profile.configuration.worldName } });
    review.push({ providerId: choice.providerId, serverId: choice.serverId, sourceProfileId: choice.sourceProfileId, profileId: choice.profileId, profileRevision: profile.revision,
      managedRootRef: "root", managedRoot: root, targetDirectoryName: choice.serverId, target: path.join(root, choice.serverId), endpoints, worldName: profile.configuration.worldName,
      acceptanceRef: choice.acceptanceRef, acceptanceRecordPresent: false,
      requiredAcceptanceScope: { hostId: original.hostId, providerId: choice.providerId, serverId: choice.serverId, profileId: choice.profileId, profileRevision: profile.revision, ...(profile.bundle ? { bundleDigest: profile.bundle.digest } : {}) },
      requiredOperatorFields: ["revision", "actor", "acceptedAt", "termsRef", "authorizeGeneratedAcceptance"],
      artifactBindings: structuredClone(profile.artifacts), ...(profile.runtime ? { runtimeBinding: structuredClone(profile.runtime) } : {}), ...(profile.bundle ? { bundleBinding: structuredClone(profile.bundle) } : {}),
      endpointInventoryComplete: false, setupDefaultsInstalled: false });
  }
  return { policies, proposedSetup, requests, review };
}
