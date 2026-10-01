import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { runHumanClient } from "../integration/bedrock/scripts/bedrock-human-client-helper.cjs";
import { runAcceptanceClientPhase, startAcceptanceClient } from "../integration/bedrock/scripts/native-bds-client";

function helper(phase = "initial") {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => { text += chunk.toString(); });
  const done = runHumanClient({ input, output, phase });
  return { input, done, text: () => text };
}

test("human helper gates disconnect on an exact session acknowledgment, not ENTER", async () => {
  const client = helper();
  client.input.write("JBGH_SESSION_CONFIRMED\n"); // premature control cannot confirm a join
  assert.doesNotMatch(client.text(), /JBGH_CLIENT_READY/);
  client.input.write("\n");
  assert.match(client.text(), /JBGH_CLIENT_READY\n/);
  assert.doesNotMatch(client.text(), /Now disconnect/);
  client.input.write("\nJBGH_SESSION_CONFIRMED_extra\n");
  assert.doesNotMatch(client.text(), /Now disconnect/);
  client.input.write("JBGH_SESSION_CON");
  assert.doesNotMatch(client.text(), /Now disconnect/);
  client.input.write("FIRMED\r\n");
  assert.match(client.text(), /Now disconnect\/leave/);
  client.input.write("\n");
  await client.done;
});

test("human reconnect still emits RECONNECTED and waits for operator kick confirmation", async () => {
  const client = helper("reconnect");
  client.input.write("\n");
  assert.match(client.text(), /JBGH_CLIENT_RECONNECTED\n/);
  assert.match(client.text(), /Press ENTER only AFTER Minecraft shows/);
  assert.doesNotMatch(client.text(), /Now disconnect|phase complete/);
  client.input.write("JBGH_SESSION_CONFIRMED\n");
  assert.doesNotMatch(client.text(), /phase complete/);
  client.input.write("\n");
  await client.done;
  assert.match(client.text(), /Enforcement phase complete/);
});

test("human helper rejects EOF while waiting for session acknowledgment", async () => {
  const client = helper();
  client.input.write("\n");
  client.input.end();
  await assert.rejects(client.done, /Input closed/);
});

function spawnFixture(script: string, timeoutMs = 5000) {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = startAcceptanceClient(process.execPath, ["-e", script], { input, output, timeoutMs });
  return { client, input, output };
}

test("initial harness asserts active session before acknowledgment and filters operator control text", async () => {
  const { client, input } = spawnFixture(`
    process.stdout.write('JBGH_CLIENT_RE');
    process.stdout.write('ADY\\n');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      if (line === 'JBGH_SESSION_CONFIRMED') process.exit(0);
      else process.exit(2);
    });
  `);
  let asserted = false;
  await runAcceptanceClientPhase(client, "initial", async () => {
    input.write("JBGH_SESSION_CONFIRMED\n"); // must not reach the child
    asserted = true;
  });
  assert.equal(asserted, true);
  assert.equal(client.child.exitCode, 0);
  assert.equal(input.listenerCount("data"), 0);
});

test("real helper disconnect prompt follows the harness active assertion", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  let joined = false;
  let disconnected = false;
  let asserted = false;
  let promptAfterAssertion = false;
  const client = startAcceptanceClient(process.execPath, [fileURLToPath(new URL("../integration/bedrock/scripts/bedrock-human-client-helper.cjs", import.meta.url))], {
    input, output, timeoutMs: 5000,
    env: { ...process.env, JBGH_BDS_ACCEPTANCE_PHASE: "initial" },
  });
  output.on("data", (chunk) => {
    text += chunk.toString();
    if (!joined && text.includes("Press ENTER once the player is fully connected...")) {
      joined = true;
      input.write("\n");
    }
    if (!disconnected && text.includes("Press ENTER once the player has disconnected...")) {
      disconnected = true;
      promptAfterAssertion = asserted;
      input.write("\n");
    }
  });
  await runAcceptanceClientPhase(client, "initial", async () => {
    assert.doesNotMatch(text, /Now disconnect/);
    asserted = true;
  });
  assert.equal(promptAfterAssertion, true);
  assert.match(text, /Initial phase complete/);
});

test("reconnect harness asserts active before enforcement and sends no initial acknowledgment", async () => {
  const order: string[] = [];
  const { client, input } = spawnFixture(`
    console.log('JBGH_CLIENT_RECONNECTED');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => process.exit(line === '' ? 0 : 2));
  `);
  await runAcceptanceClientPhase(client, "reconnect", async () => { order.push("active"); }, async () => {
    order.push("deny");
    input.write("\n");
  });
  assert.deepEqual(order, ["active", "deny"]);
  assert.equal(client.child.exitCode, 0);
});

test("client latches markers and successful exit before later waits", async () => {
  const { client } = spawnFixture("console.log('JBGH_CLIENT_READY');");
  try {
    await once(client.child, "close");
    await client.waitForMarker("JBGH_CLIENT_READY");
    await client.waitForExit();
  } finally { await client.dispose(); }
});

test("marker timeout terminates helper and removes operator listeners", async () => {
  const { client, input } = spawnFixture("setInterval(() => {}, 1000);", 30);
  await assert.rejects(runAcceptanceClientPhase(client, "initial", async () => assert.fail("must not assert")), /Timed out/);
  assert.ok(client.child.exitCode !== null || client.child.signalCode !== null);
  assert.equal(input.listenerCount("data"), 0);
});

test("active-session error terminates helper without acknowledging disconnect", async () => {
  const { client } = spawnFixture("console.log('JBGH_CLIENT_READY'); setInterval(() => {}, 1000);");
  await assert.rejects(runAcceptanceClientPhase(client, "initial", async () => { throw new Error("session assertion failed"); }), /session assertion failed/);
  assert.ok(client.child.exitCode !== null || client.child.signalCode !== null);
});

test("completion timeout terminates a helper that never finishes", async () => {
  const { client } = spawnFixture("console.log('JBGH_CLIENT_READY'); setInterval(() => {}, 1000);", 1000);
  await assert.rejects(runAcceptanceClientPhase(client, "initial", async () => {}), /Timed out waiting for client helper completion/);
  assert.ok(client.child.exitCode !== null || client.child.signalCode !== null);
});

test("spawn errors reject and release operator listeners", async () => {
  const input = new PassThrough();
  const client = startAcceptanceClient("jbgh-nonexistent-client-executable", [], { input, output: new PassThrough() });
  await assert.rejects(runAcceptanceClientPhase(client, "initial", async () => {}), /ENOENT/);
  assert.equal(input.listenerCount("data"), 0);
});
