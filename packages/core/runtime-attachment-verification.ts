import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { freezeProvisioningData, parseProvisioningRequest, type ProvisioningPlanner, type ServerProvisioningPlan } from "./provisioning";
import { preflightProvisioning } from "./provisioning-preflight";
import { ProvisioningApplyException } from "./provisioning-apply-contracts";
import { attachmentDigest, type RuntimeArtifact, type RuntimeAttachmentAdapter, type RuntimeAttachmentPolicy, type RuntimeAttachmentPreview } from "./runtime-attachment";

export const pathContains = (root: string, target: string) => { const relative = path.relative(root, target); return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
const fail = (message: string): never => { throw new ProvisioningApplyException({ code: "ATTACHMENT_VERIFICATION_FAILED", message }); };
/** Reject traversal and every existing symlink/junction component before canonicalizing. */
export async function canonicalAttachmentPath(value: string): Promise<string> {
  if (!path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) return fail("Policy path must be absolute without traversal.");
  const absolute = path.resolve(value); const root = path.parse(absolute).root; let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) return fail("Symlinks and junctions are not approved.");
  }
  return fs.realpath(absolute);
}
function relativeTarget(root: string, relative: string) {
  if (!relative || path.isAbsolute(relative) || relative.includes(":") || relative.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" "))) return fail("Unsafe artifact/world relative path.");
  const target = path.resolve(root, relative);
  if (!pathContains(root, target) || target === root) return fail("Artifact escapes runtime root.");
  return target;
}
async function fileManifest(location: string, artifact: Omit<RuntimeArtifact, "size" | "observedHash" | "verification">): Promise<RuntimeArtifact> {
  const canonical = await canonicalAttachmentPath(location);
  const handle = await fs.open(canonical, "r");
  try {
    const before = await handle.stat(); if (!before.isFile()) return fail(`Artifact '${artifact.name}' is not a regular file.`);
    const hash = createHash("sha256"); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat(); const current = await fs.lstat(location);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || current.isSymbolicLink() || before.ino !== current.ino || before.dev !== current.dev) return fail("Artifact changed during verification.");
    const observedHash = hash.digest("hex");
    if (artifact.expectedHash && artifact.expectedHash.toLowerCase() !== observedHash) return fail(`Hash mismatch for '${artifact.name}'.`);
    return { ...artifact, observedHash, size: before.size, verification: "verified" };
  } finally { await handle.close(); }
}
export async function verifyRuntimeAttachment(plan: ServerProvisioningPlan, planner: ProvisioningPlanner, adapter: RuntimeAttachmentAdapter, policy: RuntimeAttachmentPolicy, now: string): Promise<RuntimeAttachmentPreview> {
  if (plan.mode !== "adopt" || plan.request.storage.mode !== "adopt") return fail("Only existing adopted runtimes can be attached.");
  const preflight = await preflightProvisioning(plan, planner, policy);
  if (preflight.status === "FAIL") return fail(preflight.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  const rawRoot = Object.hasOwn(policy.adoptionLocations, plan.request.storage.locationRef) ? policy.adoptionLocations[plan.request.storage.locationRef] : undefined;
  if (!rawRoot) return fail("Unapproved adoption reference.");
  const runtimeRoot = await canonicalAttachmentPath(rawRoot);
  const approved = await Promise.all(policy.adoptionRoots.map(canonicalAttachmentPath));
  if (!approved.some((root) => pathContains(root, runtimeRoot))) return fail("Runtime is outside approved adoption roots.");
  // Managed roots are not implicit adoption permission, and may not be adopted accidentally.
  const protectedRoots = await Promise.all([...Object.values(policy.managedRoots), ...(policy.protectedPaths ?? [])].map(canonicalAttachmentPath));
  if (protectedRoots.some((root) => pathContains(root, runtimeRoot) || pathContains(runtimeRoot, root))) return fail("Runtime overlaps managed or protected storage.");
  const rootStat = await fs.lstat(runtimeRoot); if (!rootStat.isDirectory()) return fail("Runtime root is not a directory.");
  await fs.readdir(runtimeRoot);
  const manifest: RuntimeArtifact[] = [];
  const requirements = planner.profileAdapter!.requirements(parseProvisioningRequest(plan.request));
  const knownArtifacts = new Set(requirements.artifacts.map((artifact) => artifact.id));
  for (const [name, hash] of Object.entries(policy.expectedHashes ?? {})) if (!knownArtifacts.has(name) || !/^[a-f0-9]{64}$/i.test(hash)) return fail("Unknown artifact name or invalid expected SHA-256.");
  for (const artifact of requirements.artifacts) {
    const target = artifact.source === "target" ? relativeTarget(runtimeRoot, artifact.relativePath) : Object.hasOwn(policy.artifactLocations, artifact.reference) ? policy.artifactLocations[artifact.reference] : undefined;
    if (!target) return fail("Unapproved artifact reference.");
    const expectedHash = policy.expectedHashes?.[artifact.id];
    manifest.push(await fileManifest(target, { name: artifact.id, artifactType: "file", required: true, ...(artifact.source === "target" ? { relativePath: artifact.relativePath } : { reference: artifact.reference }), ...(expectedHash ? { expectedHash } : {}) }));
  }
  const inspection = await adapter.inspect(plan, {
    readText: async (relative) => {
      const location = await canonicalAttachmentPath(relativeTarget(runtimeRoot, relative));
      const handle = await fs.open(location, "r");
      try {
        const stat = await handle.stat(); if (!stat.isFile() || stat.size > 1024 * 1024) return fail("Configuration must be a regular file no larger than 1 MiB.");
        const bytes = await handle.readFile(); const recorded = manifest.find((artifact) => artifact.relativePath === relative);
        if (!recorded || createHash("sha256").update(bytes).digest("hex") !== recorded.observedHash) return fail("Configuration changed before provider interpretation.");
        return bytes.toString("utf8");
      }
      finally { await handle.close(); }
    },
    directory: async (relative) => {
      const target = relativeTarget(runtimeRoot, relative);
      try {
        const canonical = await canonicalAttachmentPath(target); const stat = await fs.lstat(canonical);
        if (!stat.isDirectory()) return fail("Configured world is not a directory."); await fs.readdir(canonical);
        manifest.push({ name: `world:${relative}`, relativePath: relative, artifactType: "directory", required: false, size: 0, verification: "verified" }); return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        manifest.push({ name: `world:${relative}`, relativePath: relative, artifactType: "directory", required: false, size: 0, verification: "missing-optional" }); return false;
      }
    },
  });
  // Detect configuration replacement between hashing and provider interpretation.
  for (const artifact of manifest.filter((item) => item.artifactType === "file")) {
    const location = artifact.relativePath ? relativeTarget(runtimeRoot, artifact.relativePath) : policy.artifactLocations[artifact.reference!];
    const verified = await fileManifest(location, artifact);
    if (verified.observedHash !== artifact.observedHash) return fail("Artifact changed during provider inspection.");
  }
  const endRoot = await fs.lstat(await canonicalAttachmentPath(rawRoot));
  if (rootStat.dev !== endRoot.dev || rootStat.ino !== endRoot.ino) return fail("Runtime root was replaced during verification.");
  const descriptor = freezeProvisioningData({ schemaVersion: 1 as const, providerId: plan.providerId, serverId: plan.serverId, hostId: plan.request.hostId, runtimeRoot,
    rootIdentity: { device: String(rootStat.dev), inode: String(rootStat.ino) }, ownership: "ADOPTED" as const, mode: "attach" as const, destructiveOwnership: false as const,
    manifest, endpoints: plan.request.endpoints, worlds: inspection.worlds, verifiedAt: now, issues: [...preflight.issues] });
  return freezeProvisioningData({ plan, descriptor, digest: attachmentDigest(plan, descriptor) } as unknown) as RuntimeAttachmentPreview;
}
