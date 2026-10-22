import path from "node:path";
import type { ReadinessCheck } from "../core/host-readiness";
import type { RuntimeAttachmentPolicy } from "../core/runtime-attachment";
import { requiredFilesPresent } from "../host-platform/readiness";

export async function bedrockPrerequisites(policy: RuntimeAttachmentPolicy | undefined, selected: boolean): Promise<ReadinessCheck> {
  const profiles = Object.values(policy?.managedCreate?.profiles ?? {}).filter(profile => profile.providerId === "minecraft-bedrock");
  if (!profiles.length) return { id: "bedrock.prerequisites", category: "runtime", status: selected ? "BLOCKED" : "WARNING", code: "BEDROCK_PROFILE_NOT_CONFIGURED" };
  let available = 0;
  for (const profile of profiles) {
    const bundle = profile.bundle && policy?.managedCreate?.bundles?.[profile.bundle.reference];
    const source = bundle && policy?.managedCreate?.bundleLocations?.[bundle.sourceRef];
    if (!bundle || !source || !path.isAbsolute(source) || !bundle.entrypoint || path.isAbsolute(bundle.entrypoint)) continue;
    const entrypoint = path.resolve(source, bundle.entrypoint), relative = path.relative(path.resolve(source), entrypoint);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (!Array.isArray(bundle.files) || bundle.files.length > 16384) continue;
    const locations: string[] = [entrypoint];
    for (const file of bundle.files) {
      if (!file.relativePath || path.isAbsolute(file.relativePath)) break;
      const location = path.resolve(source, file.relativePath), relative = path.relative(source, location);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) break;
      locations.push(location);
    }
    if (locations.length === bundle.files.length + 1 && await requiredFilesPresent(locations)) available++;
  }
  return { id: "bedrock.prerequisites", category: "runtime", status: available ? "PASS" : selected ? "BLOCKED" : "WARNING", code: available ? "BEDROCK_SOURCE_PATHS_AVAILABLE" : "BEDROCK_SOURCE_PATHS_MISSING", facts: { profileCount: profiles.length, availableProfileCount: available, approvalValidated: false } };
}
