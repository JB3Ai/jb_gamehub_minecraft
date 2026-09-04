import { once } from "events";
import * as minecraft from "minecraft-protocol";
import { startServer } from "../../../server";
import { PaperRconAdapter } from "../../../packages/minecraft-provider/paper-rcon";

const API_PORT = Number(process.env.MINECRAFT_TEST_API_PORT || "3335");
const HOST = process.env.MINECRAFT_HOST || "127.0.0.1";
const JAVA_PORT = Number(process.env.MINECRAFT_JAVA_PORT || "25565");
const PLAYER = process.env.MINECRAFT_ACCEPTANCE_PLAYER || "GameHubAcceptance";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function waitForClientEnd(client: minecraft.Client): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Minecraft client disconnect.")), 10000);
    client.once("end", (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

async function connectPlayer(): Promise<minecraft.Client> {
  const client = minecraft.createClient({
    host: HOST,
    port: JAVA_PORT,
    username: PLAYER,
    auth: "offline",
    version: "1.21.4",
    hideErrors: false,
  });
  const error = new Promise<never>((_, reject) => client.once("error", reject));
  const joined = once(client, "playerJoin").then(() => client);
  await Promise.race([
    joined,
    error,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for Minecraft player join.")), 15000)),
  ]);
  return client;
}

async function waitForSession(apiBase: string, childId: string, status: "active" | "ended"): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await fetchJson<{ sessions: Array<{ status: string }> }>(`${apiBase}/api/children/${childId}/sessions`);
    if (result.sessions.some((session) => session.status === status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${status} session.`);
}

async function main(): Promise<void> {
  const apiBase = `http://127.0.0.1:${API_PORT}`;
  const httpServer = await startServer(API_PORT, {
    minecraftServerDir: process.env.MINECRAFT_SERVER_DIR,
    minecraftHost: HOST,
    minecraftJavaPort: JAVA_PORT,
    minecraftBedrockPort: Number(process.env.MINECRAFT_BEDROCK_PORT || "19132"),
    minecraftRconPort: Number(process.env.MINECRAFT_RCON_PORT || "25575"),
    minecraftRconPassword: process.env.MINECRAFT_RCON_PASSWORD,
  });

  try {
    const family = await fetchJson<{ id: string }>(`${apiBase}/api/families`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "JBGH-018D Acceptance", timezone: "UTC", actor: "acceptance-test" }),
    });
    const child = await fetchJson<{ id: string }>(`${apiBase}/api/families/${family.id}/children`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Minecraft Acceptance Child", timezone: "UTC", actor: "acceptance-test" }),
    });
    const identity = await fetchJson<{ id: string }>(`${apiBase}/api/children/${child.id}/identities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "minecraft",
        externalPlayerId: PLAYER,
        displayName: PLAYER,
        identityType: "minecraft-java",
        verified: true,
        actor: "acceptance-test",
      }),
    });
    const rule = await fetchJson<{ id: string }>(`${apiBase}/api/children/${child.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "DAILY_PLAY_LIMIT",
        enabled: true,
        config: { minutes: 1 },
        actor: "acceptance-test",
      }),
    });
    await fetchJson(`${apiBase}/api/children/${child.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "SESSION_MAX_DURATION",
        enabled: true,
        config: { minutes: 1 },
        actor: "acceptance-test",
      }),
    });

    const firstClient = await connectPlayer();
    await waitForSession(apiBase, child.id, "active");
    firstClient.end("acceptance disconnect");
    await waitForClientEnd(firstClient);
    await waitForSession(apiBase, child.id, "ended");

    const secondClient = await connectPlayer();
    await waitForSession(apiBase, child.id, "active");
    await new Promise((resolve) => setTimeout(resolve, 65_000));
    const evaluation = await fetchJson<{ decision: { decision: string; reason: string }; usage: { dailySeconds: number; weeklySeconds: number } }>(`${apiBase}/api/children/${child.id}/evaluate-access`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "minecraft",
        serverId: "minecraft-main",
        externalPlayerId: PLAYER,
        displayName: PLAYER,
        identityType: "minecraft-java",
        actor: "acceptance-test",
      }),
    });
    if (evaluation.decision.decision !== "DENY") {
      throw new Error(`Expected live policy expiry to deny access, received ${JSON.stringify(evaluation)}`);
    }
    try {
      await waitForClientEnd(secondClient);
    } catch {
      // Paper may close the socket without minecraft-protocol emitting `end`.
    }
    const rcon = new PaperRconAdapter({
      host: HOST,
      port: Number(process.env.MINECRAFT_RCON_PORT || "25575"),
      password: process.env.MINECRAFT_RCON_PASSWORD || "",
    });
    const onlineAfterKick = await rcon.listPlayers();
    if (onlineAfterKick.includes(PLAYER)) {
      throw new Error(`Paper still reports ${PLAYER} online after enforcement.`);
    }
    const audits = await fetchJson<{ audits: Array<{ action: string; metadata?: Record<string, unknown> }> }>(
      `${apiBase}/api/history/audit?providerId=minecraft&limit=100`,
    );
    const kickAudit = audits.audits.find((audit) => audit.action === "policy.denied");
    if (!kickAudit) {
      throw new Error("Missing policy.denied audit after live enforcement.");
    }
    console.log(JSON.stringify({ familyId: family.id, childId: child.id, identityId: identity.id, decision: evaluation.decision, usage: evaluation.usage, kickConfirmed: true, audit: kickAudit }, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
