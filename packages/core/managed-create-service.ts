import fs from "node:fs";
import path from "node:path";
import net, { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { canonicalProvisioningJson, freezeProvisioningData, parseProvisioningRequest, type ProvisioningPlanner, type ServerProvisioningPlan } from "./provisioning";
import { ProvisioningApplyException, ProvisioningInterrupted, terminalProvisioningState, type ProvisioningApplyRepository, type ProvisioningApplyOperation, type ProvisioningApplyStep } from "./provisioning-apply-contracts";
import type { RuntimeAttachmentPolicy } from "./runtime-attachment";
import { bytesHash, creationDigest, creationHash, manifestArtifacts, type ManagedCreatePreview, type ManagedCreationAdapter, type ManagedCreationRepository, type ManagedRuntimeDefinition, type FileEffectIntent } from "./managed-create";
import { ManagedFilesystem, canonicalManagedPath, existingStat, hashFile, identity, managedFailure, pathOverlaps, safeLeaf } from "./managed-filesystem";

type Repository = ProvisioningApplyRepository & ManagedCreationRepository;
export interface ManagedCreationOptions {
  now?: () => Date; leaseMs?: number; workerId?: string;
  afterStep?: (step: string) => Promise<void>;
  afterMutation?: (intent: FileEffectIntent) => void;
  duringCopy?: () => void;
  probe?: (port: number, address: string) => Promise<void>;
}
export interface ManagedActivation {
  activate(record: ManagedRuntimeDefinition, verify: () => Promise<void>, admit: () => boolean, publish: (mutation: () => void) => void): Promise<void>;
  detach(effectId: string, fence: (mutation: () => void) => void): void;
}
async function probeEndpoint(port: number, address: string): Promise<void> {
  const socket = net.createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", () => reject(new ProvisioningApplyException({ code: "ENDPOINT_OCCUPIED", message: "Endpoint availability check failed." })));
    socket.listen(port, address, () => socket.close((error) => error ? reject(error) : resolve()));
  });
}
const snapshot = <T>(value: T): T => freezeProvisioningData(JSON.parse(JSON.stringify(value))) as T;
export class ManagedCreationService {
  private readonly worker: string; private readonly now: () => Date; private readonly leaseMs: number;
  constructor(private readonly repo: Repository, private readonly planner: ProvisioningPlanner, private readonly adapter: ManagedCreationAdapter,
    private readonly activation: ManagedActivation, private readonly options: ManagedCreationOptions = {}) {
    this.worker = options.workerId ?? randomUUID(); this.now = options.now ?? (() => new Date()); this.leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0) throw new Error("Positive creation lease required.");
  }
  private clock() { const now = this.now(); return { now: now.toISOString(), expiresAt: new Date(now.getTime() + this.leaseMs).toISOString() }; }
  private guard<T>(op: ProvisioningApplyOperation, run: () => T): T { const time = this.clock(); return this.repo.managedGuard(op, time.now, time.expiresAt, run); }
  private assertCurrentProfile(preview: ManagedCreatePreview, policy: RuntimeAttachmentPolicy): void {
    const profile = policy.managedCreate?.profiles[preview.profileId];
    const acceptance = profile?.acceptanceRef ? policy.managedCreate?.acceptances[profile.acceptanceRef] : undefined;
    const storage = preview.plan.request.storage;
    if (!profile || storage.mode !== "create" || creationHash({ profile, acceptance: acceptance ?? null, rootId: storage.rootId, sources: policy.artifactLocations }) !== preview.policyHash) managedFailure("PLAN_STALE");
  }
  async preview(plan: ServerProvisioningPlan, policy: RuntimeAttachmentPolicy, resume?: ManagedCreatePreview): Promise<ManagedCreatePreview> {
    const request = parseProvisioningRequest(plan.request), expected = await this.planner.plan(request);
    if (canonicalProvisioningJson({ ...plan, createdAt: "" }) !== canonicalProvisioningJson({ ...expected, createdAt: "" })) managedFailure("PLAN_MISMATCH");
    if (request.storage.mode !== "create" || policy.hostId !== request.hostId || policy.managedCreate?.filesystem !== "local-exclusive") managedFailure("CREATE_UNSUPPORTED");
    const options = request.providerOptions ?? {}, profileId = options.profileRef;
    if (typeof profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profileId)) managedFailure("PROFILE_UNAVAILABLE");
    if (Object.keys(options).some((key) => !["profileRef", "worldName"].includes(key))) managedFailure("INVALID_CREATE_OPTIONS");
    const profile = Object.hasOwn(policy.managedCreate.profiles, profileId) ? policy.managedCreate.profiles[profileId] : undefined;
    if (!profile || profile.providerId !== request.providerId || !profile.revision) managedFailure("PROFILE_UNAVAILABLE");
    const acceptance = profile.acceptanceRef && Object.hasOwn(policy.managedCreate.acceptances, profile.acceptanceRef) ? policy.managedCreate.acceptances[profile.acceptanceRef] : undefined;
    if (profile.acceptanceRef && (!acceptance || acceptance.revoked || acceptance.authorizeGeneratedAcceptance !== true || !acceptance.actor?.trim() || !Number.isFinite(Date.parse(acceptance.acceptedAt)) || !acceptance.termsRef || !acceptance.revision || acceptance.hostId !== request.hostId || acceptance.profileId !== profileId || acceptance.profileRevision !== profile.revision || acceptance.serverId && acceptance.serverId !== plan.serverId)) managedFailure("LICENSE_ACCEPTANCE_REQUIRED");
    const manifest = this.adapter.manifest(request, snapshot(profile), acceptance && snapshot(acceptance));
    const rootReference = expected.managedPaths[0]?.reference;
    if (rootReference?.mode !== "create") managedFailure("CREATE_UNSUPPORTED");
    const root = Object.hasOwn(policy.managedRoots, rootReference.rootId) ? policy.managedRoots[rootReference.rootId] : undefined;
    if (!root) managedFailure("ROOT_UNAVAILABLE");
    const rootPath = canonicalManagedPath(root), rootStat = fs.lstatSync(rootPath);
    if (!rootStat.isDirectory()) managedFailure("ROOT_UNAVAILABLE");
    const leaf = rootReference.directoryName!; if (!safeLeaf(leaf)) managedFailure("UNSAFE_PATH");
    const runtimePath = path.join(rootPath, leaf);
    for (const location of [...policy.protectedPaths ?? [], ...policy.managedCreate.protectedPaths ?? [], ...Object.values(policy.adoptionLocations), ...Object.values(policy.artifactLocations)]) {
      if (!path.isAbsolute(location)) managedFailure("UNSAFE_PATH");
      const protectedPath = existingStat(location) ? canonicalManagedPath(location) : path.resolve(location);
      if (pathOverlaps(runtimePath, protectedPath)) managedFailure("PROTECTED_PATH");
    }
    if (existingStat(runtimePath) && (!resume || runtimePath !== resume.runtimePath)) managedFailure("PATH_COLLISION");
    const maxBytes = policy.managedCreate.maxArtifactBytes ?? 256 * 1024 * 1024;
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) managedFailure("PROFILE_UNAVAILABLE");
    const destinations = new Set<string>();
    const files = manifest.files.map((file) => {
      if (!safeLeaf(file.relativePath) || destinations.has(file.relativePath.toLowerCase()) || (file.sourceRef === undefined) === (file.content === undefined)) managedFailure("INVALID_MANIFEST");
      destinations.add(file.relativePath.toLowerCase());
      if (file.sourceRef) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(file.sourceRef) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) managedFailure("INVALID_MANIFEST");
        const source = Object.hasOwn(policy.artifactLocations, file.sourceRef) ? policy.artifactLocations[file.sourceRef] : undefined;
        if (!source || pathOverlaps(runtimePath, path.resolve(source))) managedFailure("ARTIFACT_UNAVAILABLE");
        const sourcePath = canonicalManagedPath(source), observed = hashFile(sourcePath, maxBytes);
        if (observed.sha256 !== file.sha256) managedFailure("ARTIFACT_DRIFT");
        return { ...file, sourcePath, sourceIdentity: observed.identity, size: observed.size, sha256: observed.sha256 };
      }
      if (Buffer.byteLength(file.content!) > 64 * 1024) managedFailure("INVALID_MANIFEST");
      return { ...file, size: Buffer.byteLength(file.content!), sha256: bytesHash(Buffer.from(file.content!)) };
    });
    if (!files.length || files.length > 16) managedFailure("INVALID_MANIFEST");
    let externalRuntime: ManagedCreatePreview["externalRuntime"];
    if (manifest.externalRuntime) {
      const reference = manifest.externalRuntime.reference, location = Object.hasOwn(policy.artifactLocations, reference) ? policy.artifactLocations[reference] : undefined;
      if (!location || pathOverlaps(runtimePath, path.resolve(location))) managedFailure("ARTIFACT_UNAVAILABLE");
      const observed = hashFile(location, maxBytes);
      if (observed.sha256 !== manifest.externalRuntime.sha256) managedFailure("ARTIFACT_DRIFT");
      externalRuntime = { ...manifest.externalRuntime, identity: observed.identity };
    }
    for (const endpoint of request.endpoints) {
      if (endpoint.transport === "virtual") continue;
      if (endpoint.transport !== "tcp" || endpoint.port.mode !== "fixed" || isIP(endpoint.bindAddress) !== 4) managedFailure("ENDPOINT_UNSUPPORTED");
      const port = endpoint.port.value;
      const inventory = await policy.endpointInventory?.();
      if (inventory?.complete !== true || !Array.isArray(inventory.bindings) || inventory.bindings.some((binding) => !["tcp", "udp"].includes(binding.transport) || !isIP(binding.bindAddress) || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65535)) managedFailure("ENDPOINT_AVAILABILITY_UNKNOWN");
      if (inventory.bindings.some((binding) => binding.hostId === request.hostId && binding.transport === endpoint.transport && binding.port === port)) managedFailure("ENDPOINT_OCCUPIED");
    }
    const policyHash = creationHash({ profile, acceptance: acceptance ?? null, rootId: request.storage.rootId, sources: policy.artifactLocations });
    const ownershipFile = { name: "ownership", relativePath: ".jbgh-owner.json", content: canonicalProvisioningJson({ schemaVersion: 1, operationId: `create_${plan.planId}`, serverId: plan.serverId, profileId, policyHash }) + "\n" };
    const allFiles = [{ ...ownershipFile, sha256: bytesHash(Buffer.from(ownershipFile.content)), size: Buffer.byteLength(ownershipFile.content) }, ...files];
    const candidate = { plan, profileId, policyHash, rootPath, rootIdentity: identity(fs.lstatSync(rootPath, { bigint: true })), runtimePath, leaf, files: allFiles, ...(manifest.worldName ? { worldName: manifest.worldName } : {}), ...(externalRuntime ? { externalRuntime } : {}) };
    return snapshot({ ...candidate, digest: creationDigest(candidate) });
  }
  private claims(preview: ManagedCreatePreview): ProvisioningApplyStep[] {
    const key = (...parts: string[]) => JSON.stringify(parts), plan = preview.plan;
    const steps: ProvisioningApplyStep[] = [
      { id: "claim-server", kind: "CLAIM_SERVER_ID", resourceKey: key("server", plan.serverId) },
      { id: "claim-path", kind: "CLAIM_MANAGED_PATH", resourceKey: key("physical-path", plan.request.hostId, process.platform === "win32" ? preview.runtimePath.toLowerCase() : preview.runtimePath) },
    ];
    for (const endpoint of plan.request.endpoints) steps.push({ id: "claim-endpoint-" + endpoint.id, kind: "CLAIM_ENDPOINT", resourceKey: endpoint.transport === "virtual" ? key("endpoint", plan.request.hostId, "virtual", plan.serverId, endpoint.id) : key("endpoint", plan.request.hostId, endpoint.transport, String(endpoint.port.mode === "fixed" ? endpoint.port.value : "unsupported")) });
    if (new Set(steps.map((step) => step.resourceKey)).size !== steps.length) managedFailure("ENDPOINT_OVERLAP");
    return steps;
  }
  async apply(input: { planId: string; digest: string; approved: true }, policy: RuntimeAttachmentPolicy, actor: string): Promise<ProvisioningApplyOperation> {
    if (input.approved !== true || !actor.trim()) managedFailure("APPROVAL_REQUIRED");
    const preview = this.repo.getManagedPreview(input.planId);
    if (!preview || input.digest !== preview.digest) managedFailure("APPROVAL_MISMATCH");
    const existing = this.repo.get(`create_${input.planId}`);
    if (existing) { if (existing.digest !== input.digest) managedFailure("APPROVAL_MISMATCH"); if (terminalProvisioningState(existing.result.state)) return existing; return this.recover(existing.operationId, policy); }
    if ((await this.preview(preview.plan, policy)).digest !== preview.digest) managedFailure("PLAN_STALE");
    const time = this.clock(), claims = this.claims(preview), plan = preview.plan;
    const candidate: ProvisioningApplyOperation = { executionKind: "managed-create", creation: preview, operationId: `create_${plan.planId}`, plan, digest: preview.digest, actor, steps: claims,
      result: { requestId: plan.requestId, planId: plan.planId, providerId: plan.providerId, serverId: plan.serverId, state: "PLANNED", outcome: "planned", issues: [] }, rollbackErrors: [], createdAt: time.now, updatedAt: time.now, lease: { owner: this.worker, token: 1, expiresAt: time.expiresAt } };
    const begun = this.repo.beginManaged(candidate, claims);
    if (!begun.acquired) return this.recover(begun.operation.operationId, policy);
    return this.run(begun.operation, policy);
  }
  async recover(operationId: string, policy: RuntimeAttachmentPolicy): Promise<ProvisioningApplyOperation> {
    const prior = this.repo.get(operationId);
    if (!prior || prior.executionKind !== "managed-create" || !prior.creation) managedFailure("OPERATION_NOT_FOUND");
    if (terminalProvisioningState(prior.result.state)) {
      if (prior.result.state === "PROVISIONED") await this.restore(prior, policy);
      return prior;
    }
    const time = this.clock(); return this.run(this.repo.acquire(operationId, this.worker, time.now, time.expiresAt), policy);
  }
  private async step(op: ProvisioningApplyOperation, intent: FileEffectIntent, gateway: ManagedFilesystem, policy: RuntimeAttachmentPolicy) {
    this.repo.intendFile(op, intent, this.clock().now);
    await this.options.afterStep?.("intent:" + intent.id);
    this.guard(op, () => {
      this.assertCurrentProfile(op.creation!, policy);
      const receipt = gateway.effect(intent, this.repo.fileReceipts(op.operationId), this.repo.fileIntents(op.operationId));
      this.options.afterMutation?.(intent);
      this.assertCurrentProfile(op.creation!, policy);
      this.repo.receiptFile(op, receipt, this.clock().now);
    });
    await this.options.afterStep?.(intent.id);
  }
  private async run(initial: ProvisioningApplyOperation, policy: RuntimeAttachmentPolicy): Promise<ProvisioningApplyOperation> {
    let op = initial;
    if (["FAILED", "ROLLING_BACK"].includes(op.result.state)) return this.rollback(op);
    op = this.repo.transition(op, "APPLYING", this.clock().now);
    const preview = op.creation!, gateway = new ManagedFilesystem(preview, this.options.duringCopy);
    try {
      await this.options.afterStep?.("claims");
      const fresh = await this.preview(preview.plan, policy, preview);
      if (fresh.digest !== preview.digest) managedFailure("ARTIFACT_DRIFT");
      for (const endpoint of preview.plan.request.endpoints) if (endpoint.transport !== "virtual" && endpoint.port.mode === "fixed") await (this.options.probe ?? probeEndpoint)(endpoint.port.value, endpoint.bindAddress);
      await this.step(op, { id: "directory", operationId: op.operationId, kind: "directory", relativePath: "" }, gateway, policy);
      for (let index = 0; index < preview.files.length; index++) {
        const file = preview.files[index], temp = ".jbgh-file-" + index;
        const receipts = this.repo.fileReceipts(op.operationId);
        const published = receipts.find((r) => r.intentId === `publish-${index}` && !r.compensated);
        if (published) {
          this.guard(op, () => gateway.inspect({ id: `publish-${index}`, operationId: op.operationId, kind: "publish", relativePath: file.relativePath }, published));
          await this.step(op, { id: `clean-${index}`, operationId: op.operationId, kind: "remove-temp", relativePath: temp, fileIndex: index, hash: file.sha256 }, gateway, policy);
          continue;
        }
        for (const [id, kind, relativePath] of [[`temp-${index}`, "temporary", temp], [`write-${index}`, "write", temp], [`publish-${index}`, "publish", file.relativePath], [`clean-${index}`, "remove-temp", temp]] as const) {
          await this.step(op, { id, operationId: op.operationId, kind, relativePath, fileIndex: index, hash: file.sha256 }, gateway, policy);
        }
      }
      const directory = this.repo.fileReceipts(op.operationId).find((r) => r.intentId === "directory")!;
      const definition: ManagedRuntimeDefinition = { effectId: `managed_${op.operationId}`, operationId: op.operationId, digest: op.digest, fencingToken: op.lease.token, attachedAt: op.createdAt, state: "PENDING_ACTIVATION",
        descriptor: { schemaVersion: 1, providerId: op.plan.providerId, serverId: op.plan.serverId, hostId: op.plan.request.hostId, runtimeRoot: preview.runtimePath, rootIdentity: directory.identity,
          ownership: "MANAGED", mode: "create", destructiveOwnership: false, profileId: preview.profileId, manifest: manifestArtifacts(preview), endpoints: op.plan.request.endpoints, worlds: [], verifiedAt: this.clock().now, issues: [] } };
      this.repo.journalManagedPhase(op, "DEFINITION_INTENT", "started", this.clock().now);
      this.guard(op, () => { this.assertCurrentProfile(preview, policy); this.repo.publishManagedDefinition(op, definition, this.clock().now); });
      await this.options.afterStep?.("definition");
      this.repo.journalManagedPhase(op, "ACTIVATION_INTENT", "started", this.clock().now);
      await this.activation.activate(definition, () => this.verify(op, policy), () => this.repo.get(op.operationId)?.result.state === "PROVISIONED" && this.repo.managedDefinitions().some((record) => record.operationId === op.operationId && record.state === "ACTIVE"), (mutation) => this.guard(op, mutation));
      this.repo.journalManagedPhase(op, "ACTIVATION_RECEIPT", "completed", this.clock().now);
      await this.options.afterStep?.("activation");
      this.repo.journalManagedPhase(op, "FINALIZE_INTENT", "started", this.clock().now);
      await this.options.afterStep?.("before-final");
      return this.guard(op, () => { this.assertCurrentProfile(preview, policy); return this.repo.finishManaged(op, this.clock().now); });
    } catch (error) {
      if (error instanceof ProvisioningInterrupted || error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST") throw error;
      const detail = error instanceof ProvisioningApplyException ? error.detail : { code: "CREATE_FAILED", message: "Managed creation could not complete." };
      op = this.repo.transition(op, "FAILED", this.clock().now, detail);
      return this.rollback(op);
    }
  }
  private async verify(op: ProvisioningApplyOperation, policy: RuntimeAttachmentPolicy): Promise<void> {
    if ((await this.preview(op.plan, policy, op.creation)).digest !== op.digest) managedFailure("ARTIFACT_DRIFT");
    const gateway = new ManagedFilesystem(op.creation!);
    const completed = this.repo.get(op.operationId)?.result.state === "PROVISIONED";
    for (const intent of this.repo.fileIntents(op.operationId).filter((i) => !i.direction && (i.kind === "directory" || i.kind === "publish"))) {
      const receipt = this.repo.fileReceipts(op.operationId).find((r) => r.intentId === intent.id && !r.compensated);
      if (!receipt) managedFailure("OWNERSHIP_UNVERIFIED");
      const file = intent.kind === "publish" ? op.creation!.files.find((file) => file.relativePath === intent.relativePath) : undefined;
      const validateContents = completed && file ? this.adapter.runtimeFileValidator?.(file) : undefined;
      gateway.inspect(intent, receipt, validateContents);
    }
  }
  private async restore(op: ProvisioningApplyOperation, policy: RuntimeAttachmentPolicy) {
    await this.verify(op, policy);
    const definition = this.repo.managedDefinitions().find((record) => record.operationId === op.operationId && record.state === "ACTIVE");
    if (!definition) managedFailure("OWNERSHIP_UNVERIFIED");
    await this.activation.activate(definition, () => this.verify(op, policy), () => this.repo.get(op.operationId)?.result.state === "PROVISIONED", (mutation) => this.repo.guardManagedDefinition(definition, mutation));
  }
  private rollback(initial: ProvisioningApplyOperation): ProvisioningApplyOperation {
    const op = this.repo.transition(initial, "ROLLING_BACK", this.clock().now), preview = op.creation!, gateway = new ManagedFilesystem(preview);
    const errors: Array<{ code: string; message: string }> = [];
    try {
      this.activation.detach(`managed_${op.operationId}`, (mutation) => this.guard(op, mutation));
      this.guard(op, () => this.repo.removeManagedDefinition(op, this.clock().now));
      const intents = this.repo.fileIntents(op.operationId).filter((intent) => !intent.direction), receipts = this.repo.fileReceipts(op.operationId);
      const directory = receipts.find((r) => r.intentId === "directory" && !r.compensated);
      if (directory && existingStat(preview.runtimePath)) this.guard(op, () => {
        gateway.inspect({ id: "directory", operationId: op.operationId, kind: "directory", relativePath: "" }, directory);
        const known = new Set(intents.map((intent) => intent.relativePath).filter(Boolean));
        if (fs.readdirSync(preview.runtimePath).some((leaf) => !known.has(leaf))) managedFailure("OWNERSHIP_UNVERIFIED");
      });
      for (const intent of [...intents].reverse()) {
        if (intent.kind === "write" || intent.kind === "remove-temp") continue;
        const receipt = receipts.find((r) => r.intentId === intent.id);
        if (receipt?.compensated) continue;
        if (!receipt) {
          if (existingStat(path.join(preview.runtimePath, intent.relativePath))) managedFailure("OWNERSHIP_UNVERIFIED");
          continue;
        }
        // The temporary file's latest durable write hash supersedes its initial empty hash.
        const effective = intent.kind === "temporary" ? receipts.find((r) => r.intentId === `write-${intent.fileIndex}`) ?? receipt : receipt;
        const compensation = { ...intent, id: "undo-" + intent.id, direction: "compensation" as const };
        this.repo.intendFile(op, compensation, this.clock().now);
        this.guard(op, () => { gateway.remove(intent, effective, directory); this.repo.receiptFile(op, { ...receipt, compensated: true }, this.clock().now); this.repo.receiptFile(op, { ...effective, intentId: compensation.id, compensated: true }, this.clock().now); });
      }
    } catch (error) {
      if (error instanceof ProvisioningInterrupted || error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST") throw error;
      errors.push({ code: error instanceof ProvisioningApplyException ? error.detail.code : "COMPENSATION_FAILED", message: "Managed resources retained; operator review required." });
    }
    return this.repo.finishRollback(op, this.clock().now, errors);
  }
}
