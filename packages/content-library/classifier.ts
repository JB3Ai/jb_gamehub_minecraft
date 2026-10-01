import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ContentMetadata, ContentSourceKind, ContentType } from "./types";
import { listZipEntries, zipContainsAny, readZipEntryBytes, ZipReadError } from "./zip-reader";
import { inspectBedrockArchive } from "./bedrock-content-adapter";

export interface ClassificationResult {
  contentType: ContentType;
  sourceKind: ContentSourceKind;
  markers: string[];
  warnings: string[];
  notes: string[];
  /** True once we found positive evidence rather than falling back to extension guessing. */
  detectedFromContent: boolean;
}

const DIRECTORY_WALK_MAX_DEPTH = 6;
const DIRECTORY_WALK_MAX_ENTRIES = 4000;

/** Recursively collects basenames of interest without reading large file contents. */
async function collectDirectoryMarkers(rootPath: string): Promise<{ markers: Set<string>; topLevelDirs: string[]; fileCount: number; jarCount: number }> {
  const markers = new Set<string>();
  const topLevelDirs: string[] = [];
  let fileCount = 0;
  let jarCount = 0;
  let visited = 0;

  const markerNames = new Set(["level.dat", "manifest.json", "pack.mcmeta", "levelname.txt", "plugin.yml"]);

  async function walk(dir: string, depth: number, isTopLevel: boolean): Promise<void> {
    if (depth > DIRECTORY_WALK_MAX_DEPTH || visited >= DIRECTORY_WALK_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= DIRECTORY_WALK_MAX_ENTRIES) return;
      visited += 1;
      if (entry.isDirectory()) {
        if (isTopLevel) topLevelDirs.push(entry.name);
        await walk(path.join(dir, entry.name), depth + 1, false);
      } else {
        fileCount += 1;
        if (entry.name.toLowerCase().endsWith(".jar")) jarCount += 1;
        if (markerNames.has(entry.name)) markers.add(entry.name);
      }
    }
  }

  await walk(rootPath, 0, true);
  return { markers, topLevelDirs, fileCount, jarCount };
}

async function classifyDirectory(rootPath: string): Promise<ClassificationResult> {
  const { markers, topLevelDirs, fileCount, jarCount } = await collectDirectoryMarkers(rootPath);
  const warnings: string[] = [];
  const notes: string[] = [];

  if (fileCount === 0 && topLevelDirs.length === 0) {
    return {
      contentType: "unknown",
      sourceKind: "directory",
      markers: [],
      warnings: ["EMPTY_SOURCE_DIRECTORY"],
      notes: ["Directory contains no files or subdirectories."],
      detectedFromContent: false,
    };
  }

  if (markers.has("level.dat")) {
    if (topLevelDirs.includes("datapacks")) notes.push("World directory contains a datapacks folder.");
    return {
      contentType: "java-world",
      sourceKind: "directory",
      markers: Array.from(markers),
      warnings,
      notes,
      detectedFromContent: true,
    };
  }

  if (markers.has("manifest.json")) {
    let behaviorLike = topLevelDirs.some((dir) => /behavior/i.test(dir));
    let resourceLike = topLevelDirs.some((dir) => /resource|texture/i.test(dir));
    if (!behaviorLike && !resourceLike) {
      // Fall back to reading the manifest itself when the folder name is ambiguous.
      try {
        const manifestPath = path.join(rootPath, "manifest.json");
        const raw = await readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw) as { modules?: Array<{ type?: string }> };
        const types = (parsed.modules ?? []).map((module) => module.type);
        behaviorLike = types.includes("data");
        resourceLike = types.includes("resources") || types.includes("skin_pack");
      } catch {
        warnings.push("MANIFEST_UNREADABLE");
      }
    }
    return {
      contentType: resourceLike && !behaviorLike ? "resource-pack" : "behavior-pack",
      sourceKind: "directory",
      markers: Array.from(markers),
      warnings,
      notes,
      detectedFromContent: true,
    };
  }

  if (markers.has("pack.mcmeta")) {
    const isDatapack = topLevelDirs.includes("data") && !topLevelDirs.includes("assets");
    return {
      contentType: isDatapack ? "datapack" : "resource-pack",
      sourceKind: "directory",
      markers: Array.from(markers),
      warnings,
      notes,
      detectedFromContent: true,
    };
  }

  if (jarCount > 0 && jarCount === fileCount) {
    notes.push(`Directory contains ${jarCount} plugin JAR(s); treated as a plugin collection, not a single installable unit.`);
    return {
      contentType: "paper-plugin",
      sourceKind: "directory",
      markers: Array.from(markers),
      warnings,
      notes,
      detectedFromContent: true,
    };
  }

  return {
    contentType: "unknown",
    sourceKind: "directory",
    markers: Array.from(markers),
    warnings: ["NO_RECOGNIZED_MARKERS"],
    notes,
    detectedFromContent: false,
  };
}

const SKIN_IMAGE_EXTENSIONS = new Set([".png"]);

async function classifyFile(sourcePath: string): Promise<ClassificationResult> {
  const ext = path.extname(sourcePath).toLowerCase();
  const warnings: string[] = [];
  const notes: string[] = [];

  const bedrock = await inspectBedrockArchive(sourcePath);
  if (bedrock) {
    return {
      contentType: bedrock.contentType,
      sourceKind: "file",
      markers: bedrock.markers,
      warnings: bedrock.warnings,
      notes: bedrock.notes,
      detectedFromContent: bedrock.contentType !== "unknown",
    };
  }

  if (ext === ".rar") {
    return {
      contentType: "unknown",
      sourceKind: "file",
      markers: [],
      warnings: ["RAR_FORMAT_UNSUPPORTED"],
      notes: ["RAR archives cannot be inspected safely; content requires re-packaging as ZIP before ingestion."],
      detectedFromContent: false,
    };
  }

  if (SKIN_IMAGE_EXTENSIONS.has(ext)) {
    return { contentType: "skin", sourceKind: "file", markers: [ext], warnings, notes, detectedFromContent: true };
  }

  if (ext === ".jar") {
    let hasPluginDescriptor = false;
    try {
      const { found } = await zipContainsAny(sourcePath, ["plugin.yml", "paper-plugin.yml"]);
      hasPluginDescriptor = found.length > 0;
    } catch (error) {
      warnings.push("ARCHIVE_MALFORMED");
      notes.push((error as ZipReadError).message);
    }
    if (!hasPluginDescriptor) warnings.push("PLUGIN_DESCRIPTOR_NOT_FOUND");
    return { contentType: "paper-plugin", sourceKind: "file", markers: hasPluginDescriptor ? ["plugin.yml"] : [], warnings, notes, detectedFromContent: hasPluginDescriptor };
  }

  if (ext === ".zip") {
    try {
      const { entries, found, truncated } = await zipContainsAny(sourcePath, ["level.dat", "pack.mcmeta", "manifest.json"]);
      if (truncated) warnings.push("ARCHIVE_TOO_COMPLEX_TO_INSPECT");
      if (found.includes("level.dat")) {
        return { contentType: "java-world", sourceKind: "file", markers: ["level.dat"], warnings, notes, detectedFromContent: true };
      }
      if (found.includes("pack.mcmeta")) {
        const hasDataDirectory = entries.some((entry) => entry.name.replace(/\\/g, "/").startsWith("data/"));
        const hasAssetsDirectory = entries.some((entry) => entry.name.replace(/\\/g, "/").startsWith("assets/"));
        return {
          contentType: hasDataDirectory && !hasAssetsDirectory ? "datapack" : "resource-pack",
          sourceKind: "file",
          markers: ["pack.mcmeta"],
          warnings,
          notes,
          detectedFromContent: true,
        };
      }
      if (found.includes("manifest.json")) {
        return { contentType: "behavior-pack", sourceKind: "file", markers: ["manifest.json"], warnings, notes, detectedFromContent: true };
      }
      warnings.push("NO_RECOGNIZED_MARKERS");
      return { contentType: "unknown", sourceKind: "file", markers: [], warnings, notes, detectedFromContent: false };
    } catch (error) {
      warnings.push("ARCHIVE_MALFORMED");
      notes.push((error as ZipReadError).message);
      return { contentType: "unknown", sourceKind: "file", markers: [], warnings, notes, detectedFromContent: false };
    }
  }

  warnings.push("UNRECOGNIZED_FILE_TYPE");
  return { contentType: "unknown", sourceKind: "file", markers: [], warnings, notes, detectedFromContent: false };
}

export async function classifyContent(sourcePath: string): Promise<ClassificationResult> {
  let stats;
  try {
    stats = await stat(sourcePath);
  } catch {
    return {
      contentType: "unknown",
      sourceKind: "missing",
      markers: [],
      warnings: ["SOURCE_PATH_NOT_FOUND"],
      notes: [],
      detectedFromContent: false,
    };
  }

  if (stats.isDirectory()) return classifyDirectory(sourcePath);
  return classifyFile(sourcePath);
}

export function toMetadata(result: ClassificationResult): ContentMetadata {
  return {
    sourceKind: result.sourceKind,
    markers: result.markers,
    detectedAt: new Date().toISOString(),
    notes: result.notes.length > 0 ? result.notes : undefined,
  };
}

// listZipEntries re-exported for adapters/tests that need raw archive listings.
export { listZipEntries };
