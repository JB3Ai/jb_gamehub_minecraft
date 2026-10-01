import { appendFile, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectBedrockArchive, mergeBedrockLinkage, parseBedrockManifest, readBedrockLinkage } from "../content-library/bedrock-content-adapter";
import { hashFileStreamed } from "../content-library/hashing";
import { CONTENT_SCAN_LIMITS } from "../content-library/types";
import { extractZipEntryToDirectory, listZipEntries } from "../content-library/zip-reader";
import type { CompatibilityIssue, ContentImportAuditRecord, ContentImportPlan, ContentImportRequest, ContentImportResult, ContentItem } from "../content-library/types";

export interface BedrockContentImportAdapterConfig {
  serverDir: string;
  stagingRoot?: string;
  auditLogPath?: string;
}

function issue(code: string, message: string): CompatibilityIssue {
  return { code, message, severity: "blocking" };
}

function operationId(): string {
  return `bedrock_content_import_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function leaf(value: string): string | undefined {
  const candidate = path.basename(value);
  return candidate === value && candidate !== "." && candidate !== ".." && !/[<>:"|?*\0]/.test(candidate) ? candidate : undefined;
}

function contained(root: string, candidate: string): boolean {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  return absoluteCandidate.startsWith(`${absoluteRoot}${path.sep}`);
}

/**
 * Disposable/provider-owned Bedrock filesystem adapter. It is an import and
 * linkage implementation, not a native Bedrock runtime registration.
 */
export class BedrockContentImportAdapter {
  private readonly worldsRoot: string;
  private readonly behaviorPacksRoot: string;
  private readonly resourcePacksRoot: string;
  private readonly stagingRoot: string;
  private readonly auditLogPath: string;

  constructor(config: BedrockContentImportAdapterConfig) {
    this.worldsRoot = path.join(config.serverDir, "worlds");
    this.behaviorPacksRoot = path.join(config.serverDir, "behavior_packs");
    this.resourcePacksRoot = path.join(config.serverDir, "resource_packs");
    this.stagingRoot = config.stagingRoot ?? path.join(config.serverDir, ".gamehub-content-staging");
    this.auditLogPath = config.auditLogPath ?? path.join(config.serverDir, "gamehub-content-audit.jsonl");
  }

  async createPlan(request: ContentImportRequest): Promise<ContentImportPlan> {
    const { item } = request;
    const id = operationId();
    const blockingIssues: CompatibilityIssue[] = [];
    let destinationPath = path.join(this.stagingRoot, "blocked");
    const sourceName = leaf(path.basename(item.sourcePath));
    const worldId = request.worldId && leaf(request.worldId);

    if (request.providerId !== "minecraft-bedrock") blockingIssues.push(issue("PROVIDER_IMPORT_UNSUPPORTED", "This adapter is only available for the minecraft-bedrock provider."));
    if (!["bedrock-world", "behavior-pack", "resource-pack"].includes(item.contentType)) {
      blockingIssues.push(issue("CONTENT_TYPE_UNSUPPORTED", `Bedrock import does not support '${item.contentType}'.`));
    }
    if (item.compatibility.status !== "READY") blockingIssues.push(issue("CONTENT_COMPATIBILITY_NOT_APPROVED", `Content compatibility is ${item.compatibility.status}; it cannot be installed.`));
    if (item.validationStatus !== "valid" || item.hashScope !== "file" || !item.sha256) {
      blockingIssues.push(issue("CONTENT_VALIDATION_NOT_VALID", "A valid, file-hashed ContentItem is required."));
    }
    if (!sourceName) blockingIssues.push(issue("SOURCE_NAME_UNSAFE", "The source file name is unsafe."));

    const inspected = sourceName ? await inspectBedrockArchive(item.sourcePath) : undefined;
    if (!inspected || inspected.contentType !== item.contentType || !inspected.identity && item.contentType !== "bedrock-world") {
      blockingIssues.push(issue("BEDROCK_METADATA_INVALID", "Bedrock source metadata no longer validates for the scanned content type."));
    }

    if (item.contentType === "bedrock-world" && sourceName) {
      const worldName = leaf(path.basename(sourceName, path.extname(sourceName)));
      if (worldName) destinationPath = path.join(this.worldsRoot, worldName);
      else blockingIssues.push(issue("WORLD_NAME_UNSAFE", "The derived world name is unsafe."));
    }
    if ((item.contentType === "behavior-pack" || item.contentType === "resource-pack") && inspected?.identity) {
      if (!worldId) blockingIssues.push(issue("BEDROCK_TARGET_WORLD_REQUIRED", "A provider-discovered Bedrock worldId is required to link a pack."));
      destinationPath = path.join(item.contentType === "behavior-pack" ? this.behaviorPacksRoot : this.resourcePacksRoot, inspected.identity.headerUuid);
      if (await this.pathExists(destinationPath)) blockingIssues.push(issue("BEDROCK_PACK_ALREADY_INSTALLED", "A pack with this Bedrock header UUID is already managed."));
      for (const dependency of inspected.identity.dependencies) {
        if (!(await this.hasInstalledDependency(dependency.uuid, dependency.version))) {
          blockingIssues.push(issue("BEDROCK_PACK_DEPENDENCY_MISSING", `Required Bedrock pack ${dependency.uuid}@${dependency.version.join(".")} is not installed.`));
        }
      }
    }
    if (!contained(this.worldsRoot, destinationPath) && !contained(this.behaviorPacksRoot, destinationPath) && !contained(this.resourcePacksRoot, destinationPath)) {
      blockingIssues.push(issue("DESTINATION_OUTSIDE_MANAGED_ROOT", "Bedrock destination escaped its provider-managed root."));
    }

    return {
      operationId: id,
      contentId: item.contentId,
      contentType: item.contentType,
      sourcePath: path.resolve(item.sourcePath),
      stagingPath: path.join(this.stagingRoot, id),
      destinationPath,
      providerId: request.providerId,
      serverId: request.serverId,
      compatibilityStatus: item.compatibility.status,
      actions: ["verify-source-hash", "create-staging-directory", "extract-archive-to-staging", "validate-staged-content", "copy-staged-content-to-managed-destination", ...(worldId ? ["merge-world-pack-links" as const] : []), "remove-staging-directory"],
      warnings: item.compatibility.issues.filter((entry) => entry.severity !== "blocking"),
      requiresApproval: true,
      status: blockingIssues.length ? "blocked" : "planned",
      blockingIssues,
      sourceSha256: item.sha256,
      createdAt: new Date().toISOString(),
    };
  }

  async execute(plan: ContentImportPlan, request: ContentImportRequest, approved: boolean): Promise<ContentImportResult> {
    const audit: ContentImportAuditRecord[] = [];
    const record = async (action: string, result: ContentImportAuditRecord["result"], metadata?: Record<string, unknown>) => {
      const entry: ContentImportAuditRecord = { operationId: plan.operationId, timestamp: new Date().toISOString(), action, result, contentId: plan.contentId, contentType: plan.contentType, sourcePath: plan.sourcePath, destinationPath: plan.destinationPath, metadata };
      audit.push(entry);
      await mkdir(path.dirname(this.auditLogPath), { recursive: true });
      await appendFile(this.auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    };
    if (plan.status === "blocked") {
      await record("content.import.blocked", "blocked", { issues: plan.blockingIssues });
      return { plan, status: "blocked", audit, error: plan.blockingIssues[0] };
    }
    if (!approved) {
      const error = issue("APPROVAL_REQUIRED", "Import plans must be explicitly approved before execution.");
      await record("content.import.blocked", "blocked", { issues: [error] });
      return { plan, status: "blocked", audit, error };
    }
    if (plan.contentId !== request.item.contentId || path.resolve(request.item.sourcePath) !== plan.sourcePath) {
      const error = issue("PLAN_CONTENT_MISMATCH", "The supplied item does not match the plan.");
      await record("content.import.failed", "failed", { issue: error });
      return { plan, status: "failed", audit, error };
    }

    let installed = false;
    let linkBackup: Buffer | undefined;
    let linkFile: string | undefined;
    try {
      if (await hashFileStreamed(plan.sourcePath) !== plan.sourceSha256) throw issue("SOURCE_HASH_MISMATCH", "Source SHA-256 changed after planning; import was stopped.");
      await this.assertAvailable(plan.destinationPath);
      await mkdir(this.stagingRoot, { recursive: true });
      await mkdir(plan.stagingPath, { recursive: false });
      await record("content.import.source-verified", "completed", { sha256: plan.sourceSha256 });
      await record("content.import.staging-created", "completed", { stagingPath: plan.stagingPath });
      const stagedRoot = await this.extract(plan);
      const inspected = await inspectBedrockArchive(plan.sourcePath);
      if (!inspected || inspected.contentType !== plan.contentType) throw issue("BEDROCK_METADATA_INVALID", "Staged source no longer matches the plan.");
      await this.validateStaged(plan.contentType, stagedRoot);
      await mkdir(path.dirname(plan.destinationPath), { recursive: true });
      await cp(stagedRoot, plan.destinationPath, { recursive: true, errorOnExist: true, force: false, dereference: false });
      installed = true;
      await record("content.import.installed", "completed", { installedPath: plan.destinationPath });
      if (inspected.identity) {
        const target = request.worldId && leaf(request.worldId);
        if (!target) throw issue("BEDROCK_TARGET_WORLD_REQUIRED", "A safe provider-discovered worldId is required for pack linking.");
        const worldPath = path.join(this.worldsRoot, target);
        if (!contained(this.worldsRoot, worldPath) || !(await this.isDirectory(worldPath))) throw issue("BEDROCK_TARGET_WORLD_NOT_FOUND", "The selected managed Bedrock world does not exist.");
        const linkage = inspected.identity.packType === "behavior-pack" ? "world_behavior_packs.json" : "world_resource_packs.json";
        linkFile = path.join(worldPath, linkage);
        linkBackup = await this.optionalFile(linkFile);
        const existing = await readBedrockLinkage(worldPath, linkage);
        const merged = mergeBedrockLinkage(existing, [{ pack_id: inspected.identity.headerUuid, version: inspected.identity.version }]);
        const temporary = `${linkFile}.gamehub-${plan.operationId}.tmp`;
        await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        await rename(temporary, linkFile);
        await record("content.bedrock.pack-linked", "completed", { worldId: target, linkage, packId: inspected.identity.headerUuid, version: inspected.identity.version });
      }
      return { plan, status: "completed", installedPath: plan.destinationPath, audit };
    } catch (caught) {
      const error = this.asIssue(caught);
      await record("content.import.failed", "failed", { issue: error });
      if (linkFile) await this.restoreLink(linkFile, linkBackup);
      if (installed) {
        await rm(plan.destinationPath, { recursive: true, force: true });
        await record("content.import.rolled-back", "rolled-back");
      }
      return { plan, status: installed ? "rolled-back" : "failed", audit, error };
    } finally {
      await rm(plan.stagingPath, { recursive: true, force: true });
      await record("content.import.staging-cleaned", "completed");
    }
  }

  private async extract(plan: ContentImportPlan): Promise<string> {
    const listing = await listZipEntries(plan.sourcePath);
    if (listing.truncated || listing.entries.length > CONTENT_SCAN_LIMITS.maxArchiveEntries) throw issue("ARCHIVE_TOO_COMPLEX", "Archive exceeds safe inspection limits.");
    const root = path.join(plan.stagingPath, "extracted");
    await mkdir(root, { recursive: true });
    let bytes = 0;
    for (const entry of listing.entries) {
      if (entry.unsafePath) throw issue("ARCHIVE_PATH_UNSAFE", `Archive entry '${entry.name}' escapes its root.`);
      if (entry.uncompressedSize > CONTENT_SCAN_LIMITS.maxArchiveEntryBytes) throw issue("ARCHIVE_ENTRY_SIZE_LIMIT_EXCEEDED", "Archive entry exceeds safe extraction limit.");
      bytes += entry.uncompressedSize;
      if (bytes > CONTENT_SCAN_LIMITS.maxArchiveExtractedBytes) throw issue("ARCHIVE_EXTRACTED_SIZE_LIMIT_EXCEEDED", "Archive exceeds safe extraction limit.");
      await extractZipEntryToDirectory(plan.sourcePath, entry, root, CONTENT_SCAN_LIMITS.maxArchiveEntryBytes);
    }
    const children = await readdir(root, { withFileTypes: true });
    return children.length === 1 && children[0].isDirectory() ? path.join(root, children[0].name) : root;
  }

  private async validateStaged(type: ContentItem["contentType"], stagedRoot: string): Promise<void> {
    if (type === "bedrock-world") {
      if (!(await this.isFile(path.join(stagedRoot, "level.dat"))) || !(await this.isDirectory(path.join(stagedRoot, "db"))) && !(await this.isFile(path.join(stagedRoot, "levelname.txt")))) {
        throw issue("BEDROCK_WORLD_STRUCTURE_INVALID", "Staged Bedrock world requires level.dat and db/ or levelname.txt.");
      }
    } else if (!(await this.isFile(path.join(stagedRoot, "manifest.json")))) {
      throw issue("BEDROCK_MANIFEST_MISSING", "Staged Bedrock pack requires manifest.json at its root.");
    }
  }

  private async assertAvailable(destination: string): Promise<void> {
    try { await lstat(destination); throw issue("DESTINATION_COLLISION", "A managed destination already exists; overwrite is not permitted."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  private async pathExists(candidate: string): Promise<boolean> { return lstat(candidate).then(() => true).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error)); }
  private async hasInstalledDependency(uuid: string, version: [number, number, number]): Promise<boolean> {
    for (const root of [this.behaviorPacksRoot, this.resourcePacksRoot]) {
      try {
        const content = await readFile(path.join(root, uuid, "manifest.json"), "utf8");
        const parsed = parseBedrockManifest(JSON.parse(content));
        if (parsed.identity?.headerUuid === uuid && parsed.identity.version.join(".") === version.join(".")) return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
    }
    return false;
  }
  private async isFile(candidate: string): Promise<boolean> { return stat(candidate).then((value) => value.isFile()).catch(() => false); }
  private async isDirectory(candidate: string): Promise<boolean> { return stat(candidate).then((value) => value.isDirectory()).catch(() => false); }
  private async optionalFile(candidate: string): Promise<Buffer | undefined> { return readFile(candidate).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error)); }
  private async restoreLink(file: string, backup: Buffer | undefined): Promise<void> { if (backup) await writeFile(file, backup); else await rm(file, { force: true }); }
  private asIssue(error: unknown): CompatibilityIssue { return error && typeof error === "object" && "code" in error && "message" in error ? error as CompatibilityIssue : issue("IMPORT_FAILED", error instanceof Error ? error.message : "Unknown import failure."); }
}
