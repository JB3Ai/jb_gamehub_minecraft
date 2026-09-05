import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type http from "node:http";
import { startServer } from "../server";
import { resolveEntitlements } from "../packages/core/rewards";
import { evaluateParentalPolicy } from "../packages/core/family-policy";
import type { RewardLedgerEntry } from "../packages/provider-manager/family-types";

const base = {
  familyId: "family-1",
  childId: "child-1",
  startsAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-09-30T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  actor: "parent-1",
  reason: "Learning milestone",
};

test("reward ledger resolves scoped bonus minutes and temporary access", () => {
  const entries: RewardLedgerEntry[] = [
    { ...base, id: "grant-1", rewardId: "r1", entryType: "grant", rewardType: "BONUS_MINUTES", amountMinutes: 60, providerIds: ["synthetic"], serverIds: ["synthetic-main"] },
    { ...base, id: "consume-1", rewardId: "r1", entryType: "consume", rewardType: "BONUS_MINUTES", amountMinutes: 15 },
    { ...base, id: "grant-2", rewardId: "r2", entryType: "grant", rewardType: "TEMP_SERVER_ACCESS", providerIds: ["synthetic"], serverIds: ["synthetic-classroom"] },
  ];
  const entitlements = resolveEntitlements(entries, {
    childId: "child-1",
    providerId: "synthetic",
    serverId: "synthetic-main",
    at: "2026-09-10T12:00:00.000Z",
  });
  assert.equal(entitlements.bonusMinutes, 45);
  assert.equal(entitlements.temporaryServerAccess, false);
  assert.deepEqual(entitlements.rewardIds, ["r1"]);
});

test("rewards extend limits but cannot bypass schedule or identity safety", () => {
  const child = { id: "child-1", familyId: "family-1", name: "Learner", timezone: "UTC", createdAt: base.createdAt, active: true };
  const decision = evaluateParentalPolicy({
    child,
    providerId: "synthetic",
    serverId: "synthetic-classroom",
    timezone: "UTC",
    currentTimestamp: "2026-09-07T23:30:00.000Z",
    rules: [
      { id: "schedule", familyId: "family-1", childId: "child-1", type: "ALLOWED_SCHEDULE", enabled: true, config: { windows: [{ weekday: "Mon", start: "09:00", end: "17:00" }] }, createdAt: base.createdAt, updatedAt: base.createdAt },
      { id: "access", familyId: "family-1", childId: "child-1", type: "SERVER_ACCESS", enabled: true, config: { allowedServers: ["synthetic-main"] }, createdAt: base.createdAt, updatedAt: base.createdAt },
    ],
    playerIdentity: {
      id: "identity-1", familyId: "family-1", childId: "child-1", providerId: "synthetic", externalPlayerId: "player-1",
      displayName: "Learner", identityType: "synthetic", verified: true, createdAt: base.createdAt,
    },
    dailyUsageSeconds: 9999,
    weeklyUsageSeconds: 9999,
    activeOverrides: [],
    entitlements: {
      childId: "child-1", providerId: "synthetic", serverId: "synthetic-classroom", evaluatedAt: "2026-09-07T23:30:00.000Z",
      bonusMinutes: 120, temporaryServerAccess: true, rewardIds: ["r1", "r2"],
    },
  });
  assert.equal(decision.reason, "OUTSIDE_SCHEDULE");
});

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("reward API persists grants, resolves entitlements, and audits mutations", async () => {
  const dbPath = path.resolve(process.cwd(), "tests", "tmp", `rewards-api-${Date.now()}.sqlite`);
  const server = await startServer(3333, {
    minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
    aiProvider: "fallback",
  });
  const json = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const body = await response.json() as Record<string, any>;
    assert.equal(response.ok, true, `${response.status}: ${JSON.stringify(body)}`);
    return body;
  };
  const post = (url: string, body: Record<string, unknown>) => json(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    const family = await post("http://127.0.0.1:3333/api/families", { name: "Rewards Family", timezone: "UTC" });
    const child = await post(`http://127.0.0.1:3333/api/families/${family.id}/children`, { name: "Learner" });
    await post(`http://127.0.0.1:3333/api/children/${child.id}/identities`, {
      providerId: "synthetic", externalPlayerId: "learner", displayName: "Learner", identityType: "synthetic", verified: true,
    });
    await post(`http://127.0.0.1:3333/api/children/${child.id}/rules`, {
      type: "DAILY_PLAY_LIMIT", enabled: true, config: { minutes: 10 },
    });
    const reward = await post(`http://127.0.0.1:3333/api/children/${child.id}/rewards`, {
      type: "BONUS_MINUTES", amountMinutes: 30, providerId: "synthetic", serverId: "synthetic-main",
      startsAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-20T00:00:00.000Z", reason: "Completed lesson",
    });
    const entitlements = await json(`http://127.0.0.1:3333/api/children/${child.id}/entitlements?providerId=synthetic&serverId=synthetic-main&at=2026-09-10T12:00:00.000Z`);
    assert.equal(entitlements.entitlements.bonusMinutes, 30);
    const ledger = await json(`http://127.0.0.1:3333/api/children/${child.id}/rewards`);
    assert.equal(ledger.rewards[0].rewardId, reward.rewardId);
    const audits = await json("http://127.0.0.1:3333/api/history/audit?limit=100");
    assert.ok(audits.audits.some((entry: { action: string }) => entry.action === "reward.granted"));
  } finally {
    await closeServer(server);
  }
});
