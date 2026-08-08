import { bootstrapCore } from "../../../packages/core/index";

function resolveEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function waitForOffline(manager: Awaited<ReturnType<typeof bootstrapCore>>, serverId: string, maxChecks = 20) {
  for (let i = 0; i < maxChecks; i += 1) {
    const status = await manager.getServerStatus(serverId);
    if (status.status === "offline") {
      return status.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return (await manager.getServerStatus(serverId)).status;
}

async function main() {
  const serverDir = resolveEnv("MINECRAFT_SERVER_DIR", "./integration/minecraft/server");
  const host = resolveEnv("MINECRAFT_HOST", "127.0.0.1");
  const javaPort = Number(resolveEnv("MINECRAFT_JAVA_PORT", "25565"));
  const bedrockPort = Number(resolveEnv("MINECRAFT_BEDROCK_PORT", "19132"));

  const manager = await bootstrapCore({
    minecraftServerDir: serverDir,
    minecraftHost: host,
    minecraftJavaPort: javaPort,
    minecraftBedrockPort: bedrockPort,
    minecraftStartCommand: "npx tsx ../scripts/manage.ts start",
    minecraftStopCommand: "npx tsx ../scripts/manage.ts stop",
  });

  const servers = await manager.listServers();
  const server = servers[0];
  if (!server) {
    throw new Error("No server exposed by provider");
  }

  console.log("Provider lifecycle check");
  console.log(`Server: ${server.id}`);

  const before = await manager.getServerStatus(server.id);
  console.log(`Status before start: ${before.status}`);

  const startRef = await manager.startServer(server.id);
  const startRecord = await manager.getOperation(startRef.operationId);
  console.log(`Start operation: ${startRef.operationId} (${startRecord?.status})`);

  const afterStart = await manager.getServerStatus(server.id);
  console.log(`Status after start: ${afterStart.status}`);

  const stopRef = await manager.stopServer(server.id);
  const stopRecord = await manager.getOperation(stopRef.operationId);
  console.log(`Stop operation: ${stopRef.operationId} (${stopRecord?.status})`);

  const afterStop = await waitForOffline(manager, server.id);
  console.log(`Status after stop: ${afterStop}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
