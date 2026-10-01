import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type http from "http";
import { startServer } from "../server";
import { evaluateParentalPolicy } from "../packages/core/family-policy";
import type { ParentalRule } from "../packages/provider-manager/family-types";
import { InMemoryProviderManager } from "../packages/provider-manager/index";
import { SyntheticProvider } from "../packages/synthetic-provider/index";
import { FamilyService } from "../packages/core/family-service";

function testDbPath(name: string): string {
  return path.resolve(process.cwd(), "tests", "tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sqlite`);
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

test("family API creates family, child, identity, and rules", async () => {
  const server = await startServer(3321, {
    minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: testDbPath("family-api"),
    aiProvider: "fallback",
  });

  try {
    const familyRes = await fetch("http://127.0.0.1:3321/api/families", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cousins Crew", timezone: "UTC" }),
    });
    assert.equal(familyRes.status, 201);
    const family = (await familyRes.json()) as { id: string; name: string; timezone: string };
    assert.equal(family.name, "Cousins Crew");

    const childRes = await fetch(`http://127.0.0.1:3321/api/families/${family.id}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Skyler", timezone: "UTC" }),
    });
    assert.equal(childRes.status, 201);
    const child = (await childRes.json()) as { id: string; familyId: string };
    assert.equal(child.familyId, family.id);

    const identityRes = await fetch(`http://127.0.0.1:3321/api/children/${child.id}/identities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "minecraft",
        externalPlayerId: "skyler-java",
        displayName: "Skyler",
        identityType: "java_uuid",
      }),
    });
    assert.equal(identityRes.status, 201);
    const identity = (await identityRes.json()) as { childId: string; providerId: string; externalPlayerId: string };
    assert.equal(identity.childId, child.id);

    const ruleRes = await fetch(`http://127.0.0.1:3321/api/children/${child.id}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "DAILY_PLAY_LIMIT",
        enabled: true,
        config: { minutes: 120 },
      }),
    });
    assert.equal(ruleRes.status, 201);
    const rule = (await ruleRes.json()) as { type: string; enabled: boolean };
    assert.equal(rule.type, "DAILY_PLAY_LIMIT");
    assert.equal(rule.enabled, true);

    const evaluateRes = await fetch(`http://127.0.0.1:3321/api/children/${child.id}/evaluate-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "minecraft",
        serverId: "minecraft-main",
        externalPlayerId: "skyler-java",
        displayName: "Skyler",
        identityType: "java_uuid",
      }),
    });
    assert.equal(evaluateRes.status, 200);
    const evaluateBody = (await evaluateRes.json()) as { decision: { decision: string; reason: string } };
    assert.ok(["ALLOW", "ALLOW_UNTIL"].includes(evaluateBody.decision.decision));
  } finally {
    await closeServer(server);
  }
});

test("synthetic family lifecycle survives persistence restart", async () => {
  const dbPath = testDbPath("family-restart");
  const server = await startServer(3322, {
    minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: dbPath,
    aiProvider: "fallback",
  });

  try {
    const json = async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init);
      const body = (await response.json()) as Record<string, any>;
      assert.equal(response.ok, true, `${response.status} ${url}: ${JSON.stringify(body)}`);
      return body;
    };
    const post = (url: string, body: Record<string, unknown>) =>
      json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const family = await post("http://127.0.0.1:3322/api/families", { name: "Synthetic Family", timezone: "UTC" });
    const child = await post(`http://127.0.0.1:3322/api/families/${family.id}/children`, { name: "Test Child" });
    await post(`http://127.0.0.1:3322/api/children/${child.id}/identities`, {
      providerId: "synthetic",
      externalPlayerId: "synthetic-player",
      displayName: "Synthetic Player",
      identityType: "synthetic",
      verified: true,
    });
    await post(`http://127.0.0.1:3322/api/children/${child.id}/rules`, {
      type: "DAILY_PLAY_LIMIT",
      enabled: true,
      config: { minutes: 90 },
    });
    const override = await post(`http://127.0.0.1:3322/api/children/${child.id}/overrides`, {
      createdBy: "parent-1",
      reason: "Acceptance test",
      startsAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const access = await post(`http://127.0.0.1:3322/api/children/${child.id}/evaluate-access`, {
      providerId: "synthetic",
      serverId: "synthetic-main",
      externalPlayerId: "synthetic-player",
      timestamp: "2025-01-02T12:00:00.000Z",
    });
    assert.equal(access.decision.reason, "PARENT_OVERRIDE_ACTIVE", JSON.stringify(access));
    assert.ok(access.session, JSON.stringify(access));
    assert.equal(access.session.status, "active");
    await post(`http://127.0.0.1:3322/api/children/${child.id}/sessions/${access.session.id}/end`, {
      reason: "acceptance_complete",
      at: "2025-01-02T12:30:00.000Z",
    });
    await closeServer(server);

    const restarted = await startServer(3322, {
      minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
      minecraftStartCommand: "node -e \"process.exit(0)\"",
      minecraftStopCommand: "node -e \"process.exit(0)\"",
      persistenceDbPath: dbPath,
      aiProvider: "fallback",
    });
    try {
      const children = await json(`http://127.0.0.1:3322/api/families/${family.id}/children`);
      const sessions = await json(`http://127.0.0.1:3322/api/children/${child.id}/sessions`);
      const overrides = await json(`http://127.0.0.1:3322/api/children/${child.id}/overrides`);
      const rules = await json(`http://127.0.0.1:3322/api/children/${child.id}/rules`);
      const audit = await json("http://127.0.0.1:3322/api/history/audit?limit=100");
      assert.equal(children.children[0].id, child.id);
      assert.equal(sessions.sessions[0].status, "ended");
      assert.equal(sessions.sessions[0].durationSeconds, 1800);
      assert.equal(overrides.overrides[0].id, override.id);
      assert.equal(rules.rules[0].type, "DAILY_PLAY_LIMIT");
      assert.ok(audit.audits.some((entry: { action: string }) => entry.action === "session.ended"));
    } finally {
      await closeServer(restarted);
    }
  } catch (error) {
    try {
      await closeServer(server);
    } catch {
      // The server may already have been closed before a restart failure.
    }
    throw error;
  }
});

test("evaluateParentalPolicy enforces daily, weekly, bedtime, schedule, and override semantics", () => {
  const baseChild = {
    id: "child_123",
    familyId: "family_123",
    name: "Skyler",
    timezone: "UTC",
    createdAt: "2025-01-01T00:00:00.000Z",
    active: true,
  };

  const identity = {
    id: "identity_123",
    familyId: "family_123",
    childId: "child_123",
    providerId: "minecraft",
    externalPlayerId: "skyler-java",
    displayName: "Skyler",
    identityType: "java_uuid",
    verified: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  const allowedSchedule: ParentalRule = {
    id: "rule_schedule",
    familyId: "family_123",
    childId: "child_123",
    type: "ALLOWED_SCHEDULE",
    enabled: true,
    config: {
      windows: [{ weekday: "Mon", start: "00:00", end: "23:59" }],
    },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };

  const withinLimit = evaluateParentalPolicy({
    child: baseChild,
    providerId: "minecraft",
    serverId: "minecraft-main",
    playerIdentity: identity,
    timezone: "UTC",
    currentTimestamp: "2025-01-06T12:00:00.000Z",
    rules: [
      allowedSchedule,
      {
        ...allowedSchedule,
        id: "rule_daily",
        type: "DAILY_PLAY_LIMIT",
        config: { minutes: 120 },
      },
      {
        ...allowedSchedule,
        id: "rule_weekly",
        type: "WEEKLY_PLAY_LIMIT",
        config: { minutes: 300 },
      },
    ],
    dailyUsageSeconds: 30 * 60,
    weeklyUsageSeconds: 90 * 60,
    activeOverrides: [],
  });

  assert.equal(withinLimit.decision, "ALLOW");

  const deniedByDaily = evaluateParentalPolicy({
    child: baseChild,
    providerId: "minecraft",
    serverId: "minecraft-main",
    playerIdentity: identity,
    timezone: "UTC",
    currentTimestamp: "2025-01-06T12:00:00.000Z",
    rules: [
      allowedSchedule,
      { ...allowedSchedule, id: "rule_daily", type: "DAILY_PLAY_LIMIT", config: { minutes: 120 } },
    ],
    dailyUsageSeconds: 120 * 60,
    weeklyUsageSeconds: 90 * 60,
    activeOverrides: [],
  });
  assert.equal(deniedByDaily.reason, "DAILY_LIMIT_REACHED");

  const deniedBySchedule = evaluateParentalPolicy({
    child: baseChild,
    providerId: "minecraft",
    serverId: "minecraft-main",
    playerIdentity: identity,
    timezone: "UTC",
    currentTimestamp: "2025-01-07T12:00:00.000Z",
    rules: [
      { ...allowedSchedule, id: "rule_schedule", config: { windows: [{ weekday: "Mon", start: "09:00", end: "17:00" }] } },
    ],
    dailyUsageSeconds: 0,
    weeklyUsageSeconds: 0,
    activeOverrides: [],
  });
  assert.equal(deniedBySchedule.reason, "OUTSIDE_SCHEDULE");

  const deniedByBedtime = evaluateParentalPolicy({
    child: baseChild,
    providerId: "synthetic",
    serverId: "synthetic-main",
    playerIdentity: {
      ...identity,
      providerId: "synthetic",
      externalPlayerId: "skyler-synth",
    },
    timezone: "UTC",
    currentTimestamp: "2025-01-06T23:30:00.000Z",
    rules: [
      { ...allowedSchedule, id: "rule_bedtime", type: "BEDTIME", config: { start: "22:00", end: "06:00" } },
    ],
    dailyUsageSeconds: 0,
    weeklyUsageSeconds: 0,
    activeOverrides: [],
  });
  assert.equal(deniedByBedtime.reason, "BEDTIME_ACTIVE");

  const overrideAllows = evaluateParentalPolicy({
    child: baseChild,
    providerId: "minecraft",
    serverId: "minecraft-main",
    playerIdentity: identity,
    timezone: "UTC",
    currentTimestamp: "2025-01-06T12:00:00.000Z",
    rules: [
      { ...allowedSchedule, id: "rule_daily", type: "DAILY_PLAY_LIMIT", config: { minutes: 15 } },
    ],
    dailyUsageSeconds: 20 * 60,
    weeklyUsageSeconds: 60 * 60,
    activeOverrides: [
      {
        id: "override_1",
        familyId: "family_123",
        childId: "child_123",
        createdBy: "parent-1",
        scope: { serverId: "minecraft-main" },
        reason: "Weekend exception",
        startsAt: "2025-01-05T00:00:00.000Z",
        expiresAt: "2025-01-07T00:00:00.000Z",
        createdAt: "2025-01-05T00:00:00.000Z",
      },
    ],
  });
  assert.equal(overrideAllows.reason, "PARENT_OVERRIDE_ACTIVE");

  const scopedOverrideDoesNotAllowOtherServer = evaluateParentalPolicy({
    child: baseChild,
    providerId: "minecraft",
    serverId: "minecraft-other",
    playerIdentity: identity,
    timezone: "UTC",
    currentTimestamp: "2025-01-06T12:00:00.000Z",
    rules: [
      { ...allowedSchedule, id: "rule_daily", type: "DAILY_PLAY_LIMIT", config: { minutes: 15 } },
    ],
    dailyUsageSeconds: 20 * 60,
    weeklyUsageSeconds: 60 * 60,
    activeOverrides: [
      {
        id: "override_1",
        familyId: "family_123",
        childId: "child_123",
        createdBy: "parent-1",
        scope: { serverId: "minecraft-main" },
        reason: "Weekend exception",
        startsAt: "2025-01-05T00:00:00.000Z",
        expiresAt: "2025-01-07T00:00:00.000Z",
        createdAt: "2025-01-05T00:00:00.000Z",
      },
    ],
  });
  assert.equal(scopedOverrideDoesNotAllowOtherServer.reason, "DAILY_LIMIT_REACHED");

  const sessionAllowed = evaluateParentalPolicy({
    child: baseChild,
    providerId: "synthetic",
    serverId: "synthetic-main",
    playerIdentity: {
      ...identity,
      providerId: "synthetic",
      externalPlayerId: "skyler-synth",
    },
    timezone: "UTC",
    currentTimestamp: "2025-01-06T12:00:00.000Z",
    rules: [
      { ...allowedSchedule, id: "rule_session", type: "SESSION_MAX_DURATION", config: { minutes: 30 } },
    ],
    dailyUsageSeconds: 0,
    weeklyUsageSeconds: 0,
    activeSession: {
      id: "session_1",
      familyId: "family_123",
      childId: "child_123",
      providerId: "synthetic",
      serverId: "synthetic-main",
      playerIdentityId: "identity_123",
      startedAt: "2025-01-06T11:00:00.000Z",
      durationSeconds: 0,
      status: "active",
    },
    activeOverrides: [],
  });
  assert.equal(sessionAllowed.reason, "ALLOWED");

  const sessionDenied = evaluateParentalPolicy({
    child: baseChild,
    providerId: "synthetic",
    serverId: "synthetic-main",
    playerIdentity: {
      ...identity,
      providerId: "synthetic",
      externalPlayerId: "skyler-synth",
    },
    timezone: "UTC",
    currentTimestamp: "2025-01-06T12:00:00.000Z",
    rules: [
      { ...allowedSchedule, id: "rule_session", type: "SESSION_MAX_DURATION", config: { minutes: 30 } },
    ],
    dailyUsageSeconds: 0,
    weeklyUsageSeconds: 0,
    activeSession: {
      id: "session_1",
      familyId: "family_123",
      childId: "child_123",
      providerId: "synthetic",
      serverId: "synthetic-main",
      playerIdentityId: "identity_123",
      startedAt: "2025-01-06T11:00:00.000Z",
      durationSeconds: 3600,
      status: "active",
    },
    activeOverrides: [],
  });
  assert.equal(sessionDenied.reason, "SESSION_LIMIT_REACHED");
});

test("provider player lifecycle creates, reconnects, and ends durable sessions", async () => {
  const manager = new InMemoryProviderManager();
  await manager.initialize();
  const provider = new SyntheticProvider();
  await manager.register(provider);
  const familyService = new FamilyService(manager);
  const unbind = familyService.bindPlayerLifecycle();

  try {
    const family = await familyService.createFamily({ name: "Lifecycle Family", timezone: "UTC" });
    const child = await familyService.createChild({ familyId: family.id, name: "Player One", timezone: "UTC" });
    await familyService.linkIdentity({
      childId: child.id,
      providerId: "synthetic",
      externalPlayerId: "player-one",
      displayName: "Player One",
      identityType: "synthetic",
      verified: true,
    });
    await familyService.createRule({
      familyId: family.id,
      childId: child.id,
      type: "DAILY_PLAY_LIMIT",
      enabled: true,
      config: { minutes: 2 },
    });

    provider.simulatePlayerJoin("player-one", "Player One", "synthetic-main", "2025-01-06T12:00:00.000Z");
    await new Promise((resolve) => setTimeout(resolve, 25));
    let sessions = await familyService.listSessions(child.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "active");

    provider.simulatePlayerLeave("player-one", "synthetic-main", "2025-01-06T12:00:30.000Z");
    await new Promise((resolve) => setTimeout(resolve, 25));
    sessions = await familyService.listSessions(child.id);
    assert.equal(sessions[0].status, "ended");
    assert.equal(sessions[0].durationSeconds, 30);

    provider.simulatePlayerJoin("player-one", "Player One", "synthetic-main", "2025-01-06T12:01:00.000Z");
    await new Promise((resolve) => setTimeout(resolve, 25));
    sessions = await familyService.listSessions(child.id);
    assert.equal(sessions.length, 2);
    assert.equal((await familyService.getPlaytime(child.id, "2025-01-06T12:01:30.000Z")).dailySeconds, 60);
  } finally {
    unbind();
    await manager.shutdown();
  }
});
