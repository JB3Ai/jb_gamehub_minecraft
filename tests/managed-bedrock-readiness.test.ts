import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { ManagedBedrockRuntime, type UdpBinding } from "../packages/bedrock-provider/managed-runtime";
import { ManagedBootCoordinator } from "../packages/core/managed-boot";
import { managedBedrockFixture } from "./helpers/managed-bedrock-fixture";

class FixtureRuntime extends ManagedBedrockRuntime { child() { return this.ownedProcess(); } }
async function setup(t: TestContext, ignoreStop = false) {
  const f = await managedBedrockFixture(t), { manager, repository, provider } = await f.open();
  const plan = await manager.planProvisioning(f.request), preview = await manager.previewManagedCreation(plan, f.policy);
  const operation = await manager.applyManagedCreation({ planId: plan.planId, digest: preview.digest, approved: true }, f.policy, "fixture-admin", f.options);
  const boot = await manager.previewManagedBoot(operation.operationId, f.policy);
  await manager.authorizeManagedBoot(operation.operationId, { digest: boot.digest, approved: true }, f.policy, "fixture-admin");
  const control = new ManagedBootCoordinator(repository.provisioning, provider.managedCreation!, preview, manager.listManagedRuntimes()[0], f.options.now, "fixture-process-owner").control();
  const script = path.join(f.base, "fake-bds.cjs");
  await fs.writeFile(script, `
const fs=require('node:fs'), path=require('node:path'), readline=require('node:readline');
const lines=readline.createInterface({input:process.stdin});
console.log('fixture process launched');
lines.on('line', command=>{
 if(command==='version') console.log('Version: 1.26.51.1');
 if(command==='wrong-version') console.log('Version: 1.26.99.9');
 if(command==='early') console.log('IPv4 supported, port: 29232');
 if(command==='ready') console.log('[2026-10-18 12:00:00 INFO] Server started.');
 if(command==='first-half') process.stdout.write('Server sta');
 if(command==='second-half') process.stdout.write('rted.\\n');
 if(command==='stderr-ready') console.error('Server started.');
 if(command==='world') {const world=path.join(process.cwd(),'worlds','managed-bedrock-world'); fs.mkdirSync(path.join(world,'db'),{recursive:true}); fs.writeFileSync(path.join(world,'level.dat'),'fixture metadata');}
 if(command==='exit') process.exit(0);
 if(command==='crash') process.exit(1);
 if(command==='stop' && !${ignoreStop}) {console.log('Quit correctly'); process.exit(0);}
});
`);
  let mode = "healthy", runtime: FixtureRuntime;
  const endpoints = [{ host: "0.0.0.0", port: 29232 }, { host: "::", port: 29233 }];
  const observeUdp = async () => {
    const child = runtime.child();
    if (mode === "occupied-before-start") return { complete: true, bindings: endpoints.map(e => ({ ...e, pid: 999999 })) };
    if (!child?.pid) return { complete: true, bindings: [] };
    if (mode === "inventory-error") throw new Error("fixture inventory error");
    let bindings: UdpBinding[] = endpoints.map(e => ({ ...e, pid: child.pid! }));
    if (mode === "missing-v6") bindings = bindings.slice(0, 1);
    if (mode === "foreign-owner") bindings = bindings.map(e => ({ ...e, pid: 999999 }));
    if (mode === "extra-owned") bindings.push({ host: "0.0.0.0", port: 19132, pid: child.pid });
    return { complete: true, bindings };
  };
  runtime = new FixtureRuntime({ serverDir: f.target, serverId: f.request.serverId, startCommand: `"${process.execPath}" "${script}"` }, control, endpoints, { observeUdp, stopTimeoutMs: ignoreStop ? 80 : 2000, pollMs: 10 });
  await runtime.register();
  t.after(async () => {
    const child = runtime.child();
    if (child) { const exited = once(child, "exit"); child.stdin!.write("exit\n"); await exited; }
  });
  const send = (...commands: string[]) => runtime.child()!.stdin!.write(commands.join("\n") + "\n");
  const waitFor = async (predicate: (status: Awaited<ReturnType<typeof runtime.getServerStatus>>) => boolean) => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const status = await runtime.getServerStatus(f.request.serverId!); if (predicate(status)) return status;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("fixture readiness observation timed out");
  };
  return { ...f, manager, operation, control, runtime, send, waitFor, mode: (next: string) => { mode = next; } };
}

test("managed READY requires current complete marker, version, owned endpoints and world", async (t) => {
  const f = await setup(t); await f.runtime.startServer(f.request.serverId!);
  f.send("early", "world", "version", "stderr-ready");
  await f.waitFor(status => status.readinessEvidence?.versionMatched === true);
  assert.equal((await f.runtime.getServerStatus(f.request.serverId!)).status, "starting");
  f.send("first-half"); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await f.runtime.getServerStatus(f.request.serverId!)).readiness, "STARTING");
  f.send("second-half"); const ready = await f.waitFor(status => status.readiness === "READY");
  assert.equal(ready.status, "online"); assert.equal(f.control.current()?.attempt?.state, "READY");
  await f.runtime.stopServer(f.request.serverId!);
  assert.equal((await f.runtime.getServerStatus(f.request.serverId!)).status, "offline");
  assert.equal(f.control.current()?.attempt?.state, "STOPPED");
});

for (const mode of ["missing-v6", "foreign-owner", "extra-owned", "inventory-error"]) test("managed READY refuses " + mode, async (t) => {
  const f = await setup(t); await f.runtime.startServer(f.request.serverId!); f.mode(mode);
  f.send("world", "version", "ready");
  const status = await f.waitFor(status => status.readinessEvidence?.startupSignal === true);
  assert.equal(status.status, "starting"); assert.equal(status.readinessEvidence?.udpEndpoints, false);
  f.mode("healthy"); await f.runtime.stopServer(f.request.serverId!);
});

test("managed READY refuses missing world and wrong BDS version", async (t) => {
  const f = await setup(t); await f.runtime.startServer(f.request.serverId!); f.send("version", "ready");
  const noWorld = await f.waitFor(status => status.readinessEvidence?.startupSignal === true);
  assert.equal(noWorld.status, "starting"); assert.equal(noWorld.readinessEvidence?.worldValidated, false);
  await f.runtime.stopServer(f.request.serverId!);
  await f.runtime.startServer(f.request.serverId!); f.send("world", "wrong-version", "ready");
  const wrongVersion = await f.waitFor(status => status.readinessEvidence?.startupSignal === true);
  assert.equal(wrongVersion.status, "starting"); assert.equal(wrongVersion.readinessEvidence?.versionMatched, false);
  await f.runtime.stopServer(f.request.serverId!);
});

test("old child output cannot promote another attempt; stopped boot restores without launch", async (t) => {
  const f = await setup(t); await f.runtime.startServer(f.request.serverId!); f.send("world", "version", "ready");
  await f.waitFor(status => status.readiness === "READY"); const prior = f.runtime.child()!;
  await f.runtime.stopServer(f.request.serverId!);
  await f.runtime.startServer(f.request.serverId!); f.send("version");
  await f.waitFor(status => status.readinessEvidence?.versionMatched === true);
  prior.stdout!.emit("data", Buffer.from("Server started.\n"));
  assert.equal((await f.runtime.getServerStatus(f.request.serverId!)).status, "starting");
  f.send("ready"); await f.waitFor(status => status.readiness === "READY");
  await f.runtime.stopServer(f.request.serverId!); await f.manager.shutdown();
  const reopened = await f.open(); await reopened.manager.recoverManagedCreation(f.operation.operationId, f.policy, f.options);
  assert.equal((await reopened.manager.getServerStatus(f.request.serverId!, "minecraft-bedrock")).status, "offline");
  assert.equal(reopened.repository.provisioning.getManagedBoot(f.operation.operationId)?.attempt?.fence, 2);
});

test("stop timeout retains owned process/claims and does not force kill", async (t) => {
  const f = await setup(t, true); await f.runtime.startServer(f.request.serverId!); f.send("world", "version", "ready");
  await f.waitFor(status => status.readiness === "READY"); const child = f.runtime.child()!;
  t.mock.method(child, "kill", () => { assert.fail("managed stop must not force-kill"); });
  await assert.rejects(f.runtime.stopServer(f.request.serverId!), /MANAGED_STOP_TIMEOUT/);
  assert.equal(f.runtime.child(), child); assert.equal(f.control.current()?.attempt?.state, "READY");
  assert.equal(f.manager.listProvisioningClaims(f.operation.operationId).filter(c => c.state === "active").length, 4);
  // End only the disposable fixture after proving production stop did not kill it.
  const exited = once(child, "exit"); f.send("exit"); await exited;
});

test("foreign occupied endpoint blocks launch before durable attempt", async (t) => {
  const f = await setup(t); f.mode("occupied-before-start");
  await assert.rejects(f.runtime.startServer(f.request.serverId!), /MANAGED_ENDPOINT_OCCUPIED/);
  assert.equal(f.control.current()?.attempt, undefined); assert.equal(f.runtime.child(), undefined);
});
