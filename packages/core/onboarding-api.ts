import { createHash } from "node:crypto";
import express from "express";
import { type ProvisioningApiOptions } from "./provisioning-api";
import { inspectHostReadiness, type HostReadinessInput, type ReadinessProbes } from "./host-readiness";
import type { InMemoryProviderManager } from "../provider-manager";

/** Adapts trusted configuration only. Absolute locations never leave this server boundary. */
export function readinessInput(options: ProvisioningApiOptions, manager: Pick<InMemoryProviderManager, "listProvisioningClaims" | "listManagedRuntimes" | "listRuntimeAttachments">): HostReadinessInput {
  const locations: HostReadinessInput["locations"] = [], endpoints: HostReadinessInput["endpoints"] = [];
  const opaque = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
  for (const [providerId, policy] of Object.entries(options.policies)) {
    // This slice observes this process's Windows host, never a different host's policy.
    if (policy.hostId !== "local") throw new Error("READINESS_HOST_UNSUPPORTED");
    for (const [rootId, location] of Object.entries(policy.managedRoots)) locations.push({ id: "storage." + opaque(providerId + ":" + rootId), path: location });
    for (const [profileId, profile] of Object.entries(policy.setup?.profiles ?? {})) {
      for (const endpoint of profile.endpoints) {
        if (endpoint.transport === "virtual" || endpoint.port?.mode !== "fixed") throw new Error("READINESS_CONFIGURATION_INVALID");
        endpoints.push({ id: "endpoint." + opaque(providerId + ":" + profileId + ":" + endpoint.id), hostId: policy.hostId, transport: endpoint.transport as "tcp" | "udp", bindAddress: endpoint.bindAddress!, port: endpoint.port.value });
      }
    }
  }
  const reservations: HostReadinessInput["reservations"] = [];
  for (const claim of manager.listProvisioningClaims()) {
    if (claim.state !== "active") continue;
    const key = JSON.parse(claim.resourceKey);
    if (Array.isArray(key) && key[0] === "endpoint") {
      if (typeof key[1] !== "string" || !["tcp", "udp"].includes(key[2]) || !/^[0-9]+$/.test(key[3]) || +key[3] < 1 || +key[3] > 65535) throw new Error("READINESS_CLAIM_INVALID");
      reservations.push({ hostId: key[1], transport: key[2], port: Number(key[3]) });
    }
  }
  return { locations, endpoints, reservations, configuration: { configured: Object.values(options.policies).some(policy => Object.keys(policy.managedRoots).length > 0 && Object.keys(policy.managedCreate?.profiles ?? {}).length > 0), managedRuntimeCount: manager.listManagedRuntimes().length, attachedRuntimeCount: manager.listRuntimeAttachments().length } };
}

export function onboardingRouter(manager: () => InMemoryProviderManager, options: () => ProvisioningApiOptions, probes: (selectedProvider?: string) => ReadinessProbes, context: () => { databasePath?: string } = () => ({})): express.Router {
  const router = express.Router();
  const inFlight = new Map<string, ReturnType<typeof inspectHostReadiness>>();
  router.use(async (req, res, next) => {
    try {
      const principal = await options().authorize(req);
      if (!principal?.admin) { res.status(principal ? 403 : 401).json({ error: { code: principal ? "FORBIDDEN" : "UNAUTHENTICATED", message: "Administrative authorization required." } }); return; }
      next();
    } catch { res.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization unavailable." } }); }
  });
  router.get("/readiness", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (Object.keys(req.query).some(key => key !== "provider") || req.query.provider !== undefined && !["minecraft", "minecraft-bedrock"].includes(req.query.provider as string)) { res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Readiness uses configured locations and supported providers only." } }); return; }
    const selected = req.query.provider as string | undefined;
    const key = selected ?? "any";
    try {
      if (!inFlight.has(key)) {
        const pending = inspectHostReadiness({ ...readinessInput(options(), manager()), ...context() }, probes(selected));
        inFlight.set(key, pending);
        void pending.finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); }).catch(() => {});
      }
      res.json(await inFlight.get(key));
    } catch { res.status(503).json({ error: { code: "READINESS_UNAVAILABLE", message: "Host readiness could not be inspected. Retry after checking host configuration." } }); }
  });
  router.all("/readiness", (_req, res) => { res.set("Allow", "GET").status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } }); });
  return router;
}
