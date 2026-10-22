import test from "node:test";
import assert from "node:assert/strict";
import { assessHostReadiness, canContinueReadiness, parseHostReadiness, HostReadinessClientError } from "../src/setup/hostReadiness";
const report = (status = "PASS") => ({ schemaVersion: 1, checkedAt: "2026-10-22T00:00:00Z", platform: "win32", status, readOnly: true, authorizationGranted: false,
  checks: [{ id: "host", status, title: "Windows host", message: "Host inspected." }], configuration: { configured: false, managedRuntimeCount: 0, attachedRuntimeCount: 0, preserveExisting: true } });
test("Continue requires a validated PASS/WARNING and never a blocked or missing report", () => {
  for (const status of ["PASS", "WARNING", "BLOCKED"]) assert.equal(canContinueReadiness(parseHostReadiness(report(status))), status !== "BLOCKED");
  assert.equal(canContinueReadiness(), false);
  for (const invalid of [{ ...report(), status: "UNKNOWN" }, { ...report(), checks: [{ ...report().checks[0], status: "BLOCKED" }] }, { ...report(), checks: [] }, { ...report(), authorizationGranted: true }, { ...report(), checkedAt: "invalid" }]) assert.throws(() => parseHostReadiness(invalid));
});
test("Recheck issues fresh authenticated GETs and never sends a mutation or trusted location", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    calls++; assert.equal(input, "/api/setup/readiness?provider=minecraft"); assert.equal(init.method, undefined); assert.equal(init.body, undefined); assert.equal(init.cache, "no-store"); assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-key");
    return Response.json(report(calls === 1 ? "BLOCKED" : "WARNING"));
  });
  assert.equal((await assessHostReadiness("fixture-key", "minecraft")).status, "BLOCKED");
  assert.equal((await assessHostReadiness("fixture-key", "minecraft")).status, "WARNING"); assert.equal(calls, 2);
});
test("auth/network/schema failures never render raw diagnostics or enable Continue", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "private token and C:/paths" } }, { status: 401 }));
  await assert.rejects(assessHostReadiness("key", ""), error => error instanceof Error && !/private|paths/.test(error.message));
  globalThis.fetch = async () => { throw new Error("private token"); };
  await assert.rejects(assessHostReadiness("key", ""), error => error instanceof Error && !error.message.includes("private"));
  globalThis.fetch = async () => Response.json({ ...report(), status: "PASS", checks: [{ ...report().checks[0], status: "BLOCKED" }] });
  await assert.rejects(assessHostReadiness("key", ""));
  assert.throws(() => parseHostReadiness({ ...report(), checks: [{ ...report().checks[0], details: { nested: {} } }] }), error => error instanceof HostReadinessClientError && error.code === "INVALID_RESPONSE");
});
