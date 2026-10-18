import fs from "node:fs";
import path from "node:path";
import net, { isIP } from "node:net";
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import { canonicalProvisioningJson, freezeProvisioningData, parseProvisioningRequest, type ProvisioningPlanner, type ServerProvisioningPlan } from "./provisioning";
import { ProvisioningApplyException, ProvisioningInterrupted, terminalProvisioningState, type ProvisioningApplyRepository, type ProvisioningApplyOperation, type ProvisioningApplyStep } from "./provisioning-apply-contracts";
import type { RuntimeAttachmentPolicy } from "./runtime-attachment";
import { bytesHash, creationDigest, creationHash, manifestArtifacts, type ManagedCreatePreview, type ManagedCreationAdapter, type ManagedCreationRepository, type ManagedRuntimeDefinition, type FileEffectIntent, type ResolvedRuntimeBundle } from "./managed-create";
import { resolveRuntimeBundle } from "./managed-bundle";
import { ManagedFilesystem, canonicalManagedPath, existingStat, hashFile, identity, managedFailure, pathOverlaps, safeLeaf } from "./managed-filesystem";

type Repository = ProvisioningApplyRepository & ManagedCreationRepository;
export interface ManagedCreationOptions {
  now?: () => Date; leaseMs?: number; workerId?: string;
  afterStep?: (step: string) => Promise<void>;
  afterMutation?: (intent: FileEffectIntent) => void;
  duringCopy?: () => void;
  probe?: (port: number, address: string, transport?: "tcp" | "udp") => Promise<void>;
}
export interface ManagedActivation {
  activate(record: ManagedRuntimeDefinition, verify: () => Promise<void>, admit: () => boolean, publish: (mutation: () => void) => void): Promise<void>;
  detach(effectId: string, fence: (mutation: () => void) => void): void;
}
export async function probeManagedEndpoint(port: number, address: string, transport: "tcp" | "udp" = "tcp"): Promise<void> {
  if (transport === "udp") {
    const socket = dgram.createSocket({ type: isIP(address) === 6 ? "udp6" : "udp4", reuseAddr: false, ipv6Only: isIP(address) === 6 });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", () => {
        const failure = () => reject(new ProvisioningApplyException({ code: "ENDPOINT_OCCUPIED", message: "UDP endpoint availability check failed." }));
        try { socket.close(failure); } catch { failure(); }
      });
      socket.bind({ port, address, exclusive: true }, () => socket.close(resolve));
    });
    return;
  }
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
  private policyHash(profileId: string, rootId: string, policy: RuntimeAttachmentPolicy): string {
    const profile = policy.managedCreate?.profiles[profileId];
    const acceptance = profile?.acceptanceRef ? policy.managedCreate?.acceptances[profile.acceptanceRef] : undefined;
    return creationHash({ profile: profile ?? null, acceptance: acceptance ?? null, rootId, sources: policy.artifactLocations,
      ...(profile?.bundle ? { bundle: policy.managedCreate?.bundles?.[profile.bundle.reference] ?? null, bundleLocations: policy.managedCreate?.bundleLocations ?? null } : {}) });
  }
  private assertCurrentProfile(preview: ManagedCreatePreview, policy: RuntimeAttachmentPolicy): void {
    const profile = policy.managedCreate?.profiles[preview.profileId];
    const storage = preview.plan.request.storage;
    if (!profile || storage.mode !== "create" || this.policyHash(preview.profileId, storage.rootId, policy) !== preview.policyHash) managedFailure("PLAN_STALE");
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
    const approvedBundle = profile.bundle && Object.hasOwn(policy.managedCreate.bundles ?? {}, profile.bundle.reference) ? policy.managedCreate.bundles![profile.bundle.reference] : undefined;
    if (profile.bundle && !approvedBundle) managedFailure("BUNDLE_UNAVAILABLE");
    const manifest = this.adapter.manifest(request, snapshot(profile), acceptance && snapshot(acceptance), approvedBundle && snapshot(approvedBundle));
    const rootReference = expected.managedPaths[0]?.reference;
    if (rootReference?.mode !== "create") managedFailure("CREATE_UNSUPPORTED");
    const root = Object.hasOwn(policy.managedRoots, rootReference.rootId) ? policy.managedRoots[rootReference.rootId] : undefined;
    if (!root) managedFailure("ROOT_UNAVAILABLE");
    const rootPath = canonicalManagedPath(root), rootStat = fs.lstatSync(rootPath);
    if (!rootStat.isDirectory()) managedFailure("ROOT_UNAVAILABLE");
    const leaf = rootReference.directoryName!; if (!safeLeaf(leaf)) managedFailure("UNSAFE_PATH");
    const runtimePath = path.join(rootPath, leaf);
    for (const location of [...policy.protectedPaths ?? [], ...policy.managedCreate.protectedPaths ?? [], ...Object.values(policy.adoptionLocations), ...Object.values(policy.artifactLocations), ...Object.values(policy.managedCreate.bundleLocations ?? {})]) {
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
    let resolvedBundle: ResolvedRuntimeBundle | undefined;
    if (manifest.bundle) {
      if (!profile.bundle || canonicalProvisioningJson(manifest.bundle) !== canonicalProvisioningJson(profile.bundle) || !approvedBundle) managedFailure("INVALID_BUNDLE");
      const source = Object.hasOwn(policy.managedCreate.bundleLocations ?? {}, approvedBundle.sourceRef) ? policy.managedCreate.bundleLocations![approvedBundle.sourceRef] : undefined;
      if (!source) managedFailure("BUNDLE_UNAVAILABLE");
      resolvedBundle = resolveRuntimeBundle(snapshot(approvedBundle), manifest.bundle.digest, source, runtimePath, [".jbgh-owner.json", ...files.map((file) => file.relativePath)]);
    } else if (profile.bundle) managedFailure("INVALID_BUNDLE");
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
      if (endpoint.port.mode !== "fixed" || (endpoint.transport === "tcp" ? isIP(endpoint.bindAddress) !== 4 : endpoint.transport !== "udp" || !resolvedBundle || !isIP(endpoint.bindAddress))) managedFailure("ENDPOINT_UNSUPPORTED");
      const port = endpoint.port.value;
      const inventory = await policy.endpointInventory?.();
      if (inventory?.complete !== true || !Array.isArray(inventory.bindings) || inventory.bindings.some((binding) => !["tcp", "udp"].includes(binding.transport) || !isIP(binding.bindAddress) || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65535)) managedFailure("ENDPOINT_AVAILABILITY_UNKNOWN");
      if (inventory.bindings.some((binding) => binding.hostId === request.hostId && binding.transport === endpoint.transport && binding.port === port)) managedFailure("ENDPOINT_OCCUPIED");
    }
    const policyHash = this.policyHash(profileId, request.storage.rootId, policy);
    const ownershipFile = { name: "ownership", relativePath: ".jbgh-owner.json", content: canonicalProvisioningJson({ schemaVersion: 1, operationId: `create_${plan.planId}`, serverId: plan.serverId, profileId, policyHash }) + "\n" };
    const allFiles = [{ ...ownershipFile, sha256: bytesHash(Buffer.from(ownershipFile.content)), size: Buffer.byteLength(ownershipFile.content) }, ...files];
    const bundle = resolvedBundle ? { snapshotId: creationHash(resolvedBundle), manifestDigest: resolvedBundle.manifestDigest, version: resolvedBundle.manifest.version,
      fileCount: resolvedBundle.files.length, totalBytes: resolvedBundle.files.reduce((total, file) => total + file.size, 0), entrypoint: resolvedBundle.files.find((file) => file.relativePath === resolvedBundle!.manifest.entrypoint)! } : undefined;
    if (resolvedBundle && bundle) this.repo.saveManagedBundle(bundle.snapshotId, resolvedBundle);
    const candidate = { plan, profileId, policyHash, rootPath, rootIdentity: identity(fs.lstatSync(rootPath, { bigint: true })), runtimePath, leaf, files: allFiles, ...(manifest.worldName ? { worldName: manifest.worldName } : {}), ...(externalRuntime ? { externalRuntime } : {}), ...(bundle ? { bundle } : {}) };
    return snapshot({ ...candidate, digest: creationDigest(candidate) });
  }
  private executablePreview(preview: ManagedCreatePreview): { preview: ManagedCreatePreview; directories: string[] } {
    if (!preview.bundle) return { preview, directories: [] };
    const bundle = this.repo.getManagedBundle(preview.bundle.snapshotId);
    if (!bundle || bundle.manifestDigest !== preview.bundle.manifestDigest) managedFailure("BUNDLE_UNAVAILABLE");
    const immutable = bundle.files.filter((file) => bundle.manifest.files.find((entry) => entry.relativePath === file.relativePath)?.classification === "immutable-runtime");
    return { preview: { ...preview, files: [...preview.files, ...immutable] }, directories: bundle.directories };
  }
  private gateway(preview: ManagedCreatePreview, operationId: string): ManagedFilesystem {
    return new ManagedFilesystem(preview, this.options.duringCopy, () => {
      const receipts = this.repo.fileReceipts(operationId);
      return this.repo.fileIntents(operationId).filter((intent) => !intent.direction && intent.kind === "directory").flatMap((intent) => {
        const receipt = receipts.find((receipt) => receipt.intentId === intent.id && !receipt.compensated);
        return receipt ? [{ relativePath: intent.relativePath, receipt }] : [];
      });
    });
  }
  /** No runtime-generated output is authorized by stopped CREATE. A later boot receipt must grant it. */
  private inspectTree(preview: ManagedCreatePreview, operationId: string, gateway: ManagedFilesystem, final = false, inspect: (run: () => string[]) => string[] = (run) => run()): void {
    if (!preview.bundle || !existingStat(preview.runtimePath)) return;
    const intents = this.repo.fileIntents(operationId).filter((intent) => !intent.direction), receipts = this.repo.fileReceipts(operationId);
    const known = new Map(intents.map((intent) => [intent.relativePath, intent]));
    let count = 0;
    const walk = (relative: string) => {
      const children = inspect(() => {
        const intent = known.get(relative), receipt = receipts.find((receipt) => receipt.intentId === intent?.id && !receipt.compensated);
        if (!intent || intent.kind !== "directory" || !receipt) managedFailure("OWNERSHIP_UNVERIFIED");
        gateway.inspect(intent, receipt);
        return fs.readdirSync(path.join(preview.runtimePath, relative)).flatMap((name) => {
          if (++count > known.size) managedFailure("ARTIFACT_DRIFT");
          const child = relative ? relative + "/" + name : name, expected = known.get(child), stat = fs.lstatSync(path.join(preview.runtimePath, child));
          if (!expected || stat.isSymbolicLink() || final && !["directory", "publish"].includes(expected.kind)) managedFailure("ARTIFACT_DRIFT");
          if (stat.isDirectory()) return [child];
          if (expected.kind === "directory" || !stat.isFile()) managedFailure("ARTIFACT_DRIFT");
          return [];
        });
      });
      for (const child of children) walk(child);
    };
    walk("");
  }
  private async verifyForStart(op: ProvisioningApplyOperation, policy: RuntimeAttachmentPolicy): Promise<void> {
    await this.verify(op, policy);
    if (this.adapter.lifecycleDeferred) managedFailure("FIRST_BOOT_DEFERRED");
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
    if (prior.rollbackRecovery) return prior;
    if (terminalProvisioningState(prior.result.state)) {
      if (prior.result.state === "PROVISIONED") await this.restore(prior, policy);
      return prior;
    }
    const time = this.clock(); return this.run(this.repo.acquire(operationId, this.worker, time.now, time.expiresAt), policy);
  }
  async retryRollback(operationId: string, approval: { digest: string; approved: true }, policy: RuntimeAttachmentPolicy, actor: string): Promise<ProvisioningApplyOperation> {
    if (approval.approved !== true || !actor.trim()) managedFailure("APPROVAL_REQUIRED");
    const prior = this.repo.get(operationId);
    if (!prior || prior.executionKind !== "managed-create" || !prior.creation) managedFailure("OPERATION_NOT_FOUND");
    if (approval.digest !== prior.digest) managedFailure("APPROVAL_MISMATCH");
    if (prior.result.state === "ROLLED_BACK") return prior;
    // Rollback needs the persisted approval/receipts, not a new CREATE or renewed license acceptance.
    const preview = prior.creation, { digest, ...content } = preview, storage = preview.plan.request.storage;
    if (creationDigest(content) !== digest || digest !== prior.digest || storage.mode !== "create" || policy.hostId !== preview.plan.request.hostId || policy.managedCreate?.filesystem !== "local-exclusive") managedFailure("APPROVAL_MISMATCH");
    const root = policy.managedRoots[storage.rootId];
    if (!root || canonicalManagedPath(root) !== preview.rootPath || !safeLeaf(preview.leaf) || path.join(preview.rootPath, preview.leaf) !== preview.runtimePath) managedFailure("ROOT_DRIFT");
    for (const protectedPath of [...policy.protectedPaths ?? [], ...policy.managedCreate.protectedPaths ?? [], ...Object.values(policy.adoptionLocations), ...Object.values(policy.artifactLocations), ...Object.values(policy.managedCreate.bundleLocations ?? {})]) {
      if (!path.isAbsolute(protectedPath) || pathOverlaps(preview.runtimePath, existingStat(protectedPath) ? canonicalManagedPath(protectedPath) : path.resolve(protectedPath))) managedFailure("PROTECTED_PATH");
    }
    const time = this.clock(), op = this.repo.acquireRollback(operationId, approval.digest, actor, this.worker, time.now, time.expiresAt);
    return op.result.state === "ROLLED_BACK" ? op : this.rollback(op, true);
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
    const storedPreview = op.creation!, executable = this.executablePreview(storedPreview), preview = executable.preview, gateway = this.gateway(preview, op.operationId);
    try {
      await this.options.afterStep?.("claims");
      const fresh = await this.preview(preview.plan, policy, preview);
      if (fresh.digest !== preview.digest) managedFailure("ARTIFACT_DRIFT");
      for (const endpoint of preview.plan.request.endpoints) if (endpoint.transport !== "virtual" && endpoint.port.mode === "fixed") await (this.options.probe ?? probeManagedEndpoint)(endpoint.port.value, endpoint.bindAddress, endpoint.transport);
      const durable = new Map(this.repo.fileReceipts(op.operationId).map((receipt) => [receipt.intentId, receipt]));
      const fullyPublishedBundle = preview.bundle && ["directory", ...executable.directories.map((_, index) => `directory-${index}`), ...preview.files.flatMap((_, index) => [`publish-${index}`, `clean-${index}`])].every((id) => durable.has(id) && !durable.get(id)!.compensated);
      // A fully receipted bundle resumes at verification; hashes, identities, tree membership and
      // the current fence are all checked below before any definition can be published.
      if (!fullyPublishedBundle) {
        await this.step(op, { id: "directory", operationId: op.operationId, kind: "directory", relativePath: "" }, gateway, policy);
        for (const [index, relativePath] of executable.directories.entries()) await this.step(op, { id: `directory-${index}`, operationId: op.operationId, kind: "directory", relativePath }, gateway, policy);
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
      }
      if (preview.bundle) await this.verify(op, policy);
      const directory = this.repo.fileReceipts(op.operationId).find((r) => r.intentId === "directory")!;
      const definition: ManagedRuntimeDefinition = { effectId: `managed_${op.operationId}`, operationId: op.operationId, digest: op.digest, fencingToken: op.lease.token, attachedAt: op.createdAt, state: "PENDING_ACTIVATION",
        descriptor: { schemaVersion: 1, providerId: op.plan.providerId, serverId: op.plan.serverId, hostId: op.plan.request.hostId, runtimeRoot: preview.runtimePath, rootIdentity: directory.identity,
          ownership: "MANAGED", mode: "create", destructiveOwnership: false, profileId: preview.profileId, manifest: manifestArtifacts(storedPreview), endpoints: op.plan.request.endpoints, worlds: [], verifiedAt: this.clock().now, issues: [] } };
      this.repo.journalManagedPhase(op, "DEFINITION_INTENT", "started", this.clock().now);
      this.guard(op, () => { this.assertCurrentProfile(preview, policy); this.repo.publishManagedDefinition(op, definition, this.clock().now); });
      await this.options.afterStep?.("definition");
      this.repo.journalManagedPhase(op, "ACTIVATION_INTENT", "started", this.clock().now);
      await this.activation.activate(definition, () => this.verifyForStart(op, policy), () => this.repo.get(op.operationId)?.result.state === "PROVISIONED" && this.repo.managedDefinitions().some((record) => record.operationId === op.operationId && record.state === "ACTIVE"), (mutation) => this.guard(op, mutation));
      this.repo.journalManagedPhase(op, "ACTIVATION_RECEIPT", "completed", this.clock().now);
      await this.options.afterStep?.("activation");
      this.repo.journalManagedPhase(op, "FINALIZE_INTENT", "started", this.clock().now);
      await this.options.afterStep?.("before-final");
      if (preview.bundle) await this.verify(op, policy);
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
    const executable = this.executablePreview(op.creation!), preview = executable.preview;
    const completed = this.repo.get(op.operationId)?.result.state === "PROVISIONED";
    const intents = this.repo.fileIntents(op.operationId).filter((i) => !i.direction && (i.kind === "directory" || i.kind === "publish"));
    // One durable ownership snapshot per verification pass. Every physical identity/hash is still
    // checked, and an in-progress apply rechecks/renews its fence for each bounded read.
    const receipts = new Map(this.repo.fileReceipts(op.operationId).map((receipt) => [receipt.intentId, receipt]));
    const directories = intents.filter((intent) => intent.kind === "directory").flatMap((intent) => {
      const receipt = receipts.get(intent.id);
      return receipt && !receipt.compensated ? [{ relativePath: intent.relativePath, receipt }] : [];
    });
    const gateway = new ManagedFilesystem(preview, undefined, () => directories);
    const inspect = <T>(run: () => T): T => completed ? run() : this.guard(op, run);
    if (preview.bundle && (preview.files.some((file) => !intents.some((intent) => intent.kind === "publish" && intent.relativePath === file.relativePath)) || ["", ...executable.directories].some((relative) => !intents.some((intent) => intent.kind === "directory" && intent.relativePath === relative)))) managedFailure("OWNERSHIP_UNVERIFIED");
    for (const intent of intents) {
      const receipt = receipts.get(intent.id);
      if (!receipt || receipt.compensated) managedFailure("OWNERSHIP_UNVERIFIED");
      const file = intent.kind === "publish" ? preview.files.find((file) => file.relativePath === intent.relativePath) : undefined;
      const validateContents = completed && file ? this.adapter.runtimeFileValidator?.(file) : undefined;
      inspect(() => gateway.inspect(intent, receipt, validateContents, completed && Boolean(preview.bundle)));
    }
    this.inspectTree(preview, op.operationId, gateway, true, inspect);
  }
  private async restore(op: ProvisioningApplyOperation, policy: RuntimeAttachmentPolicy) {
    await this.verify(op, policy);
    const definition = this.repo.managedDefinitions().find((record) => record.operationId === op.operationId && record.state === "ACTIVE");
    if (!definition) managedFailure("OWNERSHIP_UNVERIFIED");
    await this.activation.activate(definition, () => this.verifyForStart(op, policy), () => this.repo.get(op.operationId)?.result.state === "PROVISIONED", (mutation) => this.repo.guardManagedDefinition(definition, mutation));
  }
  private async rollback(initial: ProvisioningApplyOperation, explicit = false): Promise<ProvisioningApplyOperation> {
    const op = this.repo.transition(initial, "ROLLING_BACK", this.clock().now);
    const errors: Array<{ code: string; message: string }> = [];
    try {
      const preview = explicit ? this.executablePreview(op.creation!).preview : op.creation!, gateway = this.gateway(preview, op.operationId);
      this.activation.detach(`managed_${op.operationId}`, (mutation) => this.guard(op, mutation));
      this.guard(op, () => this.repo.removeManagedDefinition(op, this.clock().now));
      const intents = this.repo.fileIntents(op.operationId).filter((intent) => !intent.direction), receipts = this.repo.fileReceipts(op.operationId);
      const directory = receipts.find((r) => r.intentId === "directory" && !r.compensated);
      const effectiveReceipt = (intent: FileEffectIntent, receipt: (typeof receipts)[number]) => {
        if (intent.kind !== "temporary") return receipt;
        const written = receipts.find((r) => r.intentId === `write-${intent.fileIndex}`);
        if (written || !explicit || !existingStat(path.join(preview.runtimePath, intent.relativePath))) return written ?? receipt;
        try { gateway.inspectRollback(intent, receipt); return receipt; }
        catch (error) { if (!(error instanceof ProvisioningApplyException) || error.detail.code !== "ARTIFACT_DRIFT") throw error; }
        const write = intents.find((i) => i.id === `write-${intent.fileIndex}`);
        if (!write || write.kind !== "write" || write.relativePath !== intent.relativePath || write.hash !== intent.hash || intents.some((i) => i.id === `publish-${intent.fileIndex}`)) managedFailure("OWNERSHIP_UNVERIFIED");
        return gateway.partialScratchReceipt(intent, receipt);
      };
      if (explicit && existingStat(preview.runtimePath) && !directory) managedFailure("OWNERSHIP_UNVERIFIED");
      if (directory && existingStat(preview.runtimePath)) this.guard(op, () => {
        gateway.inspect({ id: "directory", operationId: op.operationId, kind: "directory", relativePath: "" }, directory);
        if (preview.bundle) this.inspectTree(preview, op.operationId, gateway);
        else {
          const known = new Set(intents.map((intent) => intent.relativePath).filter(Boolean));
          if (fs.readdirSync(preview.runtimePath).some((leaf) => !known.has(leaf))) managedFailure("OWNERSHIP_UNVERIFIED");
        }
      });
      if (explicit) this.guard(op, () => {
        // Verify the entire retained tree before the first deletion, then recheck each effect at removal.
        for (const intent of intents) {
          if (intent.kind === "write" || intent.kind === "remove-temp") continue;
          const receipt = receipts.find((r) => r.intentId === intent.id), present = existingStat(path.join(preview.runtimePath, intent.relativePath));
          if (!present) continue;
          if (!receipt || receipt.compensated) managedFailure("OWNERSHIP_UNVERIFIED");
          const effective = effectiveReceipt(intent, receipt);
          gateway.inspectRollback(intent, effective);
        }
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
        const compensation = { ...intent, id: "undo-" + intent.id, direction: "compensation" as const };
        this.repo.intendFile(op, compensation, this.clock().now);
        this.guard(op, () => { const effective = effectiveReceipt(intent, receipt); gateway.remove(intent, effective, directory); this.repo.receiptFile(op, { ...receipt, compensated: true }, this.clock().now); this.repo.receiptFile(op, { ...effective, intentId: compensation.id, compensated: true }, this.clock().now); });
        if (explicit) await this.options.afterStep?.(compensation.id);
      }
    } catch (error) {
      if (error instanceof ProvisioningInterrupted || error instanceof ProvisioningApplyException && error.detail.code === "LEASE_LOST") throw error;
      errors.push({ code: error instanceof ProvisioningApplyException ? error.detail.code : "COMPENSATION_FAILED", message: "Managed resources retained; operator review required." });
    }
    return this.repo.finishRollback(op, this.clock().now, errors);
  }
}
