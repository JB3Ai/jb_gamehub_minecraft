import { randomUUID } from "node:crypto";
import { creationHash, type FileIdentity, type ManagedCreatePreview, type ManagedCreationAdapter, type ManagedCreationRepository, type ManagedRuntimeDefinition } from "./managed-create";
import { managedFailure } from "./managed-filesystem";
import type { ProvisioningJson } from "./provisioning";

export interface ManagedBootPreview {
  schemaVersion: 1; operationId: string; creationDigest: string; definitionId: string; definitionFence: number;
  providerId: string; serverId: string; hostId: string; rootIdentity: FileIdentity;
  policy: ProvisioningJson; digest: string;
}
export interface ManagedBootAttempt {
  id: string; fence: number; owner: string; requestedAt: string;
  state: "LAUNCH_INTENT" | "RUNNING" | "READY" | "STOPPED" | "FAILED";
  evidence?: ProvisioningJson;
}
export interface ManagedBootAuthorization extends ManagedBootPreview {
  revision: number; actor: string; approvedAt: string; attempt?: ManagedBootAttempt;
}
export interface ManagedRuntimeBootControl {
  readonly worldName: string;
  current(): ManagedBootAuthorization | undefined;
  begin(): ManagedBootAttempt;
  record(attempt: ManagedBootAttempt, state: ManagedBootAttempt["state"], evidence: ProvisioningJson): void;
}
export interface ManagedRuntimeOutputPolicy {
  allows(relativePath: string, kind: "file" | "directory", size: number): boolean;
  maxEntries: number; maxTotalBytes: number;
}

/** Provider-neutral approval and durable launch bookkeeping; no process or filesystem mutation. */
export class ManagedBootCoordinator {
  private expected?: ManagedBootPreview;
  constructor(private readonly repo: ManagedCreationRepository, private readonly adapter: ManagedCreationAdapter,
    private readonly preview: ManagedCreatePreview, private readonly definition: ManagedRuntimeDefinition,
    private readonly now: () => Date, private readonly worker: string) {}
  previewAuthorization(): ManagedBootPreview {
    if (this.expected) return this.expected;
    if (!this.adapter.bootPolicy || !this.preview.worldName) managedFailure("BOOT_UNSUPPORTED");
    const bundle = this.preview.bundle && this.repo.getManagedBundle(this.preview.bundle.snapshotId);
    const policy = this.adapter.bootPolicy(this.preview, bundle || undefined);
    const value = { schemaVersion: 1 as const, operationId: this.definition.operationId, creationDigest: this.preview.digest,
      definitionId: this.definition.effectId, definitionFence: this.definition.fencingToken,
      providerId: this.preview.plan.providerId, serverId: this.preview.plan.serverId, hostId: this.preview.plan.request.hostId,
      rootIdentity: this.definition.descriptor.rootIdentity, policy };
    if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024) managedFailure("BOOT_POLICY_UNAVAILABLE");
    return this.expected = { ...value, digest: creationHash(value) };
  }
  current(): ManagedBootAuthorization | undefined {
    const stored = this.repo.getManagedBoot(this.definition.operationId);
    if (!stored) return undefined;
    const expected = this.previewAuthorization();
    const { actor: _actor, approvedAt: _time, revision: _revision, attempt: _attempt, digest, ...bound } = stored;
    if (digest !== expected.digest || creationHash(bound) !== digest) managedFailure("BOOT_APPROVAL_MISMATCH");
    return stored;
  }
  authorize(input: { digest: string; approved: true }, actor: string): ManagedBootAuthorization {
    if (input.approved !== true || !actor.trim()) managedFailure("APPROVAL_REQUIRED");
    const preview = this.previewAuthorization();
    if (input.digest !== preview.digest) managedFailure("APPROVAL_MISMATCH");
    const prior = this.current(); if (prior) return prior;
    const record: ManagedBootAuthorization = { ...preview, revision: 1, actor, approvedAt: this.now().toISOString() };
    this.repo.saveManagedBoot(this.definition, undefined, record, "provisioning.boot.authorized", actor, record.approvedAt);
    return record;
  }
  control(): ManagedRuntimeBootControl {
    return { worldName: this.preview.worldName!, current: () => this.current(), begin: () => {
      const auth = this.current(); if (!auth) managedFailure("FIRST_BOOT_DEFERRED");
      if (auth.attempt && auth.attempt.state !== "STOPPED" && !(auth.attempt.state === "FAILED" && (auth.attempt.evidence as { retryable?: boolean })?.retryable === true)) managedFailure("BOOT_RECOVERY_REQUIRED");
      const now = this.now().toISOString(), attempt: ManagedBootAttempt = { id: randomUUID(), fence: (auth.attempt?.fence ?? 0) + 1, owner: this.worker, requestedAt: now, state: "LAUNCH_INTENT" };
      this.repo.saveManagedBoot(this.definition, auth.revision, { ...auth, revision: auth.revision + 1, attempt }, "provisioning.boot.launch-intent", "system/managed-runtime", now);
      return attempt;
    }, record: (attempt, state, evidence) => {
      const auth = this.current(), active = auth?.attempt;
      if (!auth || !active || active.id !== attempt.id || active.fence !== attempt.fence || active.owner !== this.worker) managedFailure("BOOT_FENCE_LOST");
      const allowed: Record<ManagedBootAttempt["state"], ManagedBootAttempt["state"][]> = { LAUNCH_INTENT: ["RUNNING", "FAILED"], RUNNING: ["READY", "STOPPED", "FAILED"], READY: ["STOPPED", "FAILED"], STOPPED: [], FAILED: [] };
      if (active.state === state) return;
      if (!allowed[active.state].includes(state)) managedFailure("BOOT_STATE_CONFLICT");
      if (state === "STOPPED" && ((evidence as { exitCode?: number }).exitCode !== 0 || (evidence as { portsClosed?: boolean }).portsClosed !== true)) managedFailure("BOOT_STOP_UNVERIFIED");
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Buffer.byteLength(JSON.stringify(evidence)) > 16 * 1024) managedFailure("BOOT_EVIDENCE_UNAVAILABLE");
      const now = this.now().toISOString();
      const retained = active.evidence && typeof active.evidence === "object" && !Array.isArray(active.evidence) ? active.evidence : {};
      this.repo.saveManagedBoot(this.definition, auth.revision, { ...auth, revision: auth.revision + 1, attempt: { ...active, state, evidence: { ...retained, ...evidence, observedAt: now } } }, `provisioning.boot.${state.toLowerCase()}`, "system/managed-runtime", now);
    } };
  }
}
