import assert from "node:assert/strict";
import test from "node:test";
import { JavaRuntimeAttachments } from "../packages/minecraft-provider/runtime-attachment";
import { JavaProvisioningPlanner } from "../packages/minecraft-provider/provisioning";
import type { ServerProvisioningRequest } from "../packages/core/provisioning";

const properties = "server-port=25565\nserver-ip=127.0.0.1\nenable-rcon=false\nenable-query=false\nlevel-name=Acceptance World\n";
async function inspect(configuration: string, worldName = "Acceptance World", directoryExists = true) {
  const request: ServerProvisioningRequest = {
    schemaVersion: 1, providerId: "minecraft", serverId: "attached-java", hostId: "local",
    storage: { mode: "adopt", locationRef: "runtime" },
    endpoints: [{ id: "game", protocol: "java-paper", transport: "tcp", bindAddress: "127.0.0.1", port: { mode: "fixed", value: 25565 } }],
    providerOptions: { javaRuntimeRef: "java", worldName },
  };
  const plan = await new JavaProvisioningPlanner().plan(request);
  const directories: string[] = [];
  const result = await new JavaRuntimeAttachments().inspect(plan, {
    readText: async (file) => { assert.equal(file, "server.properties"); return configuration; },
    directory: async (world) => { directories.push(world); return directoryExists; },
  });
  return { result, directories };
}

test("Java attachment accepts Paper's escaped level-type without changing consumed values", async () => {
  const baseline = await inspect(properties);
  const escaped = await inspect(properties + "level-type=minecraft\\:normal\nmotd=ignore\\nserver-port=25566\n");
  assert.deepEqual(escaped, baseline);
  assert.deepEqual(escaped.result.worlds, ["Acceptance World"]);
  assert.deepEqual(escaped.directories, ["Acceptance World"]);
});

for (const line of ["malformed active line", "server-port:25565", "level\\-name=other"]) {
  test(`Java attachment still rejects malformed active property: ${line}`, async () => {
    await assert.rejects(inspect(properties + line + "\n"), /key=value/);
  });
}

for (const key of ["server-port", "server-portv6", "server-ip", "enable-rcon", "enable-query", "level-name"]) {
  test(`Java attachment rejects unsupported escaping in consumed property ${key}`, async () => {
    await assert.rejects(inspect(properties + key + "=unsupported\\:value\n"), /unescaped key=value/);
  });
}

for (const [key, value] of [["server-port", "25566"], ["server-ip", "0.0.0.0"]]) {
  test(`Java attachment preserves endpoint mismatch rejection for ${key}`, async () => {
    await assert.rejects(inspect(properties + key + "=" + value + "\nlevel-type=minecraft\\:normal\n"), /endpoint does not match/);
  });
}

test("Java attachment preserves explicit compatible level-name and world directory checks", async () => {
  await assert.rejects(inspect(properties, "Different World"), /compatible level-name/);
  await assert.rejects(inspect(properties.replace("level-name=Acceptance World\n", "")), /compatible level-name/);
  await assert.rejects(inspect(properties + "level-name=\n"), /compatible level-name/);
  assert.deepEqual((await inspect(properties, "Acceptance World", false)).result.worlds, []);
});

for (const key of ["enable-rcon", "enable-query"]) {
  for (const value of ["true", "TRUE"]) {
    test(`Java attachment still rejects ${key}=${value}`, async () => {
      await assert.rejects(inspect(properties + key + "=" + value + "\nlevel-type=minecraft\\:normal\n"), /auxiliary Java listeners/);
    });
  }
}
