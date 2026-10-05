import fs from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";
import type { ServerProvisioningRequest } from "../../packages/core/provisioning";
import type { RuntimeAttachmentPolicy } from "../../packages/core/runtime-attachment";
export async function attachedFixture(t: TestContext, kind: "java" | "bedrock", name = "one", port = kind === "java" ? 25571 : 19201) {
  await fs.mkdir("tests/tmp", { recursive: true }); const base = await fs.mkdtemp(path.resolve("tests/tmp/routing-"));
  const root = path.join(base, "runtime"); const world = kind === "java" ? `${name}-world` : `worlds/${name}-world`;
  await fs.mkdir(path.join(root, world), { recursive: true });
  await fs.writeFile(path.join(root, world, "level.dat"), "fixture");
  await fs.writeFile(path.join(root, kind === "java" ? "paper.jar" : "bedrock_server.exe"), "fixture executable, do not run");
  await fs.writeFile(path.join(base, "java.exe"), "fixture java, do not run");
  await fs.writeFile(path.join(root, "server.properties"), `level-name=${name}-world\nserver-port=${port}\n${kind === "bedrock" ? `server-portv6=${port + 1}\n` : ""}`);
  const providerId = kind === "java" ? "minecraft" : "minecraft-bedrock";
  const request: ServerProvisioningRequest = { schemaVersion: 1, providerId, serverId: `attached-${name}`, hostId: "local", storage: { mode: "adopt", locationRef: name }, endpoints: [{ id: "game", protocol: kind === "java" ? "java-paper" : "native-bds", transport: kind === "java" ? "tcp" : "udp", bindAddress: "0.0.0.0", port: { mode: "fixed", value: port } }], ...(kind === "java" ? { providerOptions: { javaRuntimeRef: "java" } } : {}) };
  if (kind === "bedrock") request.endpoints.push({ id: "game-v6", protocol: "native-bds", transport: "udp", bindAddress: "::", port: { mode: "fixed", value: port + 1 } });
  const policy: RuntimeAttachmentPolicy = { hostId: "local", managedRoots: {}, adoptionRoots: [base], adoptionLocations: { [name]: root }, artifactLocations: { java: path.join(base, "java.exe") }, endpointInventory: async () => ({ complete: true, bindings: [] }) };
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, root, request, policy, providerId };
}
