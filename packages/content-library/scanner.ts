import { stat } from "node:fs/promises";
import path from "node:path";
import { classifyContent, toMetadata } from "./classifier";
import { hashFileStreamed } from "./hashing";
import { evaluateMinecraftCompatibility } from "./minecraft-content-adapter";
import type {
  CompatibilityResult,
  ContentItem,
  ContentScanEvent,
  ContentScanRequest,
  ContentScanReport,
  ContentSourceKind,
} from "./types";

function createContentId(): string {
  return `content_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function evaluateCompatibility(
  providerId: string,
  input: Parameters<typeof evaluateMinecraftCompatibility>[0],
): CompatibilityResult {
  if (providerId === "minecraft" || providerId === "minecraft-bedrock") {
    return evaluateMinecraftCompatibility(input);
  }
  return { status: "UNKNOWN", issues: [{ code: "PROVIDER_NOT_SUPPORTED", message: `No content adapter registered for provider '${providerId}'.`, severity: "blocking" }] };
}

/**
 * Scans a fixed list of source paths (files or directories) and produces a
 * normalized, provider-neutral content report. This service only reads
 * source content; it never writes, extracts, copies, or moves anything.
 */
export class ContentLibraryScanner {
  async scan(request: ContentScanRequest): Promise<ContentScanReport> {
    const startedAt = new Date().toISOString();
    const events: ContentScanEvent[] = [];
    const emit = (event: Omit<ContentScanEvent, "timestamp">) => {
      events.push({ ...event, timestamp: new Date().toISOString() });
    };

    emit({ type: "content.scan.started", payload: { target: request.target, pathCount: request.paths.length } });

    const items: ContentItem[] = [];
    for (const sourcePath of request.paths) {
      const item = await this.scanOne(sourcePath, request, emit);
      items.push(item);
    }

    emit({ type: "content.scan.completed", payload: { itemCount: items.length } });

    return {
      target: request.target,
      startedAt,
      completedAt: new Date().toISOString(),
      items,
      events,
    };
  }

  private async scanOne(
    sourcePath: string,
    request: ContentScanRequest,
    emit: (event: Omit<ContentScanEvent, "timestamp">) => void,
  ): Promise<ContentItem> {
    const resolved = path.resolve(sourcePath);
    emit({ type: "content.item.detected", sourcePath: resolved });

    const classification = await classifyContent(resolved);
    emit({
      type: "content.item.classified",
      sourcePath: resolved,
      payload: { contentType: classification.contentType, markers: classification.markers },
    });

    let sizeBytes = 0;
    let hashScope: ContentItem["hashScope"] = "unavailable";
    let sha256: string | undefined;

    if (classification.sourceKind !== "missing") {
      const stats = await stat(resolved);
      sizeBytes = stats.isDirectory() ? await sizeOfDirectory(resolved) : stats.size;
      if (stats.isFile()) {
        sha256 = await hashFileStreamed(resolved);
        hashScope = "file";
        emit({ type: "content.hash.verified", sourcePath: resolved, payload: { sha256 } });
      } else {
        hashScope = "directory-not-hashed";
      }
    }

    const compatibility = evaluateCompatibility(request.target.providerId, {
      contentType: classification.contentType,
      targetId: request.target.targetId,
      sourceKind: classification.sourceKind,
      sizeBytes,
      classificationWarnings: classification.warnings,
    });

    const validationStatus: ContentItem["validationStatus"] =
      compatibility.status === "UNKNOWN" ? "unknown" : compatibility.status === "BLOCKED" ? "invalid" : "valid";

    const contentId = createContentId();
    const item: ContentItem = {
      contentId,
      sourcePath: resolved,
      contentType: classification.contentType,
      sizeBytes,
      sha256,
      hashScope,
      metadata: toMetadata(classification),
      compatibility,
      validationStatus,
      warnings: classification.warnings,
      sourceManifestId: request.manifestIdsByPath?.[sourcePath] ?? request.manifestIdsByPath?.[resolved],
      scannedAt: new Date().toISOString(),
    };

    emit({
      type: "content.validation.completed",
      sourcePath: resolved,
      contentId,
      payload: { status: compatibility.status, issues: compatibility.issues },
    });

    return item;
  }
}

const DIRECTORY_SIZE_MAX_ENTRIES = 20000;

/** Sums file sizes recursively without reading file contents. Bounded so pathological trees stay fast. */
async function sizeOfDirectory(rootPath: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  let visited = 0;

  async function walk(dir: string): Promise<void> {
    if (visited >= DIRECTORY_SIZE_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= DIRECTORY_SIZE_MAX_ENTRIES) return;
      visited += 1;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else {
        try {
          const entryStat = await stat(entryPath);
          total += entryStat.size;
        } catch {
          // Ignore files that disappear mid-scan; size becomes a best-effort estimate.
        }
      }
    }
  }

  await walk(rootPath);
  return total;
}

export type { ContentSourceKind };
