import { once } from "events";
import path from "path";
import * as minecraft from "minecraft-protocol";
import { startServer } from "../../../server";
import { PaperRconAdapter } from "../../../packages/minecraft-provider/paper-rcon";

const API_PORT = Number(process.env.MINECRAFT_TEST_API_PORT || "3335");
const HOST = process.env.MINECRAFT_HOST || "127.0.0.1";
const JAVA_PORT = Number(process.env.MINECRAFT_JAVA_PORT || "25565");
const PLAYER = process.env.MINECRAFT_ACCEPTANCE_PLAYER || "JBGHReward019";

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
  let lastSessions: Array<{ status: string }> = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await fetchJson<{ sessions: Array<{ status: string }> }>(`${apiBase}/api/children/${childId}/sessions`);
    lastSessions = result.sessions;
    if (result.sessions.some((session) => session.status === status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${status} session. Current sessions: ${JSON.stringify(lastSessions)}`);
}

async function main(): Promise<void> {
  const apiBase = `http://127.0.0.1:${API_PORT}`;
  const httpServer = await startServer(API_PORT, {
    minecraftServerDir: process.env.MINECRAFT_SERVER_DIR || path.resolve("integration/minecraft/server"),
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
    await fetchJson(`${apiBase}/api/children/${child.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "DAILY_PLAY_LIMIT",
        enabled: true,
        config: { minutes: 1 },
        actor: "acceptance-test",
      }),
    });
    // Exhaust the base allowance with a real Paper session before any reward exists.
    const firstClient = await connectPlayer();
    await waitForSession(apiBase, child.id, "active");
    await new Promise((resolve) => setTimeout(resolve, 65_000));
    const baseDenied = await fetchJson<{ decision: { decision: string; reason: string } }>(`${apiBase}/api/children/${child.id}/evaluate-access`, {
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
    if (baseDenied.decision.decision !== "DENY") {
      throw new Error(`Expected exhausted base allowance to deny access, received ${JSON.stringify(baseDenied)}`);
    }
    firstClient.end("acceptance disconnect");
    try {
      await waitForClientEnd(firstClient);
    } catch {
      // Enforcement may close the socket before minecraft-protocol emits `end`.
    }
    await waitForSession(apiBase, child.id, "ended");
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const reward = await fetchJson<{ rewardId: string; id: string }>(`${apiBase}/api/children/${child.id}/rewards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rewardType: "BONUS_MINUTES",
        amountMinutes: 2,
        providerId: "minecraft",
        serverId: "minecraft-main",
        startsAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        actor: "acceptance-parent",
        reason: "Reward acceptance bonus",
      }),
    });

    const bedtimeRule = await fetchJson<{ id: string }>(`${apiBase}/api/children/${child.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "BEDTIME",
        enabled: true,
        config: { start: "00:00", end: "23:59" },
        actor: "acceptance-test",
      }),
    });

    const blockedByBedtime = await fetchJson<{ decision: { decision: string; reason: string } }>(`${apiBase}/api/children/${child.id}/evaluate-access`, {
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
    if (blockedByBedtime.decision.decision !== "DENY" || blockedByBedtime.decision.reason !== "BEDTIME_ACTIVE") {
      throw new Error(`Expected bedtime to override reward entitlement, received ${JSON.stringify(blockedByBedtime)}`);
    }

    await fetchJson(`${apiBase}/api/rules/${bedtimeRule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, actor: "acceptance-parent" }),
    });

    const entitlementBefore = await fetchJson<{ entitlements: { bonusMinutes: number; rewardIds: string[] } }>(
      `${apiBase}/api/children/${child.id}/entitlements?providerId=minecraft&serverId=minecraft-main`,
    );
    if (entitlementBefore.entitlements.bonusMinutes !== 2 || !entitlementBefore.entitlements.rewardIds.length) {
      throw new Error(`Expected reward entitlement before consumption, received ${JSON.stringify(entitlementBefore)}`);
    }

    const secondClient = await connectPlayer();
    await waitForSession(apiBase, child.id, "active");
    await fetchJson(`${apiBase}/api/rewards/${reward.rewardId || reward.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountMinutes: 1, actor: "acceptance-system" }),
    });
    const entitlementAfterConsumption = await fetchJson<{ entitlements: { bonusMinutes: number } }>(
      `${apiBase}/api/children/${child.id}/entitlements?providerId=minecraft&serverId=minecraft-main`,
    );
    if (entitlementAfterConsumption.entitlements.bonusMinutes !== 1) {
      throw new Error(`Expected one reward minute to remain, received ${JSON.stringify(entitlementAfterConsumption)}`);
    }
    secondClient.end("acceptance reconnect");
    try {
      await waitForClientEnd(secondClient);
    } catch {
      // Paper may close the socket without minecraft-protocol emitting `end`.
    }
    await waitForSession(apiBase, child.id, "ended");

    const reconnectClient = await connectPlayer();
    let reconnectLifecycleFallback = false;
    try {
      await waitForSession(apiBase, child.id, "active");
    } catch {
      const reconnectEvaluation = await fetchJson<{ decision: { decision: string; reason: string } }>(`${apiBase}/api/children/${child.id}/evaluate-access`, {
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
      if (reconnectEvaluation.decision.decision !== "ALLOW") {
        throw new Error(`Reconnect policy did not allow the reward-backed player: ${JSON.stringify(reconnectEvaluation)}`);
      }
      reconnectLifecycleFallback = true;
      await waitForSession(apiBase, child.id, "active");
    }
    const entitlementAfterReconnect = await fetchJson<{ entitlements: { bonusMinutes: number } }>(
      `${apiBase}/api/children/${child.id}/entitlements?providerId=minecraft&serverId=minecraft-main`,
    );
    if (entitlementAfterReconnect.entitlements.bonusMinutes !== 1) {
      throw new Error(`Expected remaining reward minute after reconnect, received ${JSON.stringify(entitlementAfterReconnect)}`);
    }
    await fetchJson(`${apiBase}/api/rewards/${reward.rewardId || reward.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountMinutes: 1, actor: "acceptance-system" }),
    });
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
      throw new Error(`Expected exhausted reward to deny access, received ${JSON.stringify(evaluation)}`);
    }
    try {
      await waitForClientEnd(reconnectClient);
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
      `${apiBase}/api/history/audit?limit=200`,
    );
    const childAudits = audits.audits.filter((audit) => audit.metadata?.childId === child.id);
    const requiredAuditActions = ["reward.granted", "reward.redeemed", "policy.denied"];
    for (const action of requiredAuditActions) {
      if (!childAudits.some((audit) => audit.action === action)) {
        throw new Error(`Missing ${action} audit after reward enforcement.`);
      }
    }
    const rewards = await fetchJson<{ rewards: Array<{ rewardId: string; entryType: string }> }>(`${apiBase}/api/children/${child.id}/rewards`);
    if (rewards.rewards.filter((entry) => entry.rewardId === (reward.rewardId || reward.id)).length < 3) {
      throw new Error(`Expected grant plus two consumption ledger entries, received ${JSON.stringify(rewards)}`);
    }
    console.log(JSON.stringify({
      familyId: family.id,
      childId: child.id,
      identityId: identity.id,
      baseDenied: baseDenied.decision,
      bedtimeDenied: blockedByBedtime.decision,
      entitlementBefore: entitlementBefore.entitlements,
      entitlementAfterConsumption: entitlementAfterConsumption.entitlements,
      entitlementAfterReconnect: entitlementAfterReconnect.entitlements,
      decision: evaluation.decision,
      usage: evaluation.usage,
      kickConfirmed: true,
      dashboardReconciled: rewards.rewards.length >= 3,
      reconnectLifecycleFallback,
      auditActions: requiredAuditActions,
    }, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
