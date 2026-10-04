import { createHash } from "node:crypto";
import {
  canonicalProvisioningJson,
  freezeProvisioningData,
  parseProvisioningRequest,
  ProvisioningCapabilityError,
  ProvisioningValidationError,
  type ProvisioningPlanner,
  type ProvisioningPlannedOperation,
  type ServerProvisioningPlan,
  type ServerProvisioningRequest,
} from "./provisioning";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Descriptive plans only: no resource inspection, reservation, registration or execution. */
export class DescriptiveProvisioningPlanner implements ProvisioningPlanner {
  private readonly plans = new Map<string, ServerProvisioningPlan>();

  constructor(
    private readonly providerId: string,
    private readonly adapterVersion: string,
    private readonly label: string,
    private readonly now: () => Date = () => new Date(),
    readonly profileAdapter?: import("./provisioning-profile").ProvisioningProfileAdapter,
  ) {}

  async plan(input: ServerProvisioningRequest): Promise<ServerProvisioningPlan> {
    const request = parseProvisioningRequest(input);
    if (request.providerId !== this.providerId) throw new ProvisioningCapabilityError(request.providerId);
    const requirements = this.profileAdapter?.requirements(request);
    if (requirements?.issues.some((issue) => issue.severity === "blocking")) throw new ProvisioningValidationError(requirements.issues);
    const requestHash = hash(canonicalProvisioningJson(request));
    const cached = this.plans.get(requestHash);
    if (cached) return cached;
    const serverId = request.serverId ?? `server_${requestHash.slice(0,24)}`;
    const storage = request.storage.mode === "create"
      ? { ...request.storage, directoryName: request.storage.directoryName ?? `server-${requestHash.slice(0,24)}` }
      : request.storage;
    const operations: ProvisioningPlannedOperation[] = [];
    const add = (kind: ProvisioningPlannedOperation["kind"], resourceRef: string, description: string) => {
      operations.push({
        id: `step_${operations.length + 1}`,
        kind,
        resourceRef,
        description,
        dependsOn: operations.length ? [operations[operations.length - 1].id] : [],
        descriptiveOnly: true,
      });
    };
    if (storage.mode === "create") {
      add("CREATE_MANAGED_DIRECTORY", storage.rootId, `Would create managed directory '${storage.directoryName}' under root reference '${storage.rootId}'.`);
      add("WRITE_CONFIGURATION", serverId, `Would write ${this.label.toLowerCase()} configuration into the new managed directory.`);
    } else {
      add("INSPECT_EXISTING_RUNTIME", storage.locationRef, "Would inspect the referenced existing runtime without altering it.");
    }
    for (const endpoint of request.endpoints) add("RESERVE_ENDPOINT", endpoint.id, "Would reserve the endpoint; no allocation or conflict check has occurred.");
    add("REGISTER_SERVER", serverId, "Would attach a server to the existing provider; registry is unchanged.");
    const plan = freezeProvisioningData({
      schemaVersion: 1 as const,
      requestId: `request_${requestHash}`,
      planId: `plan_${hash(`${this.adapterVersion}:${requestHash}`)}`,
      serverId,
      providerId: request.providerId,
      adapterVersion: this.adapterVersion,
      mode: storage.mode,
      displayName: request.displayName ?? serverId,
      request,
      managedPaths: [{ ownership: storage.mode === "create" ? "managed" as const : "external" as const, reference: storage, resolved: false as const }],
      endpoints: request.endpoints.map((endpoint) => ({ hostId: request.hostId, request: endpoint, status: "unreserved" as const })),
      operations,
      warnings: [{ code: "PLANNING_ONLY", severity: "warning" as const, field: "plan", message: `${this.label} preview only. Paths and endpoint availability are unverified; no resources have been changed or reserved.` }],
      validation: { valid: true, errors: [] },
      status: "planned" as const,
      createdAt: this.now().toISOString(),
      requiresApproval: true as const,
    });
    this.plans.set(requestHash, plan);
    return plan;
  }
}
