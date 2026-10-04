import path from "node:path";
import { lstat } from "node:fs/promises";
import { isIP } from "node:net";
import { canonicalProvisioningJson, freezeProvisioningData, parseProvisioningRequest, type ProvisioningIssue, type ProvisioningPlanner, type ServerProvisioningPlan } from "./provisioning";

export interface EndpointBinding { hostId: string; transport: "tcp" | "udp"; bindAddress: string; port: number }
/** Trusted operator policy, not client-supplied plan data. Inventories are point-in-time only. */
export interface ProvisioningPreflightContext {
  hostId: string;
  managedRoots: Record<string, string>;
  adoptionLocations: Record<string, string>;
  artifactLocations: Record<string, string>;
  protectedPaths?: string[];
  endpointInventory?: () => Promise<{ complete: boolean; bindings: EndpointBinding[] }>;
}
export interface ProvisioningPreflightResult {
  planId: string;
  status: "PASS" | "WARN" | "FAIL";
  issues: readonly ProvisioningIssue[];
}
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};
async function inspect(location: string) {
  if (!path.isAbsolute(location)) throw new Error("Policy paths must be absolute.");
  const absolute = path.resolve(location);
  const root = path.parse(absolute).root;
  let current = root;
  let stat = await lstat(root);
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { stat = await lstat(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    if (stat.isSymbolicLink()) throw new Error("Symlink/junction paths are not approved for preflight.");
  }
  return stat;
}
const address = (value: string) => isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value.toLowerCase();
const overlap = (a: EndpointBinding, b: EndpointBinding) => a.hostId === b.hostId && a.transport === b.transport && a.port === b.port &&
  (address(a.bindAddress) === address(b.bindAddress) || [a.bindAddress, b.bindAddress].some((v) => v === "0.0.0.0" || address(v) === "[::]" || address(v).startsWith("[::ffff:") || !isIP(v)));

export async function preflightProvisioning(plan: ServerProvisioningPlan, planner: ProvisioningPlanner | undefined, context: ProvisioningPreflightContext): Promise<ProvisioningPreflightResult> {
  const issues: ProvisioningIssue[] = [];
  const issue = (code: string, field: string, message: string, severity: "blocking" | "warning" = "blocking") => issues.push({ code, field, message, severity });
  const finish = (): ProvisioningPreflightResult => freezeProvisioningData({ planId: plan.planId, status: issues.some((i) => i.severity === "blocking") ? "FAIL" : issues.length ? "WARN" : "PASS", issues });
  if (!planner?.profileAdapter) { issue("PROFILE_UNAVAILABLE", "providerId", "Provider planning/preflight profile is unavailable."); return finish(); }
  try {
    const request = parseProvisioningRequest(plan.request);
    const expected = await planner.plan(request);
    if (canonicalProvisioningJson({ ...expected, createdAt: "" }) !== canonicalProvisioningJson({ ...plan, createdAt: "" })) {
      issue("PLAN_MISMATCH", "plan", "Plan does not match the current provider planner."); return finish();
    }
    const profile = planner.profileAdapter.profile();
    if (profile.providerId !== request.providerId || !profile.supportedModes.includes(request.storage.mode)) issue("UNSUPPORTED_MODE", "storage.mode", "Profile does not support this request.");
    if (context.hostId !== request.hostId) issue("HOST_MISMATCH", "hostId", "Preflight policy belongs to another host.");
    for (const required of profile.requiredEndpoints) {
      if (!request.endpoints.some((endpoint) => endpoint.id === required.id && endpoint.protocol === required.protocol && endpoint.transport === required.transport)) issue("REQUIRED_ENDPOINT", "endpoints", `Required endpoint '${required.id}' is missing or incompatible.`);
    }
    const requirements = planner.profileAdapter.requirements(request);
    issues.push(...requirements.issues);
    let target: string | undefined;
    try {
      const storage = expected.managedPaths[0].reference;
      if (storage.mode === "create") {
        const root = Object.hasOwn(context.managedRoots, storage.rootId) ? context.managedRoots[storage.rootId] : undefined;
        if (!root || !(await inspect(root))?.isDirectory()) throw new Error("Approved managed root is missing or not a directory.");
        target = path.resolve(root, storage.directoryName!);
        if (!inside(root, target) || target === path.resolve(root)) throw new Error("Target must be a child of the approved managed root.");
        if (await inspect(target)) issue("PATH_COLLISION", "storage", "Create target already exists; no ownership or resume authority is inferred.");
      } else {
        target = Object.hasOwn(context.adoptionLocations, storage.locationRef) ? context.adoptionLocations[storage.locationRef] : undefined;
        if (!target || !(await inspect(target))?.isDirectory()) throw new Error("Approved adoption directory is missing.");
      }
      for (const protectedPath of context.protectedPaths ?? []) {
        await inspect(protectedPath);
        if (inside(protectedPath, target!) || inside(target!, protectedPath)) issue("PROTECTED_PATH", "storage", "Target overlaps protected storage.");
      }
    } catch (error) { issue("UNSAFE_PATH", "storage", (error as Error).message); target = undefined; }
    for (const artifact of requirements.artifacts) {
      try {
        let location: string | undefined;
        if (artifact.source === "target") {
          if (!target) continue;
          location = path.resolve(target, artifact.relativePath);
          if (!inside(target, location) || location === path.resolve(target)) throw new Error("Artifact escapes target.");
        } else location = Object.hasOwn(context.artifactLocations, artifact.reference) ? context.artifactLocations[artifact.reference] : undefined;
        if (!location || !(await inspect(location))?.isFile()) throw new Error(`Required artifact '${artifact.id}' is missing or not a regular file.`);
      } catch (error) { issue("ARTIFACT_UNAVAILABLE", `artifacts.${artifact.id}`, (error as Error).message); }
    }
    const requested: EndpointBinding[] = [];
    for (const endpoint of request.endpoints) {
      if (endpoint.transport === "virtual") continue;
      if (!isIP(endpoint.bindAddress)) issue("ADDRESS_UNVERIFIED", `endpoints.${endpoint.id}`, "Use a literal IP address for deterministic availability checking.");
      if (endpoint.port.mode === "allocate") { issue("ALLOCATION_DEFERRED", `endpoints.${endpoint.id}`, "No port is allocated in read-only preflight.", "warning"); continue; }
      const binding = { hostId: request.hostId, transport: endpoint.transport, bindAddress: endpoint.bindAddress, port: endpoint.port.value };
      if (requested.some((other) => overlap(other, binding))) issue("DUPLICATE_ENDPOINT", `endpoints.${endpoint.id}`, "Requested endpoints overlap.");
      requested.push(binding);
    }
    if (requested.length) {
      try {
        const inventory = await context.endpointInventory?.();
        if (!inventory || !inventory.complete) issue("ENDPOINT_AVAILABILITY_UNKNOWN", "endpoints", "Endpoint inventory is incomplete; availability is unverified.", "warning");
        for (const binding of inventory?.bindings ?? []) {
          if (!isIP(binding.bindAddress) || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65535 || !["tcp", "udp"].includes(binding.transport)) throw new Error("Invalid endpoint inventory.");
          if (requested.some((requestedBinding) => overlap(requestedBinding, binding))) issue("ENDPOINT_OCCUPIED", "endpoints", "Endpoint overlaps an existing binding.");
        }
      } catch (error) { issue("ENDPOINT_INSPECTION_FAILED", "endpoints", (error as Error).message); }
    }
  } catch (error) {
    const structured = (error as { issues?: ProvisioningIssue[] }).issues;
    if (structured) issues.push(...structured);
    else issue("INVALID_PLAN", "plan", (error as Error).message);
  }
  return finish();
}
