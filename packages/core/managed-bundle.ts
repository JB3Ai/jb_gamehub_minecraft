import fs from "node:fs";
import path from "node:path";
import { creationHash, type ApprovedRuntimeBundle, type ResolvedRuntimeBundle } from "./managed-create";
import { canonicalManagedPath, existingStat, hashFile, identity, managedFailure, pathOverlaps, safeBundleSegment } from "./managed-filesystem";

/** Portable bundle paths always use '/', including on Windows. */
export const safeBundlePath = (value: string): boolean => typeof value === "string" && value.length <= 768 && value.split("/").every(safeBundleSegment) && !value.includes("\\");
const parents = (relative: string) => relative.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
export function bundleDirectories(bundle: ApprovedRuntimeBundle): string[] {
  return [...new Set([...bundle.directories, ...bundle.directories.flatMap(parents), ...bundle.files.flatMap((file) => parents(file.relativePath))])].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b, "en"));
}

export function resolveRuntimeBundle(bundle: ApprovedRuntimeBundle, digest: string, location: string, runtimePath: string, generatedPaths: string[]): ResolvedRuntimeBundle {
  const limits = bundle.limits;
  if (bundle.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(digest) || creationHash(bundle) !== digest ||
    !limits || !Number.isInteger(limits.maxFiles) || limits.maxFiles < 1 || limits.maxFiles > 32768 ||
    !Number.isInteger(limits.maxDepth) || limits.maxDepth < 1 || limits.maxDepth > 16 ||
    !Number.isInteger(limits.maxFileBytes) || limits.maxFileBytes < 1 || limits.maxFileBytes > 256 * 1024 * 1024 ||
    !Number.isSafeInteger(limits.maxTotalBytes) || limits.maxTotalBytes < 1 || limits.maxTotalBytes > 4 * 1024 ** 3 ||
    !Array.isArray(bundle.files) || !bundle.files.length || bundle.files.length > limits.maxFiles ||
    !Array.isArray(bundle.directories) || bundle.directories.length > limits.maxFiles ||
    !Array.isArray(bundle.runtimeOutputs) || bundle.runtimeOutputs.length > 32 ||
    Buffer.byteLength(JSON.stringify(bundle)) > 16 * 1024 * 1024) managedFailure("INVALID_BUNDLE");
  const names = new Map<string, string>(), fileNames = new Set<string>(); let total = 0, previous = "";
  const register = (relative: string, repeatedParent = false) => {
    if (!safeBundlePath(relative) || relative.split("/").length > limits.maxDepth) managedFailure("UNSAFE_PATH");
    const lower = relative.toLowerCase(), existing = names.get(lower);
    if (existing && (!repeatedParent || existing !== relative)) managedFailure("INVALID_BUNDLE");
    names.set(lower, relative);
  };
  for (const file of bundle.files) {
    register(file.relativePath);
    if (previous && previous >= file.relativePath || !["immutable-runtime", "protected-config"].includes(file.classification) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes) managedFailure("INVALID_BUNDLE");
    previous = file.relativePath; total += file.size; fileNames.add(file.relativePath.toLowerCase());
  }
  if (total > limits.maxTotalBytes) managedFailure("INVALID_BUNDLE");
  const directories = bundleDirectories(bundle);
  if (directories.length > limits.maxFiles) managedFailure("INVALID_BUNDLE");
  if (new Set(bundle.directories.map((directory) => directory.toLowerCase())).size !== bundle.directories.length) managedFailure("INVALID_BUNDLE");
  for (const directory of directories) { if (fileNames.has(directory.toLowerCase())) managedFailure("INVALID_BUNDLE"); register(directory, true); }
  for (const relative of generatedPaths) {
    if (names.has(relative.toLowerCase()) && bundle.files.find((file) => file.relativePath === relative)?.classification !== "protected-config") managedFailure("INVALID_BUNDLE");
  }
  for (const output of bundle.runtimeOutputs) {
    if (!safeBundlePath(output.relativePath) || !["directory", "file"].includes(output.kind) || [...names.values(), ...generatedPaths].some((name) => name.toLowerCase() === output.relativePath.toLowerCase() || name.toLowerCase().startsWith(output.relativePath.toLowerCase() + "/") || output.relativePath.toLowerCase().startsWith(name.toLowerCase() + "/"))) managedFailure("INVALID_BUNDLE");
  }
  if (!safeBundlePath(bundle.entrypoint) || !bundle.files.some((file) => file.relativePath === bundle.entrypoint && file.classification === "immutable-runtime")) managedFailure("INVALID_BUNDLE");
  if (!location || !path.isAbsolute(location) || pathOverlaps(runtimePath, path.resolve(location))) managedFailure("PROTECTED_PATH");
  const sourcePath = canonicalManagedPath(location);
  if (!fs.lstatSync(sourcePath).isDirectory()) managedFailure("ARTIFACT_UNAVAILABLE");
  const sourceDirectories = directories.map((relativePath) => {
    const directory = path.join(sourcePath, relativePath);
    if (!existingStat(directory)?.isDirectory()) managedFailure("ARTIFACT_UNAVAILABLE");
    canonicalManagedPath(directory);
    // Selected runtime namespaces must have complete explicit coverage, including empty directories.
    const prefix = relativePath + "/";
    const children = new Set([...bundle.files.map((file) => file.relativePath), ...directories].filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes("/")).map((name) => name.slice(prefix.length)));
    if (fs.readdirSync(directory).some((name) => !children.has(name))) managedFailure("BUNDLE_COVERAGE_MISMATCH");
    return { relativePath, identity: identity(fs.lstatSync(directory, { bigint: true })) };
  });
  const files = bundle.files.map((file, index) => {
    const source = path.join(sourcePath, file.relativePath);
    if (!existingStat(source)) managedFailure("ARTIFACT_UNAVAILABLE");
    const observed = hashFile(source, limits.maxFileBytes);
    if (observed.sha256 !== file.sha256 || observed.size !== file.size) managedFailure("ARTIFACT_DRIFT");
    return { name: file.relativePath === bundle.entrypoint ? "runtime" : "bundle-" + index, relativePath: file.relativePath, sourcePath: source, sourceIdentity: observed.identity, sha256: file.sha256, size: file.size };
  });
  return { manifest: bundle, manifestDigest: digest, sourcePath, sourceIdentity: identity(fs.lstatSync(sourcePath, { bigint: true })), files, directories, sourceDirectories };
}
