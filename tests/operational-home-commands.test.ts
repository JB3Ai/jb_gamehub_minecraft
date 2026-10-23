import test from "node:test";
import assert from "node:assert/strict";
import { LifecycleCommands, type LifecycleDependencies } from "../src/dashboard/lifecycleCommands";
import { LifecycleRequestError, getServerStatus, runServerCommand } from "../src/dashboard/apiClient";
import { serverIdentity, type ServerCommand, type ServerKey } from "../src/dashboard/homeModel";
import type { OperationRecord, ServerStatusResponse } from "../src/dashboard/types";
const key = { providerId: "minecraft", serverId: "shared" }, other = { ...key, providerId: "minecraft-bedrock" };
function fixture() {
  const f = { requests: [] as ServerKey[], pending: {} as Record<string, ServerCommand>, errors: {} as Record<string, string>, status: { status: "starting" } as ServerStatusResponse,
    operation: { operationId: "op", type: "server.start", ...key, status: "running", createdAt: new Date().toISOString() } as OperationRecord, observed: [] as ServerStatusResponse[], allowed: true };
  const deps: LifecycleDependencies = {
    allowed: () => f.allowed,
    request: async k => { f.requests.push(k); return { operationId: "op", status: "queued" }; },
    operation: async () => f.operation, status: async () => f.status,
    changed: (pending, errors) => { f.pending = pending; f.errors = errors; },
    observed: (_, status) => { f.observed.push(status); }, operationObserved: () => {},
  };
  return { f, deps, runner: new LifecycleCommands(deps) };
}
test("025A Start double activation submits exactly once and retains lock through unresolved operation", async () => {
  const { f, runner } = fixture(); await Promise.all([runner.submit(key, "start"), runner.submit(key, "start")]); assert.equal(f.requests.length, 1);
  f.status = { status: "online" }; await runner.refresh(); await runner.submit(key, "start"); assert.equal(f.requests.length, 1);
  f.operation.status = "completed"; await runner.refresh(); assert.deepEqual(f.pending, {}); assert.equal(f.observed.at(-1)?.status, "online");
});
test("025A terminal operation plus transitional server keeps the card locked", async () => {
  const { f, runner } = fixture(); f.operation.status = "completed"; await runner.submit(key, "start"); assert.equal(f.pending[serverIdentity(key)], "start");
  f.status = { status: "online" }; await runner.refresh(); assert.deepEqual(f.pending, {});
});
for (const command of ["stop", "restart"] as const) test(`025A confirmed ${command} submits once and observes clean terminal state`, async () => {
  const { f, runner } = fixture(); f.operation.type = `server.${command}`; f.status = { status: "stopping" };
  await Promise.all([runner.submit(key, command), runner.submit(key, command)]); assert.equal(f.requests.length, 1);
  f.operation.status = "completed"; f.status = { status: command === "stop" ? "offline" : "online" }; await runner.refresh(); assert.deepEqual(f.pending, {});
});
test("025A permission/state guard rejects action without issuing POST", async () => {
  const { f, runner } = fixture(); f.allowed = false; await runner.submit(key, "start"); assert.equal(f.requests.length, 0);
});
test("025A same server ID across providers has independent locks", async () => {
  const { f, deps } = fixture(); deps.operation = async () => { throw new Error(); }; const runner = new LifecycleCommands(deps);
  await Promise.all([runner.submit(key, "start"), runner.submit(other, "start")]); assert.equal(f.requests.length, 2); assert.equal(Object.keys(f.pending).length, 2);
});
test("025A poll failure retains lock and recovers by GET without replaying POST", async () => {
  const { f, deps } = fixture(); let fail = true; deps.operation = async () => { if (fail) throw new Error("token=secret C:\\private"); return f.operation; }; const runner = new LifecycleCommands(deps);
  await runner.submit(key, "start"); assert.equal(f.requests.length, 1); assert.doesNotMatch(JSON.stringify(f.errors), /secret|private/);
  fail = false; f.operation.status = "completed"; f.status = { status: "online" }; await runner.refresh(); assert.deepEqual(f.pending, {}); assert.equal(f.requests.length, 1);
});
test("025A unconfirmed POST response retains lock without automatic retry", async () => {
  const { f, deps } = fixture(); let posts = 0; deps.request = async () => { posts++; throw new LifecycleRequestError(false); }; const runner = new LifecycleCommands(deps);
  await runner.submit(key, "start"); await runner.refresh(); await runner.submit(key, "start"); assert.equal(posts, 1); assert.match(f.errors[serverIdentity(key)], /unconfirmed/); assert.ok(f.pending[serverIdentity(key)]);
});
test("025A rejected command and confirmed failed operation show safe attention", async () => {
  const { f, deps } = fixture(); f.status = { status: "offline" }; deps.request = async () => { throw new LifecycleRequestError(true); }; const runner = new LifecycleCommands(deps); await runner.submit(key, "start"); assert.deepEqual(f.pending, {}); assert.match(f.errors[serverIdentity(key)], /rejected/);
  const failed = fixture(); failed.f.operation.status = "failed"; failed.f.status = { status: "offline" }; await failed.runner.submit(key, "start"); assert.deepEqual(failed.f.pending, {}); assert.match(failed.f.errors[serverIdentity(key)], /could not start/);
});
test("025A mismatched operation cannot release a retained command", async () => {
  const { f, runner } = fixture(); f.operation.providerId = other.providerId; f.operation.status = "completed"; f.status = { status: "online" }; await runner.submit(key, "start"); assert.ok(f.pending[serverIdentity(key)]);
});
test("025A existing command/status API uses provider-scoped encoded URLs", async t => {
  const urls: string[] = []; t.mock.method(globalThis, "fetch", async (url: string) => { urls.push(url); return Response.json(url.endsWith("/status") ? { status: "offline" } : { operationId: "op", status: "queued" }); });
  await runServerCommand("same id", "start", "minecraft-bedrock"); await getServerStatus("same id", "minecraft-bedrock");
  assert.deepEqual(urls, ["/api/providers/minecraft-bedrock/servers/same%20id/start", "/api/providers/minecraft-bedrock/servers/same%20id/status"]);
});
