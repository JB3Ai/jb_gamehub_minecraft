import { createHash } from "node:crypto";
import express from "express";
import { type ProvisioningApiOptions } from "./provisioning-api";
import { inspectHostReadiness, type HostReadinessInput, type ReadinessProbes } from "./host-readiness";
import type { InMemoryProviderManager } from "../provider-manager";
import { SetupConfigurationError, parseSetupConfiguration, publicSetupConfiguration, validateSetupConfiguration, type SetupCatalog, type SetupConfigurationRepository, type SetupConfigurationProbes } from "./setup-configuration";
import { OnboardingError, publicOnboarding } from "./onboarding";

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

export interface SetupConfigurationContext { catalog: SetupCatalog; repository: SetupConfigurationRepository; probes: SetupConfigurationProbes }
export function onboardingRouter(manager: () => InMemoryProviderManager, options: () => ProvisioningApiOptions, probes: (selectedProvider?: string) => ReadinessProbes, context: () => { databasePath?: string } = () => ({}), configuration?: () => SetupConfigurationContext): express.Router {
  const router = express.Router();
  const inFlight = new Map<string, ReturnType<typeof inspectHostReadiness>>();
  router.use(async (req, res, next) => {
    try {
      const principal = await options().authorize(req);
      if (!principal?.admin) { res.status(principal ? 403 : 401).json({ error: { code: principal ? "FORBIDDEN" : "UNAUTHENTICATED", message: "Administrative authorization required." } }); return; }
      res.locals.setupPrincipal = principal;
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
  const fault = (res: express.Response, error: unknown) => {
    const code = error instanceof SetupConfigurationError || error instanceof OnboardingError ? error.code : "CONFIGURATION_UNAVAILABLE";
    res.status(error instanceof SetupConfigurationError || error instanceof OnboardingError ? error.status : 503).json({ error: { code, message: code === "CONFIGURATION_STALE" || code === "CATALOG_STALE" ? "Host settings changed. Reload configuration and review before saving." : code === "ONBOARDING_NOT_READY" ? "Host readiness or configuration needs attention before setup can complete." : "Host configuration could not be saved. Review the approved choices and retry." } });
  };
  router.use("/configuration", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/configuration", (req, res) => {
    try {
      if (Object.keys(req.query).length) throw new SetupConfigurationError("INVALID_CONFIGURATION");
      if (!configuration) throw new SetupConfigurationError("CONFIGURATION_UNAVAILABLE", 503);
      const { catalog, repository } = configuration(); res.json({ ...publicSetupConfiguration(catalog, repository.read()), onboardingComplete: repository.onboarding().status === "READY" });
    } catch (error) { fault(res, error); }
  });
  router.post("/configuration", async (req, res) => {
    try {
      if (Object.keys(req.query).length) throw new SetupConfigurationError("INVALID_CONFIGURATION");
      if (!configuration) throw new SetupConfigurationError("CONFIGURATION_UNAVAILABLE", 503);
      const request = parseSetupConfiguration(req.body), { catalog, repository, probes } = configuration();
      if (request.catalogDigest !== catalog.digest) throw new SetupConfigurationError("CATALOG_STALE", 409);
      if (request.expectedRevision !== (repository.read()?.revision ?? 0)) throw new SetupConfigurationError("CONFIGURATION_STALE", 409);
      const warnings = await validateSetupConfiguration(request.settings, catalog, probes);
      if (configuration().catalog.digest !== catalog.digest) throw new SetupConfigurationError("CATALOG_STALE", 409);
      const result = repository.save(request.settings, request.expectedRevision, catalog.digest, res.locals.setupPrincipal.actor, new Date().toISOString());
      res.json({ ...publicSetupConfiguration(catalog, result.record), onboardingComplete: repository.onboarding().status === "READY", unchanged: result.unchanged, warnings });
    } catch (error) { fault(res, error); }
  });
  router.all("/configuration", (_req, res) => { res.set("Allow", "GET, POST").status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } }); });
  router.use("/onboarding", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/onboarding", (req, res) => {
    try {
      if (Object.keys(req.query).length) throw new SetupConfigurationError("INVALID_CONFIGURATION");
      if (!configuration) throw new SetupConfigurationError("CONFIGURATION_UNAVAILABLE", 503);
      const { repository } = configuration(); res.json(publicOnboarding(repository.onboarding(), repository.read()?.revision ?? 0));
    } catch (error) { fault(res, error); }
  });
  router.post("/onboarding/complete", async (req, res) => {
    try {
      if (Object.keys(req.query).length || !req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== "configurationRevision") || !Number.isSafeInteger(req.body.configurationRevision) || req.body.configurationRevision < 1) throw new SetupConfigurationError("INVALID_CONFIGURATION");
      if (!configuration) throw new SetupConfigurationError("CONFIGURATION_UNAVAILABLE", 503);
      const selected = configuration(), record = selected.repository.read();
      if (!record) throw new OnboardingError("ONBOARDING_NOT_READY");
      if (record.revision !== req.body.configurationRevision) throw new OnboardingError("CONFIGURATION_STALE");
      if (record.schemaVersion !== 1 || record.configuredEnoughToProceed !== true || record.catalogDigest !== selected.catalog.digest) throw new OnboardingError("ONBOARDING_NOT_READY");
      try { await validateSetupConfiguration(record, selected.catalog, selected.probes); }
      catch (error) { if (error instanceof SetupConfigurationError) throw new OnboardingError("ONBOARDING_NOT_READY"); throw error; }
      // Fresh host/selected-reference observation, with no Java version command or BDS launch.
      const readiness = await inspectHostReadiness({ ...readinessInput(options(), manager()), ...context() }, { ...probes(), runtimes: async () => [] });
      if (readiness.status === "BLOCKED" || configuration().catalog.digest !== selected.catalog.digest) throw new OnboardingError("ONBOARDING_NOT_READY");
      const result = selected.repository.completeOnboarding(record.revision, selected.catalog.digest, res.locals.setupPrincipal.actor, new Date().toISOString());
      res.json(publicOnboarding(result, selected.repository.read()?.revision ?? 0));
    } catch (error) { fault(res, error); }
  });
  router.all("/onboarding", (_req, res) => { res.set("Allow", "GET").status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } }); });
  router.all("/onboarding/complete", (_req, res) => { res.set("Allow", "POST").status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } }); });
  return router;
}
