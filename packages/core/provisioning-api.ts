import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import express from "express";
import type { InMemoryProviderManager } from "../provider-manager";
import { ProvisioningCapabilityError, ProvisioningValidationError } from "./provisioning";
import { ProvisioningApplyException, provisioningDigest } from "./provisioning-apply-contracts";
import type { RuntimeAttachmentPolicy, RuntimeAttachmentRecord, RuntimeAttachmentPreview } from "./runtime-attachment";

export interface AdminPrincipal { actor: string; admin: boolean }
export interface ProvisioningApiOptions {
  authorize: (request: express.Request) => AdminPrincipal | undefined | Promise<AdminPrincipal | undefined>;
  policies: Record<string, RuntimeAttachmentPolicy>;
}
export function tokenAdminAuthorizer(token?: string): ProvisioningApiOptions["authorize"] {
  return (request) => {
    if (!token || token.length < 32) return undefined;
    const authorization = request.get("authorization"); if (!authorization?.startsWith("Bearer ")) return undefined;
    const hash = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(hash(token), hash(authorization.slice(7))) ? { actor: "provisioning-admin", admin: true } : undefined;
  };
}
export async function provisioningApiOptionsFromEnvironment(): Promise<ProvisioningApiOptions> {
  const file = process.env.GAMEHUB_PROVISIONING_POLICY_FILE;
  return { authorize: tokenAdminAuthorizer(process.env.GAMEHUB_ADMIN_TOKEN), policies: file ? JSON.parse(await fs.readFile(file, "utf8")) : {} };
}
export async function authorizeProvisioning(request: express.Request, response: express.Response, manager: InMemoryProviderManager, options: ProvisioningApiOptions): Promise<AdminPrincipal | undefined> {
  let principal: AdminPrincipal | undefined;
  try { principal = await options.authorize(request); } catch { principal = undefined; }
  await manager.writeAudit({ actor: principal?.actor || "anonymous", action: "provisioning.authorization", result: principal?.admin ? "completed" : "failed", metadata: { authorized: principal?.admin === true, method: request.method } });
  if (!principal?.admin) { response.status(principal ? 403 : 401).json({ error: { code: principal ? "FORBIDDEN" : "UNAUTHENTICATED", message: "Administrative authorization required." } }); return undefined; }
  return principal;
}
class ApiFault extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new ApiFault(400, "INVALID_REQUEST");
  return value as Record<string, unknown>;
}
function publicPreview(preview: RuntimeAttachmentPreview) {
  const d = preview.descriptor;
  return { digest: preview.digest, providerId: d.providerId, serverId: d.serverId, ownership: d.ownership, destructiveOwnership: d.destructiveOwnership, verifiedAt: d.verifiedAt, manifest: d.manifest, endpoints: d.endpoints, worlds: d.worlds };
}
function publicAttachment(record: RuntimeAttachmentRecord) {
  return { id: record.effectId, operationId: record.operationId, ...publicPreview({ descriptor: record.descriptor, digest: record.digest } as RuntimeAttachmentPreview) };
}
/** Handlers delegate to ProviderManager; absolute roots, raw errors and launch configuration stay private. */
export function provisioningRouter(manager: () => InMemoryProviderManager, options: () => ProvisioningApiOptions): express.Router {
  const router = express.Router();
  router.use(async (req, res, next) => { try { const principal = await authorizeProvisioning(req, res, manager(), options()); if (principal) { res.locals.principal = principal; next(); } } catch { res.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization unavailable." } }); } });
  const route = (handler: (req: express.Request, res: express.Response) => Promise<void>) => async (req: express.Request, res: express.Response) => {
    try { await handler(req, res); } catch (error) {
      const code = error instanceof ApiFault ? error.code : error instanceof ProvisioningValidationError ? "INVALID_REQUEST" : error instanceof ProvisioningCapabilityError ? "UNSUPPORTED_PROVIDER" : error instanceof ProvisioningApplyException ? error.detail.code : "PROVISIONING_FAILED";
      const status = error instanceof ApiFault ? error.status : error instanceof ProvisioningValidationError ? 400 : /CONFLICT|MISMATCH|DRIFT|IN_PROGRESS|LEASE/.test(code) ? 409 : 422;
      res.status(status).json({ error: { code, message: "Provisioning request could not be completed." } });
    }
  };
  const stored = (id: unknown) => { if (typeof id !== "string") throw new ApiFault(400, "PLAN_ID_REQUIRED"); const value = manager().getProvisioningPlan(id); if (!value) throw new ApiFault(404, "PLAN_NOT_FOUND"); return value; };
  const policy = (providerId: string) => { const value = options().policies[providerId]; if (!value) throw new ApiFault(422, "POLICY_UNAVAILABLE"); return value; };
  router.post("/plans", route(async (req, res) => {
    const plan = await manager().planProvisioning(req.body); manager().saveProvisioningPlan(plan);
    res.status(201).json({ plan, digest: provisioningDigest(plan), profile: manager().getProvisioningProfile(plan.providerId) });
  }));
  router.get("/plans/:id", route(async (req, res) => { const value = stored(req.params.id); res.json({ plan: value.plan, digest: provisioningDigest(value.plan), ...(value.preview ? { attachment: publicPreview(value.preview) } : {}) }); }));
  router.post("/preflight", route(async (req, res) => {
    const input = fields(req.body, ["planId"]); const { plan } = stored(input.planId);
    const result = await manager().preflightProvisioning(plan, policy(plan.providerId));
    if (result.status === "FAIL") { res.status(422).json({ status: "FAIL", issues: result.issues.map(({ code, severity }) => ({ code, severity })) }); return; }
    if (plan.mode === "adopt") {
      const preview = await manager().previewRuntimeAttachment(plan, policy(plan.providerId)); manager().saveProvisioningPlan(plan, preview);
      res.json({ status: result.status, issues: result.issues.map(({ code, severity }) => ({ code, severity })), attachment: publicPreview(preview) });
    } else res.json({ status: result.status, issues: result.issues.map(({ code, severity }) => ({ code, severity })) });
  }));
  router.post("/attachments", route(async (req, res) => {
    const input = fields(req.body, ["planId", "digest", "approved"]); const value = stored(input.planId);
    if (input.approved !== true || !value.preview || input.digest !== value.preview.digest) throw new ApiFault(400, "APPROVAL_REQUIRED");
    const result = await manager().attachRuntime({ ...value.preview, approved: true }, policy(value.plan.providerId), res.locals.principal.actor);
    if (result.result.state !== "PROVISIONED") throw new ApiFault(result.error?.code === "RESOURCE_CONFLICT" ? 409 : 422, result.error?.code ?? "ATTACHMENT_FAILED");
    const record = manager().listRuntimeAttachments().find((item) => item.operationId === result.operationId)!;
    res.status(200).json(publicAttachment(record));
  }));
  router.get("/attachments", route(async (_req, res) => { res.json({ attachments: manager().listRuntimeAttachments().map(publicAttachment) }); }));
  router.get("/attachments/:id", route(async (req, res) => {
    const record = manager().listRuntimeAttachments().find((item) => item.effectId === req.params.id); if (!record) throw new ApiFault(404, "ATTACHMENT_NOT_FOUND"); res.json(publicAttachment(record));
  }));
  router.post("/attachments/:id/reconcile", route(async (req, res) => {
    fields(req.body ?? {}, []);
    const record = manager().listRuntimeAttachments().find((item) => item.effectId === req.params.id);
    const operationId = record?.operationId ?? String(req.params.id).replace(/^attachment_/, "");
    const operation = manager().getProvisioningOperation(operationId); if (!operation || operation.executionKind !== "attachment") throw new ApiFault(404, "ATTACHMENT_NOT_FOUND");
    const result = await manager().recoverRuntimeAttachment(operationId, policy(operation.plan.providerId)); res.json({ operationId, state: result.result.state });
  }));
  return router;
}
