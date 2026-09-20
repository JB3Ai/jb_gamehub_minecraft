import { appendFile, cp, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { hashFileStreamed } from "./hashing";
import { extractZipEntryToDirectory, listZipEntries, ZipReadError } from "./zip-reader";
import { CONTENT_SCAN_LIMITS } from "./types";
import type {
  CompatibilityIssue,
  ContentImportAction,
  ContentImportAuditRecord,
  ContentImportPlan,
  ContentImportRequest,
  ContentImportResult,
  ContentItem,
} from "./types";

const SUPPORTED_TYPES = new Set<ContentItem["contentType"]>([
  "java-world",
  "paper-plugin",
  "resource-pack",
  "datapack",
]);

export interface ContentImportServiceConfig {
  stagingRoot: string;
  managedWorldsRoot: string;
  managedPluginsRoot: string;
  managedResourcePacksRoot: string;
  auditLogPath: string;
}

function issue(code: string, message: string, severity: CompatibilityIssue["severity"] = "blocking"): CompatibilityIssue {
  return { code, message, severity };
}

function stableOperationId(): string {
  return `content_import_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function safeLeafName(value: string): string | undefined {
  const base = path.basename(value);
  return base === value && base !== "." && base !== ".." && !/[<>:"|?*\0]/.test(base) ? base : undefined;
}

function insideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function destinationFor(item: ContentItem, config: ContentImportServiceConfig, worldId?: string): { path?: string; issue?: CompatibilityIssue } {
  const sourceLeaf = safeLeafName(path.basename(item.sourcePath));
  if (!sourceLeaf) return { issue: issue("SOURCE_NAME_UNSAFE", "The source file name is not safe for a managed destination.") };

  if (item.contentType === "java-world") {
    const worldName = safeLeafName(path.basename(sourceLeaf, path.extname(sourceLeaf)));
    if (!worldName) return { issue: issue("WORLD_NAME_UNSAFE", "The derived world name is not safe for a managed destination.") };
    return { path: path.join(config.managedWorldsRoot, worldName) };
  }
  if (item.contentType === "paper-plugin") return { path: path.join(config.managedPluginsRoot, sourceLeaf) };
  if (item.contentType === "resource-pack") return { path: path.join(config.managedResourcePacksRoot, sourceLeaf) };
  if (item.contentType === "datapack") {
    const safeWorldId = worldId && safeLeafName(worldId);
    if (!safeWorldId) return { issue: issue("DATAPACK_TARGET_WORLD_REQUIRED", "A safe target worldId is required for datapack installation.") };
    return { path: path.join(config.managedWorldsRoot, safeWorldId, "datapacks", sourceLeaf) };
  }
  return { issue: issue("CONTENT_TYPE_UNSUPPORTED", `Automatic import is not supported for '${item.contentType}'.`) };
}

function actionsFor(item: ContentItem): ContentImportAction[] {
  const actions: ContentImportAction[] = ["verify-source-hash", "create-staging-directory"];
  if (item.contentType === "java-world") actions.push("extract-archive-to-staging");
  else actions.push("copy-file-to-staging");
  actions.push("validate-staged-content", "copy-staged-content-to-managed-destination", "remove-staging-directory");
  return actions;
}

/**
 * Creates a non-mutating installation preview. An execution may only use a
 * plan returned by this service, preventing implicit direct-from-source installs.
 */
export class ContentImportPlanner {
  constructor(private readonly config: ContentImportServiceConfig) {}

  createPlan(request: ContentImportRequest): ContentImportPlan {
    const { item } = request;
    const operationId = stableOperationId();
    const destination = destinationFor(item, this.config, request.worldId);
    const blockingIssues: CompatibilityIssue[] = [];
    const warnings = [...item.compatibility.issues.filter((entry) => entry.severity !== "blocking")];

    if (request.providerId !== "minecraft") {
      blockingIssues.push(issue("PROVIDER_IMPORT_UNSUPPORTED", `No import adapter is registered for provider '${request.providerId}'.`));
    }
    if (!SUPPORTED_TYPES.has(item.contentType)) {
      blockingIssues.push(issue("CONTENT_TYPE_UNSUPPORTED", `Automatic import is not supported for '${item.contentType}'.`));
    }
    if (item.compatibility.status === "BLOCKED" || item.compatibility.status === "UNKNOWN") {
      blockingIssues.push(issue("CONTENT_COMPATIBILITY_NOT_APPROVED", `Content compatibility is ${item.compatibility.status}; it cannot be installed.`));
    }
    if (item.validationStatus !== "valid") {
      blockingIssues.push(issue("CONTENT_VALIDATION_NOT_VALID", "Only content with validationStatus 'valid' can be imported."));
    }
    if (item.hashScope !== "file" || !item.sha256) {
      blockingIssues.push(issue("SOURCE_HASH_REQUIRED", "A verified file SHA-256 is required before import."));
    }
    if (destination.issue) blockingIssues.push(destination.issue);

    const destinationPath = destination.path ?? path.join(this.config.stagingRoot, "blocked");
    const stagingPath = path.join(this.config.stagingRoot, operationId);
    if (destination.path && !this.isValidDestination(item, destination.path, request.worldId)) {
      blockingIssues.push(issue("DESTINATION_OUTSIDE_MANAGED_ROOT", "The planned destination is outside the managed content roots."));
    }

    return {
      operationId,
      contentId: item.contentId,
      contentType: item.contentType,
      sourcePath: path.resolve(item.sourcePath),
      stagingPath,
      destinationPath,
      providerId: request.providerId,
      serverId: request.serverId,
      compatibilityStatus: item.compatibility.status,
      actions: actionsFor(item),
      warnings,
      requiresApproval: true,
      status: blockingIssues.length === 0 ? "planned" : "blocked",
      blockingIssues,
      sourceSha256: item.sha256,
      createdAt: new Date().toISOString(),
    };
  }

  private isValidDestination(item: ContentItem, destination: string, worldId?: string): boolean {
    if (item.contentType === "java-world") return insideRoot(this.config.managedWorldsRoot, destination);
    if (item.contentType === "paper-plugin") return insideRoot(this.config.managedPluginsRoot, destination);
    if (item.contentType === "resource-pack") return insideRoot(this.config.managedResourcePacksRoot, destination);
    if (item.contentType === "datapack" && worldId) return insideRoot(this.config.managedWorldsRoot, destination);
    return false;
  }
}

/**
 * Executes only approved, planned imports. Sources are read-only; files are
 * copied/extracted to operation-scoped staging before any managed destination
 * changes are made. On failure, created destinations are removed and staging
 * is always cleaned.
 */
export class ContentImportExecutor {
  constructor(
    private readonly config: ContentImportServiceConfig,
    private readonly planner = new ContentImportPlanner(config),
  ) {}

  getPlanner(): ContentImportPlanner {
    return this.planner;
  }

  async execute(plan: ContentImportPlan, item: ContentItem, approved: boolean): Promise<ContentImportResult> {
    const audit: ContentImportAuditRecord[] = [];
    const record = async (
      action: string,
      result: ContentImportAuditRecord["result"],
      metadata?: Record<string, unknown>,
    ) => {
      const entry: ContentImportAuditRecord = {
        operationId: plan.operationId,
        timestamp: new Date().toISOString(),
        action,
        result,
        contentId: plan.contentId,
        contentType: plan.contentType,
        sourcePath: plan.sourcePath,
        destinationPath: plan.destinationPath,
        metadata,
      };
      audit.push(entry);
      await this.appendAudit(entry);
    };

    if (plan.status === "blocked") {
      await record("content.import.blocked", "blocked", { issues: plan.blockingIssues });
      return { plan, status: "blocked", audit, error: plan.blockingIssues[0] };
    }
    if (!approved) {
      const approvalIssue = issue("APPROVAL_REQUIRED", "Import plans must be explicitly approved before execution.");
      await record("content.import.blocked", "blocked", { issues: [approvalIssue] });
      return { plan, status: "blocked", audit, error: approvalIssue };
    }
    if (plan.contentId !== item.contentId || path.resolve(item.sourcePath) !== plan.sourcePath) {
      const mismatchIssue = issue("PLAN_CONTENT_MISMATCH", "The plan does not correspond to the supplied ContentItem.");
      await record("content.import.failed", "failed", { issues: [mismatchIssue] });
      return { plan, status: "failed", audit, error: mismatchIssue };
    }

    let destinationCreated = false;
    try {
      await this.verifySource(item, plan);
      await record("content.import.source-verified", "completed", { sha256: plan.sourceSha256 });
      await this.assertDestinationAvailable(plan.destinationPath);
      await mkdir(this.config.stagingRoot, { recursive: true });
      await mkdir(plan.stagingPath, { recursive: false });
      await record("content.import.staging-created", "completed", { stagingPath: plan.stagingPath });

      const stagedPath = await this.stage(plan, item);
      await this.validateStaged(plan, stagedPath);
      await record("content.import.staged-validated", "completed", { stagedPath });

      await mkdir(path.dirname(plan.destinationPath), { recursive: true });
      if (item.contentType === "java-world") {
        await cp(stagedPath, plan.destinationPath, { recursive: true, errorOnExist: true, force: false, dereference: false });
      } else {
        await cp(stagedPath, plan.destinationPath, { errorOnExist: true, force: false, dereference: false });
      }
      destinationCreated = true;
      await record("content.import.installed", "completed", { installedPath: plan.destinationPath });
      return { plan, status: "completed", installedPath: plan.destinationPath, audit };
    } catch (error) {
      const importIssue = this.toIssue(error);
      await record("content.import.failed", "failed", { issue: importIssue });
      if (destinationCreated) {
        await rm(plan.destinationPath, { recursive: true, force: true });
        await record("content.import.rolled-back", "rolled-back");
      }
      return { plan, status: destinationCreated ? "rolled-back" : "failed", audit, error: importIssue };
    } finally {
      await rm(plan.stagingPath, { recursive: true, force: true });
      await record("content.import.staging-cleaned", "completed");
    }
  }

  private async verifySource(item: ContentItem, plan: ContentImportPlan): Promise<void> {
    const sourceStat = await stat(plan.sourcePath);
    if (!sourceStat.isFile()) throw issue("SOURCE_NOT_REGULAR_FILE", "Only regular files may be installed.");
    const rehash = await hashFileStreamed(plan.sourcePath);
    if (rehash !== plan.sourceSha256 || rehash !== item.sha256) {
      throw issue("SOURCE_HASH_MISMATCH", "Source SHA-256 changed after scanning; import was stopped.");
    }
  }

  private async assertDestinationAvailable(destination: string): Promise<void> {
    if (
      !insideRoot(this.config.managedWorldsRoot, destination) &&
      !insideRoot(this.config.managedPluginsRoot, destination) &&
      !insideRoot(this.config.managedResourcePacksRoot, destination)
    ) {
      throw issue("DESTINATION_OUTSIDE_MANAGED_ROOT", "Destination is outside managed content roots.");
    }
    try {
      await lstat(destination);
      throw issue("DESTINATION_COLLISION", "A managed destination already exists; overwrite is not permitted.");
    } catch (error) {
      if (this.isIssue(error, "DESTINATION_COLLISION")) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async stage(plan: ContentImportPlan, item: ContentItem): Promise<string> {
    if (item.contentType !== "java-world") {
      const stagedFile = path.join(plan.stagingPath, safeLeafName(path.basename(plan.sourcePath))!);
      await cp(plan.sourcePath, stagedFile, { errorOnExist: true, force: false, dereference: false });
      return stagedFile;
    }

    const listing = await listZipEntries(plan.sourcePath);
    if (listing.truncated) throw issue("ARCHIVE_TOO_COMPLEX", "Archive central directory exceeded the safe inspection limit.");
    if (listing.entries.length > CONTENT_SCAN_LIMITS.maxArchiveEntries) {
      throw issue("ARCHIVE_ENTRY_LIMIT_EXCEEDED", `Archive has more than ${CONTENT_SCAN_LIMITS.maxArchiveEntries} entries.`);
    }
    let expectedExtractedBytes = 0;
    for (const entry of listing.entries) {
      if (entry.unsafePath) throw issue("ARCHIVE_PATH_UNSAFE", `Archive entry '${entry.name}' escapes its root.`);
      if (entry.uncompressedSize > CONTENT_SCAN_LIMITS.maxArchiveEntryBytes) {
        throw issue("ARCHIVE_ENTRY_SIZE_LIMIT_EXCEEDED", `Archive entry '${entry.name}' exceeds the per-entry extraction limit.`);
      }
      expectedExtractedBytes += entry.uncompressedSize;
      if (expectedExtractedBytes > CONTENT_SCAN_LIMITS.maxArchiveExtractedBytes) {
        throw issue("ARCHIVE_EXTRACTED_SIZE_LIMIT_EXCEEDED", "Archive exceeds the total extraction size limit.");
      }
    }

    const extractionRoot = path.join(plan.stagingPath, "extracted");
    await mkdir(extractionRoot, { recursive: true });
    let actualExtractedBytes = 0;
    for (const entry of listing.entries) {
      const remainingBudget = CONTENT_SCAN_LIMITS.maxArchiveExtractedBytes - actualExtractedBytes;
      actualExtractedBytes += await extractZipEntryToDirectory(
        plan.sourcePath,
        entry,
        extractionRoot,
        Math.min(CONTENT_SCAN_LIMITS.maxArchiveEntryBytes, remainingBudget),
      );
    }
    return await this.resolveWorldRoot(extractionRoot);
  }

  private async validateStaged(plan: ContentImportPlan, stagedPath: string): Promise<void> {
    if (plan.contentType === "java-world") {
      const levelDat = path.join(stagedPath, "level.dat");
      const levelDatStat = await stat(levelDat).catch(() => undefined);
      if (!levelDatStat?.isFile()) throw issue("WORLD_STRUCTURE_INVALID", "Extracted world does not contain level.dat at its root.");
      return;
    }
    if (plan.contentType === "paper-plugin") {
      const listing = await listZipEntries(stagedPath);
      if (!listing.entries.some((entry) => ["plugin.yml", "paper-plugin.yml"].includes(path.posix.basename(entry.name)))) {
        throw issue("PLUGIN_DESCRIPTOR_NOT_FOUND", "Staged plugin JAR does not contain plugin.yml or paper-plugin.yml.");
      }
    }
  }

  private async resolveWorldRoot(extractionRoot: string): Promise<string> {
    if (await this.fileExists(path.join(extractionRoot, "level.dat"))) return extractionRoot;
    const children = await readdir(extractionRoot, { withFileTypes: true });
    const candidates: string[] = [];
    for (const child of children.filter((entry) => entry.isDirectory())) {
      const candidate = path.join(extractionRoot, child.name);
      if (await this.fileExists(path.join(candidate, "level.dat"))) candidates.push(candidate);
    }
    if (candidates.length !== 1) {
      throw issue("WORLD_STRUCTURE_INVALID", "Archive must contain exactly one world root with level.dat.");
    }
    return candidates[0];
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  private async appendAudit(record: ContentImportAuditRecord): Promise<void> {
    await mkdir(path.dirname(this.config.auditLogPath), { recursive: true });
    await appendFile(this.config.auditLogPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
  }

  private toIssue(error: unknown): CompatibilityIssue {
    if (this.isIssue(error)) return error;
    if (error instanceof ZipReadError) return issue("ARCHIVE_INVALID", error.message);
    return issue("IMPORT_FAILED", error instanceof Error ? error.message : "Unknown import failure.");
  }

  private isIssue(error: unknown, code?: string): error is CompatibilityIssue {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      (!code || (error as CompatibilityIssue).code === code),
    );
  }
}
