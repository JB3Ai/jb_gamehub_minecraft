import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { listZipEntries, readZipEntryBytes, ZipReadError } from "./zip-reader";
import type { CompatibilityIssue, ContentType } from "./types";

export interface BedrockPackIdentity {
  packType: Extract<ContentType, "resource-pack" | "behavior-pack">;
  name: string;
  description: string;
  headerUuid: string;
  version: [number, number, number];
  moduleTypes: string[];
  dependencies: Array<{ uuid: string; version: [number, number, number] }>;
}

export interface BedrockInspection {
  contentType: ContentType;
  markers: string[];
  warnings: string[];
  notes: string[];
  identity?: BedrockPackIdentity;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function version(value: unknown, code: string, issues: CompatibilityIssue[]): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || value.some((part) => !Number.isInteger(part) || part < 0)) {
    issues.push({ code, message: "Bedrock version must contain three non-negative integer components.", severity: "blocking" });
    return undefined;
  }
  return value as [number, number, number];
}

export function parseBedrockManifest(value: unknown): { identity?: BedrockPackIdentity; issues: CompatibilityIssue[] } {
  const issues: CompatibilityIssue[] = [];
  if (!value || typeof value !== "object") {
    return { issues: [{ code: "BEDROCK_MANIFEST_INVALID", message: "manifest.json must contain an object.", severity: "blocking" }] };
  }
  const manifest = value as { format_version?: unknown; header?: Record<string, unknown>; modules?: Array<Record<string, unknown>>; dependencies?: Array<Record<string, unknown>> };
  if (!manifest.header || typeof manifest.header !== "object") {
    return { issues: [{ code: "BEDROCK_MANIFEST_INVALID", message: "manifest.json requires a header object.", severity: "blocking" }] };
  }
  const headerUuid = typeof manifest.header.uuid === "string" ? manifest.header.uuid.toLowerCase() : "";
  if (!UUID.test(headerUuid)) issues.push({ code: "BEDROCK_HEADER_UUID_INVALID", message: "Bedrock manifest header UUID is invalid.", severity: "blocking" });
  const headerVersion = version(manifest.header.version, "BEDROCK_HEADER_VERSION_INVALID", issues);
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    issues.push({ code: "BEDROCK_MODULE_MISSING", message: "Bedrock manifest requires at least one module.", severity: "blocking" });
  }
  const moduleTypes: string[] = [];
  const seen = new Set<string>();
  for (const module of manifest.modules ?? []) {
    const moduleUuid = typeof module.uuid === "string" ? module.uuid.toLowerCase() : "";
    if (!UUID.test(moduleUuid)) issues.push({ code: "BEDROCK_MODULE_UUID_INVALID", message: "Bedrock manifest module UUID is invalid.", severity: "blocking" });
    if (seen.has(moduleUuid)) issues.push({ code: "BEDROCK_DUPLICATE_UUID", message: "Bedrock manifest contains duplicate module UUIDs.", severity: "blocking" });
    seen.add(moduleUuid);
    const type = typeof module.type === "string" ? module.type : "";
    if (!["resources", "data"].includes(type)) issues.push({ code: "BEDROCK_MODULE_TYPE_UNSUPPORTED", message: `Unsupported Bedrock module type '${type || "missing"}'.`, severity: "blocking" });
    moduleTypes.push(type);
    version(module.version, "BEDROCK_MODULE_VERSION_INVALID", issues);
  }
  const dependencies: BedrockPackIdentity["dependencies"] = [];
  for (const dependency of manifest.dependencies ?? []) {
    const uuid = typeof dependency.uuid === "string" ? dependency.uuid.toLowerCase() : "";
    const dependencyVersion = version(dependency.version, "BEDROCK_DEPENDENCY_INVALID", issues);
    if (!UUID.test(uuid) || !dependencyVersion) {
      issues.push({ code: "BEDROCK_DEPENDENCY_INVALID", message: "Bedrock dependency UUID or version is invalid.", severity: "blocking" });
    } else dependencies.push({ uuid, version: dependencyVersion });
  }
  const packType = moduleTypes.includes("data") ? "behavior-pack" : moduleTypes.includes("resources") ? "resource-pack" : undefined;
  if (!packType || !headerVersion || issues.length > 0) return { issues };
  return {
    issues,
    identity: {
      packType,
      name: typeof manifest.header.name === "string" ? manifest.header.name : "Unnamed Bedrock pack",
      description: typeof manifest.header.description === "string" ? manifest.header.description : "",
      headerUuid,
      version: headerVersion,
      moduleTypes,
      dependencies,
    },
  };
}

export async function inspectBedrockArchive(sourcePath: string): Promise<BedrockInspection | undefined> {
  const extension = path.extname(sourcePath).toLowerCase();
  if (![".mcworld", ".mcpack", ".mcaddon"].includes(extension)) return undefined;
  try {
    const listing = await listZipEntries(sourcePath);
    if (listing.truncated) return { contentType: "unknown", markers: [], warnings: ["ARCHIVE_TOO_COMPLEX_TO_INSPECT"], notes: [] };
    const names = listing.entries.map((entry) => entry.name.replace(/\\/g, "/"));
    if (extension === ".mcworld") {
      const hasLevel = names.some((name) => path.posix.basename(name) === "level.dat");
      const hasBedrockMarker = names.some((name) => path.posix.basename(name) === "levelname.txt") || names.some((name) => name.includes("/db/") || name.startsWith("db/"));
      return hasLevel && hasBedrockMarker
        ? { contentType: "bedrock-world", markers: ["level.dat", ...(hasBedrockMarker ? ["bedrock-world-marker"] : [])], warnings: [], notes: [] }
        : { contentType: "unknown", markers: hasLevel ? ["level.dat"] : [], warnings: ["BEDROCK_WORLD_STRUCTURE_INVALID"], notes: ["A .mcworld requires level.dat and a Bedrock world marker such as db/ or levelname.txt."] };
    }
    const manifest = listing.entries.find((entry) => path.posix.basename(entry.name.replace(/\\/g, "/")) === "manifest.json");
    if (!manifest) return { contentType: "unknown", markers: [], warnings: ["BEDROCK_MANIFEST_MISSING"], notes: [] };
    const bytes = await readZipEntryBytes(sourcePath, manifest);
    if (!bytes) return { contentType: "unknown", markers: ["manifest.json"], warnings: ["BEDROCK_MANIFEST_INVALID"], notes: ["Manifest could not be read within inspection limits."] };
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { return { contentType: "unknown", markers: ["manifest.json"], warnings: ["BEDROCK_MANIFEST_INVALID"], notes: ["manifest.json is not valid JSON."] }; }
    const result = parseBedrockManifest(parsed);
    return result.identity
      ? { contentType: result.identity.packType, markers: ["manifest.json"], warnings: [], notes: [], identity: result.identity }
      : { contentType: "unknown", markers: ["manifest.json"], warnings: result.issues.map((entry) => entry.code), notes: result.issues.map((entry) => entry.message) };
  } catch (error) {
    const message = error instanceof ZipReadError ? error.message : "Bedrock archive could not be inspected.";
    return { contentType: "unknown", markers: [], warnings: ["ARCHIVE_MALFORMED"], notes: [message] };
  }
}

export async function readBedrockLinkage(worldPath: string, fileName: "world_behavior_packs.json" | "world_resource_packs.json"): Promise<Array<{ pack_id: string; version: [number, number, number] }>> {
  try {
    const parsed = JSON.parse(await readFile(path.join(worldPath, fileName), "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Linkage root is not an array.");
    return parsed.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("Invalid linkage entry.");
      const pack = entry as { pack_id?: unknown; version?: unknown };
      if (typeof pack.pack_id !== "string" || !UUID.test(pack.pack_id)) throw new Error("Invalid linkage pack UUID.");
      const parsedVersion = version(pack.version, "BEDROCK_LINK_VERSION_INVALID", []);
      if (!parsedVersion) throw new Error("Invalid linkage version.");
      return { pack_id: pack.pack_id.toLowerCase(), version: parsedVersion };
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function mergeBedrockLinkage(
  existing: Array<{ pack_id: string; version: [number, number, number] }>,
  additions: Array<{ pack_id: string; version: [number, number, number] }>,
): Array<{ pack_id: string; version: [number, number, number] }> {
  const merged = new Map(existing.map((entry) => [`${entry.pack_id.toLowerCase()}@${entry.version.join(".")}`, entry]));
  for (const addition of additions) {
    const sameUuid = existing.find((entry) => entry.pack_id.toLowerCase() === addition.pack_id.toLowerCase());
    if (sameUuid && sameUuid.version.join(".") !== addition.version.join(".")) {
      throw Object.assign(new Error("Existing world linkage contains a different version of this pack UUID."), { code: "BEDROCK_PACK_VERSION_CONFLICT" });
    }
    merged.set(`${addition.pack_id.toLowerCase()}@${addition.version.join(".")}`, { ...addition, pack_id: addition.pack_id.toLowerCase() });
  }
  return [...merged.values()];
}

/** Writes a validated linkage document through a same-directory replacement. */
export async function writeBedrockLinkageAtomic(
  worldPath: string,
  fileName: "world_behavior_packs.json" | "world_resource_packs.json",
  entries: Array<{ pack_id: string; version: [number, number, number] }>,
): Promise<void> {
  const normalized = mergeBedrockLinkage([], entries);
  const destination = path.join(worldPath, fileName);
  const temporary = `${destination}.gamehub-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
}
