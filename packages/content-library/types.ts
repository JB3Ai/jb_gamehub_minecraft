/**
 * Provider-neutral content library types for JBGH-020.
 *
 * These types intentionally avoid provider-specific vocabulary (`level.dat`,
 * `.mcworld`, `plugin.yml`, pack manifests, etc). Provider-specific detection
 * rules live in provider content adapters (see `minecraft-content-adapter.ts`)
 * and are translated into these neutral shapes before reaching core/dashboard
 * consumers.
 */

export type ContentType =
  | "java-world"
  | "bedrock-world"
  | "paper-plugin"
  | "resource-pack"
  | "behavior-pack"
  | "skin"
  | "datapack"
  | "unknown";

export type ContentSourceKind = "file" | "directory" | "missing";

export type CompatibilityStatus = "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";

export interface ContentHash {
  algorithm: "sha256";
  value: string;
}

export interface CompatibilityIssue {
  code: string;
  message: string;
  severity: "info" | "warning" | "blocking";
}

export interface CompatibilityResult {
  status: CompatibilityStatus;
  issues: CompatibilityIssue[];
}

/** What a provider/target profile is able to accept, used to drive compatibility evaluation. */
export interface ProviderCapability {
  providerId: string;
  targetId: string;
  accepts: ContentType[];
}

export interface ContentMetadata {
  sourceKind: ContentSourceKind;
  markers: string[];
  detectedAt: string;
  notes?: string[];
}

export interface ContentItem {
  contentId: string;
  sourcePath: string;
  contentType: ContentType;
  sizeBytes: number;
  sha256?: string;
  hashScope: "file" | "directory-not-hashed" | "unavailable";
  metadata: ContentMetadata;
  compatibility: CompatibilityResult;
  validationStatus: "valid" | "invalid" | "unknown";
  warnings: string[];
  sourceManifestId?: string;
  scannedAt: string;
}

export type ContentScanEventType =
  | "content.scan.started"
  | "content.item.detected"
  | "content.item.classified"
  | "content.hash.verified"
  | "content.validation.completed"
  | "content.scan.completed";

export interface ContentScanEvent {
  type: ContentScanEventType;
  timestamp: string;
  sourcePath?: string;
  contentId?: string;
  payload?: Record<string, unknown>;
}

export interface ContentScanTarget {
  targetId: string;
  providerId: string;
}

export interface ContentScanRequest {
  paths: string[];
  target: ContentScanTarget;
  /** Optional stable IDs used to correlate results back to an acceptance manifest. */
  manifestIdsByPath?: Record<string, string>;
}

export interface ContentScanReport {
  target: ContentScanTarget;
  startedAt: string;
  completedAt: string;
  items: ContentItem[];
  events: ContentScanEvent[];
}

export type ContentImportAction =
  | "verify-source-hash"
  | "create-staging-directory"
  | "extract-archive-to-staging"
  | "copy-file-to-staging"
  | "validate-staged-content"
  | "copy-staged-content-to-managed-destination"
  | "remove-staging-directory";

export type ContentImportStatus = "planned" | "blocked" | "completed" | "failed" | "rolled-back";

export interface ContentImportPlan {
  operationId: string;
  contentId: string;
  contentType: ContentType;
  sourcePath: string;
  stagingPath: string;
  destinationPath: string;
  providerId: string;
  serverId?: string;
  compatibilityStatus: CompatibilityStatus;
  actions: ContentImportAction[];
  warnings: CompatibilityIssue[];
  requiresApproval: boolean;
  status: Extract<ContentImportStatus, "planned" | "blocked">;
  blockingIssues: CompatibilityIssue[];
  sourceSha256?: string;
  createdAt: string;
}

export interface ContentImportAuditRecord {
  operationId: string;
  timestamp: string;
  action: string;
  result: "completed" | "failed" | "blocked" | "rolled-back";
  contentId: string;
  contentType: ContentType;
  sourcePath: string;
  destinationPath: string;
  metadata?: Record<string, unknown>;
}

export interface ContentImportResult {
  plan: ContentImportPlan;
  status: Exclude<ContentImportStatus, "planned" | "blocked"> | "blocked";
  installedPath?: string;
  audit: ContentImportAuditRecord[];
  error?: CompatibilityIssue;
}

export interface ContentImportRequest {
  item: ContentItem;
  providerId: string;
  serverId?: string;
  /** Required for datapacks; identifies a world directory beneath managedWorldsRoot. */
  worldId?: string;
}

/** Bounds enforced by the scanner so large files never require unbounded memory. */
export const CONTENT_SCAN_LIMITS = {
  /** Maximum bytes read into memory from any single archive entry for classification purposes. */
  maxInspectedEntryBytes: 8 * 1024 * 1024,
  /** Streamed hashing chunk size. */
  hashChunkBytes: 1024 * 1024,
  /** Installation guardrails. Archives exceeding these limits are blocked before extraction. */
  maxArchiveEntries: 10_000,
  maxArchiveExtractedBytes: 4 * 1024 * 1024 * 1024,
  maxArchiveEntryBytes: 512 * 1024 * 1024,
} as const;
