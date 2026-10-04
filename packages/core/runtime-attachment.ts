import { createHash } from "node:crypto";
import { canonicalProvisioningJson, type ProvisioningIssue, type ProvisioningReadonly, type ServerProvisioningPlan } from "./provisioning";
import type { ProvisioningPreflightContext } from "./provisioning-preflight";
import type { ProvisioningApplyOperation } from "./provisioning-apply-contracts";

/** Trusted operator policy. Locations are references, never client-supplied absolute paths. */
export interface RuntimeAttachmentPolicy extends ProvisioningPreflightContext {
  adoptionRoots: string[];
  expectedHashes?: Record<string, string>;
}
export interface RuntimeArtifact {
  name: string; relativePath?: string; reference?: string; artifactType: "file" | "directory";
  required: boolean; expectedHash?: string; observedHash?: string; size: number;
  verification: "verified" | "missing-optional";
}
export type RuntimeAttachmentDescriptor = ProvisioningReadonly<{
  schemaVersion: 1; providerId: string; serverId: string; hostId: string; runtimeRoot: string;
  rootIdentity: { device: string; inode: string };
  ownership: "ADOPTED"; mode: "attach"; destructiveOwnership: false;
  manifest: RuntimeArtifact[]; endpoints: ServerProvisioningPlan["request"]["endpoints"];
  worlds: string[]; verifiedAt: string; issues: ProvisioningIssue[];
}>;
export interface RuntimeAttachmentPreview { plan: ServerProvisioningPlan; descriptor: RuntimeAttachmentDescriptor; digest: string }
export interface RuntimeAttachmentRequest extends RuntimeAttachmentPreview { approved: true }
export interface RuntimeInspectionContext {
  readText(relativePath: string): Promise<string>;
  directory(relativePath: string): Promise<boolean>;
}
export interface RuntimeAttachmentAdapter {
  inspect(plan: ServerProvisioningPlan, context: RuntimeInspectionContext): Promise<{ worlds: string[] }>;
  attach(record: RuntimeAttachmentRecord, fence: () => void): void;
  detach(effectId: string, fence: () => void): void;
  list(): RuntimeAttachmentRecord[];
}
export interface RuntimeAttachmentRecord {
  effectId: string; operationId: string; descriptor: RuntimeAttachmentDescriptor;
  digest: string; fencingToken: number; attachedAt: string;
}
export interface ExternalEffectIntent {
  effectId: string; operationId: string; digest: string; descriptor: RuntimeAttachmentDescriptor;
  fencingToken: number; state: "INTENDED" | "OBSERVED" | "RECEIPTED" | "RECONCILED" | "ROLLED_BACK";
  createdAt: string; updatedAt: string;
  receipt?: { effectId: string; digest: string; fencingToken: number; recordedAt: string; reconciled: boolean };
}
export interface RuntimeAttachmentRepository {
  intendAttachment(operation: ProvisioningApplyOperation, descriptor: RuntimeAttachmentDescriptor, digest: string, now: string): ExternalEffectIntent;
  attachmentIntent(operationId: string): ExternalEffectIntent | undefined;
  attachmentRecords(providerId?: string): RuntimeAttachmentRecord[];
  assertAttachmentRecord(record: RuntimeAttachmentRecord): void;
  assertAttachmentFence(operation: ProvisioningApplyOperation, now: string): void;
  publishAttachment(operation: ProvisioningApplyOperation, now: string): RuntimeAttachmentRecord;
  receiptAttachment(operation: ProvisioningApplyOperation, now: string, reconciled: boolean): void;
  removeAttachment(operation: ProvisioningApplyOperation, now: string): void;
}
export const attachmentDigest = (plan: ServerProvisioningPlan, descriptor: RuntimeAttachmentDescriptor) => createHash("sha256")
  .update(canonicalProvisioningJson({ plan: { ...plan, createdAt: "" }, descriptor: { ...descriptor, verifiedAt: "", issues: [] } })).digest("hex");
