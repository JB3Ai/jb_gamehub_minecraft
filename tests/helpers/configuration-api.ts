import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { onboardingRouter } from "../../packages/core/onboarding-api";
import { setupCatalog } from "../../packages/core/setup-configuration";
import { tokenAdminAuthorizer } from "../../packages/core/provisioning-api";
import { hashSetupReference } from "../../packages/host-platform/readiness";
import { managedFixture } from "./managed-create-fixture";
import { managedBedrockFixture } from "./managed-bedrock-fixture";
export const token = "024B-fixture-administrator-key-never-real-0123456789";
export async function configurationHost(t: import("node:test").TestContext, kind: "java" | "bedrock" = "java") {
  const f = kind === "java" ? await managedFixture(t) : await managedBedrockFixture(t), { manager, repository } = await f.open();
  const options = { authorize: tokenAdminAuthorizer(token), policies: { [f.request.providerId]: f.policy } };
  const observation = { platform: "win32", architecture: "x64", elevated: false, capabilityChecksAvailable: true, inventory: { complete: true, bindings: [] } };
  const probes = { host: async () => observation, storage: async () => ({ exists: true, access: "allowed-advisory" as const, availableBytes: 5n * 1024n ** 3n }), database: async () => ({ exists: true, readable: true, formatValid: true, locationAccess: "allowed-advisory" as const }), fileHash: hashSetupReference };
  const catalog = () => setupCatalog(options, path.join(f.base, "state.sqlite"), { javaPort: 25565, bedrockPort: 19132 });
  const app = express(); app.use(express.json()); app.use("/api/setup", onboardingRouter(() => manager, () => options, () => ({ ...probes, runtimes: async () => [] }), undefined, () => ({ catalog: catalog(), repository: repository.setupConfiguration, probes })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/setup/configuration`, headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  const request = () => ({ schemaVersion: 1, expectedRevision: repository.setupConfiguration.read()?.revision ?? 0, catalogDigest: catalog().digest, approved: true, storage: { rootId: catalog().storage[0].id }, database: { locationId: "default" }, ...(kind === "java" ? { java: { runtimeId: catalog().java[0].id } } : { bedrock: { runtimeId: catalog().bedrock[0].id } }), ports: { java: 25565, bedrock: 19132 } });
  const post = (body: unknown) => fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { f, manager, repository, options, probes, url, headers, request, post };
}
