import { createHash } from "node:crypto";
import type { ProvisioningJson, ServerProvisioningPlan, ServerProvisioningRequest } from "./provisioning";
import { canonicalProvisioningJson } from "./provisioning";
import type { RuntimeArtifact, RuntimeAttachmentPolicy, RuntimeAttachmentRecord } from "./runtime-attachment";
import type { ProvisioningApplyOperation, ProvisioningApplyStep } from "./provisioning-apply-contracts";

export interface ApprovedCreationProfile {
  providerId: string; revision: string;
  artifacts: Array<{ reference: string; sha256: string }>;
  runtime?: { reference: string; sha256: string; compatibility: string };
  bundle?: { reference: string; digest: string };
  acceptanceRef?: string;
  configuration: Record<string, ProvisioningJson>;
}
export interface PriorLicenseAcceptance {
  revision: string; actor: string; acceptedAt: string; termsRef: string;
  hostId: string; profileId: string; profileRevision: string;
  serverId?: string; authorizeGeneratedAcceptance: true; revoked?: boolean;
  providerId?: string; bundleDigest?: string;
}
/** Explicit extracted-directory inventory. Source references are trusted operator data. */
export interface ApprovedRuntimeBundle {
  schemaVersion: 1; version: string; platform: string; architecture: string;
  runtimeKind: string; transport: string; sourceRef: string; entrypoint: string;
  files: Array<{ relativePath: string; size: number; sha256: string; classification: "immutable-runtime" | "protected-config" }>;
  directories: string[];
  runtimeOutputs: Array<{ relativePath: string; kind: "directory" | "file" }>;
  limits: { maxFiles: number; maxDepth: number; maxFileBytes: number; maxTotalBytes: number };
}
export interface ResolvedRuntimeBundle {
  manifest: ApprovedRuntimeBundle; manifestDigest: string; sourcePath: string; sourceIdentity: FileIdentity;
  files: ResolvedCreationFile[]; directories: string[]; sourceDirectories: Array<{ relativePath: string; identity: FileIdentity }>;
}
export interface ManagedCreationPolicy {
  /** Operator attests local, service-exclusive roots, shared by exactly this SQLite database. */
  filesystem: "local-exclusive";
  profiles: Record<string, ApprovedCreationProfile>;
  acceptances: Record<string, PriorLicenseAcceptance>;
  bundles?: Record<string, ApprovedRuntimeBundle>;
  bundleLocations?: Record<string, string>;
  maxArtifactBytes?: number;
  protectedPaths?: string[];
  endpointInventory?: { complete: boolean; bindings: import("./provisioning-preflight").EndpointBinding[] };
}
export interface CreationFile {
  name: string; relativePath: string;
  sourceRef?: string; sha256?: string; content?: string;
  /** Provider-owned, versioned policy for this file; included in the approval digest. */
  validationPolicy?: ProvisioningJson;
}
export interface CreationManifest {
  files: CreationFile[]; worldName?: string;
  externalRuntime?: { name: string; reference: string; sha256: string };
  bundle?: { reference: string; digest: string };
}
export interface ManagedCreationAdapter {
  manifest(request: ServerProvisioningRequest, profile: ApprovedCreationProfile, acceptance?: PriorLicenseAcceptance, bundle?: Readonly<ApprovedRuntimeBundle>): CreationManifest;
  /** A stopped-only implementation may register a runtime without authorizing its first boot. */
  readonly lifecycleDeferred?: boolean;
  /** Optional provider-owned content policy for completed runtimes; creation receipts remain byte-exact. */
  runtimeFileValidator?(file: Readonly<CreationFile>): ((bytes: Uint8Array) => void) | undefined;
}
export interface FileIdentity { device: string; inode: string }
export interface ResolvedCreationFile extends CreationFile { sourcePath?: string; sourceIdentity?: FileIdentity; size: number; sha256: string }
export interface ManagedCreatePreview {
  plan: ServerProvisioningPlan; digest: string;
  profileId: string; policyHash: string; rootPath: string; rootIdentity: FileIdentity;
  runtimePath: string; leaf: string; files: ResolvedCreationFile[]; worldName?: string;
  externalRuntime?: { name: string; reference: string; sha256: string; identity: FileIdentity };
  bundle?: { snapshotId: string; manifestDigest: string; version: string; fileCount: number; totalBytes: number; entrypoint: ResolvedCreationFile };
}
export interface ManagedRuntimeDefinition {
  effectId: string; operationId: string; digest: string; fencingToken: number; attachedAt: string;
  state: "PENDING_ACTIVATION" | "ACTIVE";
  descriptor: Omit<RuntimeAttachmentRecord["descriptor"], "ownership" | "mode"> & {
    ownership: "MANAGED"; mode: "create"; profileId: string;
  };
}
export type ScopedRuntimeRecord = RuntimeAttachmentRecord | ManagedRuntimeDefinition;
export interface FileEffectIntent {
  id: string; operationId: string; kind: "directory" | "temporary" | "write" | "publish" | "remove-temp";
  relativePath: string; hash?: string; fileIndex?: number;
  direction?: "compensation"; fencingToken?: number;
}
export interface FileEffectReceipt {
  intentId: string; identity: FileIdentity; sha256?: string; size?: number;
  compensated?: boolean;
  fencingToken?: number;
}
export interface ManagedCreationRepository {
  saveManagedPreview(preview: ManagedCreatePreview): void;
  getManagedPreview(planId: string): ManagedCreatePreview | undefined;
  saveManagedBundle(id: string, bundle: ResolvedRuntimeBundle): void;
  getManagedBundle(id: string): ResolvedRuntimeBundle | undefined;
  beginManaged(op: ProvisioningApplyOperation, claims: ProvisioningApplyStep[]): { operation: ProvisioningApplyOperation; acquired: boolean };
  acquireRollback(operationId: string, digest: string, actor: string, owner: string, now: string, expiresAt: string): ProvisioningApplyOperation;
  managedGuard<T>(op: ProvisioningApplyOperation, now: string, expiresAt: string, run: () => T): T;
  intendFile(op: ProvisioningApplyOperation, intent: FileEffectIntent, now: string): void;
  fileIntents(operationId: string): FileEffectIntent[];
  fileReceipts(operationId: string): FileEffectReceipt[];
  receiptFile(op: ProvisioningApplyOperation, receipt: FileEffectReceipt, now: string): void;
  publishManagedDefinition(op: ProvisioningApplyOperation, definition: ManagedRuntimeDefinition, now: string): void;
  managedDefinitions(): ManagedRuntimeDefinition[];
  removeManagedDefinition(op: ProvisioningApplyOperation, now: string): void;
  finishManaged(op: ProvisioningApplyOperation, now: string): ProvisioningApplyOperation;
  guardManagedDefinition<T>(definition: ManagedRuntimeDefinition, run: () => T): T;
  journalManagedPhase(op: ProvisioningApplyOperation, phase: string, status: "started" | "completed", now: string): void;
}
export const creationHash = (value: unknown) => createHash("sha256").update(canonicalProvisioningJson(value as ProvisioningJson)).digest("hex");
export const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const creationDigest = (preview: Omit<ManagedCreatePreview, "digest">) => creationHash({ ...preview, plan: { ...preview.plan, createdAt: "" } });
export const manifestArtifacts = (preview: ManagedCreatePreview): RuntimeArtifact[] => [
  ...preview.files.map((file) => ({ name: file.name, relativePath: file.relativePath, artifactType: "file" as const, required: true, observedHash: file.sha256, size: file.size, verification: "verified" as const })),
  ...(preview.bundle ? [{ name: "runtime", relativePath: preview.bundle.entrypoint.relativePath, artifactType: "file" as const, required: true, observedHash: preview.bundle.entrypoint.sha256, size: preview.bundle.entrypoint.size, verification: "verified" as const }] : []),
  ...(preview.externalRuntime ? [{ name: preview.externalRuntime.name, reference: preview.externalRuntime.reference, artifactType: "file" as const, required: true, observedHash: preview.externalRuntime.sha256, size: 0, verification: "verified" as const }] : []),
];
