import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LifecycleCommands, type LifecycleDependencies } from "../src/dashboard/lifecycleCommands";
import { sessionCommandJournal, COMMAND_JOURNAL_KEY, type CommandRecovery } from "../src/dashboard/commandJournal";
import { getServerStatus, runServerCommand, LifecycleRequestError } from "../src/dashboard/apiClient";
import { serverIdentity, type ServerCommand } from "../src/dashboard/homeModel";
import { applyProviderEvent, applyServerObservation, createInitialDashboardState, mergeServerInventory } from "../src/dashboard/state";
import { OperationalHome } from "../src/components/OperationalHome";
import { OperationsPanel, LiveEventsPanel } from "../src/components/OperationalDashboard";
import type { DashboardState, OperationRecord, ServerStatusResponse } from "../src/dashboard/types";

const key = { providerId: "minecraft", serverId: "family" }, id = serverIdentity(key), time = Date.parse("2026-10-23T10:00:00Z");
function fixture() {
  const memory = new Map<string, string>(), storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  const journal = sessionCommandJournal(() => storage);
  const f = { posts: 0, reads: 0, statusReads: 0, pending: {} as Record<string, ServerCommand>, errors: {} as Record<string, string>, recoveries: {} as Record<string, CommandRecovery>, blocked: false,
    observed: [] as ServerStatusResponse[], status: { status: "starting" } as ServerStatusResponse,
    operation: { operationId: "op_recovery", type: "server.start", ...key, status: "running", createdAt: new Date(time).toISOString() } as OperationRecord };
  const deps: LifecycleDependencies = { journal, now: () => time, allowed: () => true,
    request: async () => { f.posts++; return { operationId: f.operation.operationId, status: "running" }; }, operation: async () => { f.reads++; return f.operation; }, status: async () => { f.statusReads++; return f.status; },
    observed: (_, status) => { f.observed.push(status); }, operationObserved: () => {}, changed: (pending, errors, recoveries, blocked) => { f.pending = pending; f.errors = errors; f.recoveries = recoveries; f.blocked = blocked; } };
  return { memory, storage, journal, f, deps };
}
test("025C intent is stored before POST; references survive a fresh controller and reconcile with GETs only", async () => {
  const { f, deps, memory, journal } = fixture();
  deps.request = async () => { f.posts++; assert.equal(journal.read()[0].phase, "submitting"); return { operationId: "op_recovery", status: "running" }; };
  const first = new LifecycleCommands(deps); await first.submit(key, "start"); assert.equal(journal.read()[0].operationId, "op_recovery"); first.dispose();
  const restored = new LifecycleCommands(deps); restored.restore(); assert.ok(f.pending[id]);
  assert.doesNotMatch(memory.get(COMMAND_JOURNAL_KEY)!, /authorization|Bearer|token|displayName|password|runtimeRoot/);
  f.operation.status = "completed"; f.status = { status: "online" }; await restored.refresh(); assert.deepEqual(f.pending, {}); assert.equal(f.recoveries[id].phase, "reconciled"); assert.equal(f.posts, 1);
});
test("025C lost POST response stays unknown across reload even when status is online", async () => {
  const { f, deps } = fixture(); deps.request = async () => { f.posts++; throw new LifecycleRequestError(false); };
  const first = new LifecycleCommands(deps); await first.submit(key, "start"); const attempt = f.recoveries[id].attemptId; first.dispose();
  f.status = { status: "online" }; const restored = new LifecycleCommands(deps); restored.restore(); await restored.refresh(); await restored.submit(key, "start");
  assert.equal(f.posts, 1); assert.equal(f.recoveries[id].attemptId, attempt); assert.ok(f.pending[id]); assert.equal(f.recoveries[id].operationId, undefined); assert.equal(f.reads, 0);
});
test("025C completed operation without a status read is not success and retains the reference", async () => {
  const { f, deps } = fixture(); f.operation.status = "completed"; deps.status = async () => { throw new Error("C:\\private token=secret"); };
  const runner = new LifecycleCommands(deps); await runner.submit(key, "start"); assert.ok(f.pending[id]); assert.equal(f.recoveries[id].phase, "unknown"); assert.equal(f.recoveries[id].operationId, "op_recovery"); assert.deepEqual(f.observed, []); assert.doesNotMatch(JSON.stringify(f.errors), /secret|private/);
  deps.status = async () => ({ status: "online" }); await runner.recheck(key); assert.deepEqual(f.pending, {}); assert.equal(f.posts, 1);
});
test("025C explicit rejection still requires a fresh stable status before another action", async () => {
  const { f, deps } = fixture(); deps.request = async () => { f.posts++; throw new LifecycleRequestError(true); }; deps.status = async () => { throw new Error(); };
  const runner = new LifecycleCommands(deps); await runner.submit(key, "start"); assert.ok(f.pending[id]); assert.equal(f.recoveries[id].rejected, true);
  deps.status = async () => ({ status: "offline" }); await runner.recheck(key); assert.deepEqual(f.pending, {}); assert.equal(f.recoveries[id].phase, "failed"); assert.equal(f.posts, 1);
});
test("025C a completed command with the wrong stable state is failure, not success", async () => {
  const { f, deps } = fixture(); f.operation.status = "completed"; f.status = { status: "offline" };
  const runner = new LifecycleCommands(deps); await runner.submit(key, "start"); assert.deepEqual(f.pending, {}); assert.equal(f.recoveries[id].phase, "failed"); assert.match(f.errors[id], /could not start/);
});
test("025C terminal operation with transitional state remains locked and is not called running", async () => {
  const { f, deps } = fixture(); f.operation.status = "failed"; const runner = new LifecycleCommands(deps); await runner.submit(key, "start"); assert.ok(f.pending[id]); assert.match(f.errors[id], /operation has ended/);
  f.status = { status: "offline" }; await runner.refresh(); assert.equal(f.recoveries[id].phase, "failed"); assert.deepEqual(f.pending, {});
});
test("025C operator association requires explicit review and rejects unrelated or old references", async () => {
  const { f, deps } = fixture(); deps.request = async () => { f.posts++; throw new LifecycleRequestError(false); }; const runner = new LifecycleCommands(deps); await runner.submit(key, "start");
  await runner.associate(key, "op_recovery", false); assert.equal(f.reads, 0);
  for (const patch of [{ providerId: "minecraft-bedrock" }, { serverId: "other" }, { type: "server.stop" }, { createdAt: "2020-01-01T00:00:00Z" }]) {
    const original = f.operation; f.operation = { ...original, ...patch } as OperationRecord; await runner.associate(key, "op_recovery", true); assert.ok(f.pending[id]); assert.equal(f.recoveries[id].operationId, undefined); f.operation = original;
  }
  f.operation.status = "completed"; f.status = { status: "online" }; await runner.associate(key, "op_recovery", true); assert.equal(f.recoveries[id].phase, "reconciled"); assert.equal(f.recoveries[id].operationId, "op_recovery"); assert.equal(f.posts, 1);
});
test("025C corrupt or unreadable storage fails closed without erasing prior recovery material", async () => {
  const { f, deps, memory } = fixture(); memory.set(COMMAND_JOURNAL_KEY, "{broken"); const runner = new LifecycleCommands(deps); runner.restore(); await runner.submit(key, "start"); assert.equal(f.posts, 0); assert.equal(f.blocked, true); assert.equal(memory.get(COMMAND_JOURNAL_KEY), "{broken");
  deps.journal = sessionCommandJournal(() => { throw new Error("private"); }); const unavailable = new LifecycleCommands(deps); unavailable.restore(); await unavailable.submit(key, "start"); assert.equal(f.posts, 0); assert.doesNotMatch(JSON.stringify(f.errors), /private/);
});
test("025C a failed intent write prevents POST; a failed later write preserves the earlier uncertainty", async () => {
  const { f, deps, storage, journal } = fixture(); storage.setItem = () => { throw new Error("quota"); }; const runner = new LifecycleCommands(deps); await runner.submit(key, "start"); assert.equal(f.posts, 0); assert.equal(f.blocked, true);
  const other = fixture(); other.deps.request = async () => { other.f.posts++; other.storage.setItem = () => { throw new Error("quota"); }; return { operationId: "op_recovery", status: "running" }; };
  const pending = new LifecycleCommands(other.deps); await pending.submit(key, "start"); assert.equal(other.f.posts, 1); assert.equal(other.f.blocked, true); assert.equal(other.journal.read()[0].locked, true); assert.equal(other.journal.read()[0].operationId, undefined);
});
test("025C old async responses cannot overwrite recovery storage after unmount", async () => {
  const { deps, journal } = fixture(); let resolve!: (value: any) => void; deps.request = () => new Promise(r => { resolve = r; }); const runner = new LifecycleCommands(deps); const submitted = runner.submit(key, "start"); runner.dispose(); const before = journal.read(); resolve({ operationId: "op_late", status: "running" }); await submitted; assert.deepEqual(journal.read(), before);
});
test("025C journal sanitizes metadata and refuses inconsistent locks and duplicate identities", () => {
  const { storage, memory, journal } = fixture(); const record = { key, command: "start", attemptId: "attempt_test", submittedAt: new Date(time).toISOString(), phase: "unknown", locked: true, token: "not-stored", rawError: "C:\\private" };
  storage.setItem(COMMAND_JOURNAL_KEY, JSON.stringify({ schemaVersion: 1, records: [record] })); journal.write(journal.read()); assert.doesNotMatch(memory.get(COMMAND_JOURNAL_KEY)!, /token|private|rawError/);
  storage.setItem(COMMAND_JOURNAL_KEY, JSON.stringify({ schemaVersion: 1, records: [{ ...record, locked: false }] })); assert.throws(() => journal.read());
  storage.setItem(COMMAND_JOURNAL_KEY, JSON.stringify({ schemaVersion: 1, records: [record, record] })); assert.throws(() => journal.read());
});
test("025C HTTP timeout is unknown, never success; command is sent once", async t => {
  let calls = 0; t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => { calls++; return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))); });
  const promise = runServerCommand(key.serverId, "start", key.providerId); const result = assert.rejects(promise, e => e instanceof LifecycleRequestError && !e.rejected); t.mock.timers.tick(10000); await result; assert.equal(calls, 1);
  const read = assert.rejects(getServerStatus(key.serverId, key.providerId)); t.mock.timers.tick(5000); await read;
});
test("025C failed or older reads/events preserve the last confirmed lifecycle state", () => {
  const state: DashboardState = { ...createInitialDashboardState(), loading: false, servers: [{ id: key.serverId, providerId: key.providerId, name: "Family", status: "online", availability: true, serverType: "Paper", endpoints: { java: "127.0.0.1:25565" }, lastStatusUpdate: new Date(time).toISOString(), players: 2 }] };
  const failed = applyServerObservation(state, key, undefined, time + 1); assert.equal(failed.servers[0].status, "online"); assert.equal(failed.servers[0].statusUnconfirmed, true); assert.equal(failed.servers[0].players, undefined);
  const stale = applyServerObservation(state, key, { status: "offline" }, time - 1); assert.equal(stale.servers[0].status, "online");
  const inventory = mergeServerInventory(state.servers, [{ ...state.servers[0], name: "Updated name", status: "offline" }], time - 1);
  assert.equal(inventory[0].status, "online"); assert.equal(inventory[0].name, "Updated name");
  assert.equal(applyProviderEvent(state, { type: "server.status.changed", ...key, status: "offline", timestamp: new Date(time - 1).toISOString() }).servers[0].status, "online");
  const restored = applyServerObservation(failed, key, { status: "online", players: 1 }, time + 2); assert.equal(restored.servers[0].statusUnconfirmed, false);
});
test("025C Home preserves observed state, blocks uncertain actions and exposes safe references", () => {
  const { f, deps } = fixture(); const record: CommandRecovery = { key, command: "start", attemptId: "attempt_safe", submittedAt: new Date(time).toISOString(), phase: "unknown", locked: true, operationId: "op_recovery" };
  const state: DashboardState = { ...createInitialDashboardState(), loading: false, commandsAuthorized: true, wsConnection: "connected", servers: [{ id: key.serverId, providerId: key.providerId, name: "Family", status: "offline", availability: false, serverType: "Paper", lastStatusUpdate: new Date(time).toISOString(), endpoints: { java: "127.0.0.1:25565" } }], pendingCommands: { [id]: "start" }, commandRecoveries: { [id]: record } };
  const html = renderToStaticMarkup(<OperationalHome state={state} onCommand={() => {}} onRefresh={() => {}} onCreate={() => {}} onDetails={() => {}} onActivity={() => {}} onConnect={() => {}} />);
  assert.match(html, /Stopped/); assert.doesNotMatch(html, /Starting…/); assert.match(html, /Command outcome unknown/); assert.match(html, /op_recovery/); assert.match(html, /Check outcome/); assert.match(html, /disabled=""/);
  const operation = { ...f.operation, status: "failed" as const, error: { code: "PRIVATE", message: "token=secret D:\\private" } };
  const operations = renderToStaticMarkup(<OperationsPanel operations={[operation]} selectedServerId={key.serverId} onCommand={() => {}} commandsBlocked />);
  const events = renderToStaticMarkup(<LiveEventsPanel events={[{ type: "operation.failed", timestamp: operation.createdAt, payload: operation }]} />);
  assert.doesNotMatch(operations + events, /token=secret|D:\\private/); assert.match(operations, /op_recovery/);
});
