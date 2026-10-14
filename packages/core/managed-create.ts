import { createHash } from "node:crypto";
import type { ProvisioningJson, ServerProvisioningPlan, ServerProvisioningRequest } from "./provisioning";
import { canonicalProvisioningJson } from "./provisioning";
import type { RuntimeArtifact, RuntimeAttachmentPolicy, RuntimeAttachmentRecord } from "./runtime-attachment";
import type { ProvisioningApplyOperation, ProvisioningApplyStep } from "./provisioning-apply-contracts";

export interface ApprovedCreationProfile {
  providerId: string; revision: string;
  artifacts: Array<{ reference: string; sha256: string }>;
  runtime?: { reference: string; sha256: string; compatibility: string };
  acceptanceRef?: string;
  configuration: Record<string, ProvisioningJson>;
}
export interface PriorLicenseAcceptance {
  revision: string; actor: string; acceptedAt: string; termsRef: string;
  hostId: string; profileId: string; profileRevision: string;
  serverId?: string; authorizeGeneratedAcceptance: true; revoked?: boolean;
}
export interface ManagedCreationPolicy {
  /** Operator attests local, service-exclusive roots, shared by exactly this SQLite database. */
  filesystem: "local-exclusive";
  profiles: Record<string, ApprovedCreationProfile>;
  acceptances: Record<string, PriorLicenseAcceptance>;
  maxArtifactBytes?: number;
  protectedPaths?: string[];
  endpointInventory?: { complete: boolean; bindings: import("./provisioning-preflight").EndpointBinding[] };
}
export interface CreationFile {
  name: string; relativePath: string;
  sourceRef?: string; sha256?: string; content?: string;
}
export interface CreationManifest {
  files: CreationFile[]; worldName?: string;
  externalRuntime?: { name: string; reference: string; sha256: string };
}
export interface ManagedCreationAdapter {
  manifest(request: ServerProvisioningRequest, profile: ApprovedCreationProfile, acceptance?: PriorLicenseAcceptance): CreationManifest;
}
export interface FileIdentity { device: string; inode: string }
export interface ResolvedCreationFile extends CreationFile { sourcePath?: string; sourceIdentity?: FileIdentity; size: number; sha256: string }
export interface ManagedCreatePreview {
  plan: ServerProvisioningPlan; digest: string;
  profileId: string; policyHash: string; rootPath: string; rootIdentity: FileIdentity;
  runtimePath: string; leaf: string; files: ResolvedCreationFile[]; worldName?: string;
  externalRuntime?: { name: string; reference: string; sha256: string; identity: FileIdentity };
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
  beginManaged(op: ProvisioningApplyOperation, claims: ProvisioningApplyStep[]): { operation: ProvisioningApplyOperation; acquired: boolean };
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
  ...(preview.externalRuntime ? [{ name: preview.externalRuntime.name, reference: preview.externalRuntime.reference, artifactType: "file" as const, required: true, observedHash: preview.externalRuntime.sha256, size: 0, verification: "verified" as const }] : []),
];
