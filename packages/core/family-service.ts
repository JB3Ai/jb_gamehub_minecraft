import {
  AuditWriteInput,
  ChildProfile,
  Family,
  FamilyPlaytimeSummary,
  InMemoryProviderManager,
  ParentMembership,
  ParentOverride,
  ParentalRule,
  PlaySession,
  PlayerIdentity,
  PolicyDecision,
  ProviderPlayerLifecycleEvent,
} from "../provider-manager/index";
import { evaluateParentalPolicy, PolicyReasonCode } from "./family-policy";

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function dayStartIso(timestamp: string, timezone: string): string {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
  const normalized = local.replace(/\//g, "-");
  return new Date(`${normalized}T00:00:00.000Z`).toISOString();
}

function weekStartIso(timestamp: string, timezone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const day = dtf.format(new Date(timestamp)).toLowerCase();
  const index = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(day);
  const start = Date.parse(dayStartIso(timestamp, timezone)) - index * 24 * 60 * 60 * 1000;
  return new Date(start).toISOString();
}

export interface EvaluateAccessInput {
  childId: string;
  providerId: string;
  serverId: string;
  externalPlayerId: string;
  displayName?: string;
  identityType?: string;
  timestamp?: string;
  actor?: string;
}

export interface EvaluateAccessOutput {
  child: ChildProfile;
  identity: PlayerIdentity;
  decision: PolicyDecision;
  usage: FamilyPlaytimeSummary;
  session?: PlaySession;
}

export class FamilyService {
  constructor(private readonly manager: InMemoryProviderManager) {}

  bindPlayerLifecycle(): () => void {
    return this.manager.onPlayerEvent((event) => {
      void this.handlePlayerLifecycle(event);
    });
  }

  private async handlePlayerLifecycle(event: ProviderPlayerLifecycleEvent): Promise<void> {
    const families = await this.manager.listFamilies();
    for (const family of families) {
      const children = await this.manager.listChildProfiles(family.id);
      for (const child of children) {
        const identity = (await this.manager.listPlayerIdentitiesByChild(child.id)).find(
          (item) => item.providerId === event.providerId && item.externalPlayerId === event.externalPlayerId,
        );
        if (!identity) {
          continue;
        }

        if (event.type === "player.joined") {
          await this.evaluateAccess({
            childId: child.id,
            providerId: event.providerId,
            serverId: event.serverId,
            externalPlayerId: event.externalPlayerId,
            displayName: event.displayName,
            identityType: event.identityType,
            timestamp: event.timestamp,
            actor: "system/provider-event",
          });
        } else {
          const session = await this.manager.findActivePlaySession(child.id, event.providerId, event.serverId, identity.id);
          if (session) {
            await this.endSession(session.id, "player.left", "system/provider-event", event.timestamp);
          }
        }
        return;
      }
    }
  }

  async createFamily(input: { name: string; timezone: string; actor?: string; metadata?: Record<string, unknown> }): Promise<Family> {
    const now = new Date().toISOString();
    const family: Family = {
      id: createId("family"),
      name: input.name,
      timezone: input.timezone,
      createdAt: now,
      metadata: input.metadata,
    };
    await this.manager.createFamily(family);
    await this.writeAudit({
      actor: input.actor || "parent-admin",
      action: "family.created",
      familyId: family.id,
      result: "completed",
    });
    return family;
  }

  async listFamilies(): Promise<Family[]> {
    return this.manager.listFamilies();
  }

  async getFamily(familyId: string): Promise<Family | undefined> {
    return this.manager.getFamily(familyId);
  }

  async addParentMembership(input: {
    familyId: string;
    parentId: string;
    role: "parent" | "admin";
    actor?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ParentMembership> {
    const parent: ParentMembership = {
      id: createId("parent"),
      familyId: input.familyId,
      parentId: input.parentId,
      role: input.role,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await this.manager.createParentMembership(parent);
    await this.writeAudit({
      actor: input.actor || input.parentId,
      action: "parent.membership.created",
      familyId: input.familyId,
      result: "completed",
      metadata: { parentId: input.parentId, role: input.role },
    });
    return parent;
  }

  async createChild(input: {
    familyId: string;
    name: string;
    timezone?: string;
    actor?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChildProfile> {
    const child: ChildProfile = {
      id: createId("child"),
      familyId: input.familyId,
      name: input.name,
      timezone: input.timezone,
      createdAt: new Date().toISOString(),
      active: true,
      metadata: input.metadata,
    };
    await this.manager.createChildProfile(child);
    await this.writeAudit({
      actor: input.actor || "parent-admin",
      action: "child.created",
      familyId: input.familyId,
      childId: child.id,
      result: "completed",
    });
    return child;
  }

  async listChildren(familyId: string): Promise<ChildProfile[]> {
    return this.manager.listChildProfiles(familyId);
  }

  async getChild(childId: string): Promise<ChildProfile | undefined> {
    return this.manager.getChildProfile(childId);
  }

  async updateChild(childId: string, patch: Partial<Pick<ChildProfile, "name" | "timezone" | "active" | "metadata">>): Promise<ChildProfile> {
    const current = await this.manager.getChildProfile(childId);
    if (!current) {
      throw new Error(`Child not found: ${childId}`);
    }
    const next: ChildProfile = {
      ...current,
      ...patch,
    };
    await this.manager.upsertChildProfile(next);
    return next;
  }

  async linkIdentity(input: {
    childId: string;
    providerId: string;
    externalPlayerId: string;
    displayName: string;
    identityType: string;
    verified?: boolean;
    metadata?: Record<string, unknown>;
    actor?: string;
  }): Promise<PlayerIdentity> {
    const child = await this.manager.getChildProfile(input.childId);
    if (!child) {
      throw new Error(`Child not found: ${input.childId}`);
    }

    const identity: PlayerIdentity = {
      id: createId("identity"),
      familyId: child.familyId,
      childId: child.id,
      providerId: input.providerId,
      externalPlayerId: input.externalPlayerId,
      displayName: input.displayName,
      identityType: input.identityType,
      verified: input.verified ?? false,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };

    await this.manager.createPlayerIdentity(identity);
    await this.writeAudit({
      actor: input.actor || "parent-admin",
      action: "identity.linked",
      familyId: child.familyId,
      childId: child.id,
      providerId: input.providerId,
      result: "completed",
      metadata: {
        playerIdentityId: identity.id,
        identityType: input.identityType,
      },
    });

    return identity;
  }

  async listIdentities(childId: string): Promise<PlayerIdentity[]> {
    return this.manager.listPlayerIdentitiesByChild(childId);
  }

  async createRule(input: {
    familyId: string;
    childId: string;
    type: ParentalRule["type"];
    enabled: boolean;
    config: Record<string, unknown>;
    actor?: string;
  }): Promise<ParentalRule> {
    const now = new Date().toISOString();
    const rule: ParentalRule = {
      id: createId("rule"),
      familyId: input.familyId,
      childId: input.childId,
      type: input.type,
      enabled: input.enabled,
      config: input.config,
      createdAt: now,
      updatedAt: now,
    };
    await this.manager.createParentalRule(rule);
    await this.writeAudit({
      actor: input.actor || "parent-admin",
      action: "rule.created",
      familyId: input.familyId,
      childId: input.childId,
      result: "completed",
      metadata: { ruleId: rule.id, type: rule.type },
    });
    return rule;
  }

  async listRules(childId: string): Promise<ParentalRule[]> {
    return this.manager.listParentalRulesByChild(childId);
  }

  async updateRule(ruleId: string, patch: Partial<Pick<ParentalRule, "enabled" | "config">>, actor = "parent-admin"): Promise<ParentalRule> {
    const current = await this.manager.getParentalRule(ruleId);
    if (!current) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    const next: ParentalRule = {
      ...current,
      enabled: patch.enabled ?? current.enabled,
      config: patch.config ?? current.config,
      updatedAt: new Date().toISOString(),
    };

    await this.manager.upsertParentalRule(next);
    await this.writeAudit({
      actor,
      action: next.enabled ? "rule.updated" : "rule.disabled",
      familyId: next.familyId,
      childId: next.childId,
      result: "completed",
      metadata: { ruleId: next.id, type: next.type },
    });
    return next;
  }

  async createOverride(input: {
    childId: string;
    createdBy: string;
    scope: Record<string, unknown>;
    reason: string;
    startsAt: string;
    expiresAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<ParentOverride> {
    const child = await this.requireChild(input.childId);
    const override: ParentOverride = {
      id: createId("override"),
      familyId: child.familyId,
      childId: child.id,
      createdBy: input.createdBy,
      scope: input.scope,
      reason: input.reason,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await this.manager.createParentOverride(override);
    await this.writeAudit({
      actor: input.createdBy,
      action: "override.created",
      familyId: child.familyId,
      childId: child.id,
      result: "completed",
      metadata: { overrideId: override.id, expiresAt: override.expiresAt },
    });
    return override;
  }

  async revokeOverride(overrideId: string, actor = "parent-admin"): Promise<ParentOverride> {
    const current = await this.manager.getParentOverride(overrideId);
    if (!current) {
      throw new Error(`Override not found: ${overrideId}`);
    }
    const next: ParentOverride = {
      ...current,
      revokedAt: new Date().toISOString(),
    };
    await this.manager.upsertParentOverride(next);
    await this.writeAudit({
      actor,
      action: "override.revoked",
      familyId: current.familyId,
      childId: current.childId,
      result: "completed",
      metadata: { overrideId: current.id },
    });
    return next;
  }

  async listSessions(childId: string, limit = 200): Promise<PlaySession[]> {
    return this.manager.listPlaySessions({ childId, includeActive: true, limit });
  }

  async getSession(sessionId: string): Promise<PlaySession | undefined> {
    return this.manager.getPlaySession(sessionId);
  }

  async endSession(sessionId: string, reason = "client_disconnected", actor = "system/provider-event", at = new Date().toISOString()): Promise<PlaySession> {
    return this.endSessionRecord(sessionId, reason, actor, at);
  }

  async getPlaytime(childId: string, at = new Date().toISOString()): Promise<FamilyPlaytimeSummary> {
    const child = await this.requireChild(childId);
    const timezone = child.timezone || (await this.requireFamily(child.familyId)).timezone;
    const dayStart = dayStartIso(at, timezone);
    const weekStart = weekStartIso(at, timezone);

    const dailySessions = await this.manager.listPlaySessions({ childId, from: dayStart, to: at, includeActive: true, limit: 2000 });
    const weeklySessions = await this.manager.listPlaySessions({ childId, from: weekStart, to: at, includeActive: true, limit: 4000 });

    const dayTotal = dailySessions.reduce((sum, session) => sum + this.currentSessionSeconds(session, at), 0);
    const weekTotal = weeklySessions.reduce((sum, session) => sum + this.currentSessionSeconds(session, at), 0);

    const active = dailySessions.find((session) => session.status === "active");

    const rules = await this.manager.listParentalRulesByChild(childId);
    const dailyRule = rules.find((rule) => rule.enabled && rule.type === "DAILY_PLAY_LIMIT");
    const weeklyRule = rules.find((rule) => rule.enabled && rule.type === "WEEKLY_PLAY_LIMIT");

    const dailyLimit = dailyRule ? Number(dailyRule.config.minutes ?? 0) : undefined;
    const weeklyLimit = weeklyRule ? Number(weeklyRule.config.minutes ?? 0) : undefined;

    return {
      childId,
      dailySeconds: dayTotal,
      weeklySeconds: weekTotal,
      activeSessionSeconds: active ? this.currentSessionSeconds(active, at) : 0,
      remainingDailyMinutes: dailyLimit ? Math.max(0, Math.floor((dailyLimit * 60 - dayTotal) / 60)) : undefined,
      remainingWeeklyMinutes: weeklyLimit ? Math.max(0, Math.floor((weeklyLimit * 60 - weekTotal) / 60)) : undefined,
    };
  }

  async evaluateAccess(input: EvaluateAccessInput): Promise<EvaluateAccessOutput> {
    const now = input.timestamp || new Date().toISOString();
    const child = await this.requireChild(input.childId);
    const family = await this.requireFamily(child.familyId);
    const timezone = child.timezone || family.timezone;
    const identity = await this.resolveIdentity(child.id, input.providerId, input.externalPlayerId);
    const activeSession = await this.manager.findActivePlaySession(child.id, input.providerId, input.serverId, identity?.id);
    const playtime = await this.getPlaytime(child.id, now);
    const policySession = activeSession
      ? { ...activeSession, durationSeconds: this.currentSessionSeconds(activeSession, now) }
      : undefined;

    const rules = await this.manager.listParentalRulesByChild(child.id);
    const activeOverrides = await this.manager.listParentOverrides({ childId: child.id, activeAt: now, limit: 100 });

    const decision = evaluateParentalPolicy({
      child,
      providerId: input.providerId,
      serverId: input.serverId,
      playerIdentity: identity,
      timezone,
      currentTimestamp: now,
      rules,
      activeSession: policySession,
      dailyUsageSeconds: playtime.dailySeconds,
      weeklyUsageSeconds: playtime.weeklySeconds,
      activeOverrides,
    });

    const provider = this.manager.getProvider(input.providerId);
    const actor = input.actor || "system/provider-event";

    if (decision.decision === "DENY") {
      if (provider.enforcePlayerAccess) {
        await provider.enforcePlayerAccess({
          providerId: input.providerId,
          serverId: input.serverId,
          externalPlayerId: input.externalPlayerId,
          decision: decision.decision,
          reason: decision.reason,
        });
      }

      if (provider.disconnectPlayer) {
        await provider.disconnectPlayer(input.serverId, input.externalPlayerId, decision.reason);
      }

      if (activeSession) {
        await this.endSessionRecord(activeSession.id, decision.reason, actor, now);
      }

      await this.writeAudit({
        actor,
        action: "policy.denied",
        familyId: family.id,
        childId: child.id,
        providerId: input.providerId,
        serverId: input.serverId,
        result: "completed",
        metadata: {
          reason: decision.reason,
          decision: decision.decision,
          externalPlayerId: input.externalPlayerId,
        },
      });

      return {
        child,
        identity: identity || this.fallbackIdentity(child, input),
        decision,
        usage: playtime,
        session: activeSession,
      };
    }

    let session = activeSession;
    if (!session) {
      session = await this.startSession({
        familyId: family.id,
        childId: child.id,
        providerId: input.providerId,
        serverId: input.serverId,
        playerIdentityId: (identity || this.fallbackIdentity(child, input)).id,
        startedAt: now,
      }, actor);
    }

    await this.writeAudit({
      actor,
      action: "policy.allowed",
      familyId: family.id,
      childId: child.id,
      providerId: input.providerId,
      serverId: input.serverId,
      result: "completed",
      metadata: {
        reason: decision.reason,
        decision: decision.decision,
        externalPlayerId: input.externalPlayerId,
        sessionId: session.id,
      },
    });

    return {
      child,
      identity: identity || this.fallbackIdentity(child, input),
      decision,
      usage: playtime,
      session,
    };
  }

  async expireOverrides(at = new Date().toISOString()): Promise<ParentOverride[]> {
    const overrides = await this.manager.listParentOverrides({ limit: 2000 });
    const expired: ParentOverride[] = [];
    for (const override of overrides) {
      if (!override.revokedAt && Date.parse(override.expiresAt) < Date.parse(at)) {
        const next: ParentOverride = {
          ...override,
          revokedAt: at,
        };
        await this.manager.upsertParentOverride(next);
        expired.push(next);
        await this.writeAudit({
          actor: "system",
          action: "override.expired",
          familyId: override.familyId,
          childId: override.childId,
          result: "completed",
          metadata: { overrideId: override.id },
        });
      }
    }
    return expired;
  }

  private async startSession(input: {
    familyId: string;
    childId: string;
    providerId: string;
    serverId: string;
    playerIdentityId: string;
    startedAt: string;
  }, actor: string): Promise<PlaySession> {
    const session: PlaySession = {
      id: createId("session"),
      familyId: input.familyId,
      childId: input.childId,
      providerId: input.providerId,
      serverId: input.serverId,
      playerIdentityId: input.playerIdentityId,
      startedAt: input.startedAt,
      durationSeconds: 0,
      status: "active",
    };
    await this.manager.createPlaySession(session);
    await this.writeAudit({
      actor,
      action: "session.started",
      familyId: session.familyId,
      childId: session.childId,
      providerId: session.providerId,
      serverId: session.serverId,
      result: "completed",
      metadata: { sessionId: session.id },
    });
    return session;
  }

  private async endSessionRecord(sessionId: string, reason: string, actor: string, at: string): Promise<PlaySession> {
    const current = await this.manager.getPlaySession(sessionId);
    if (!current) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const durationSeconds = Math.max(0, Math.floor((Date.parse(at) - Date.parse(current.startedAt)) / 1000));
    const next: PlaySession = {
      ...current,
      endedAt: at,
      durationSeconds,
      status: "ended",
      disconnectReason: reason,
    };

    await this.manager.upsertPlaySession(next);
    await this.writeAudit({
      actor,
      action: "session.ended",
      familyId: next.familyId,
      childId: next.childId,
      providerId: next.providerId,
      serverId: next.serverId,
      result: "completed",
      metadata: { sessionId: next.id, durationSeconds, reason },
    });
    return next;
  }

  private currentSessionSeconds(session: PlaySession, at: string): number {
    if (session.status === "ended" && session.endedAt) {
      return Math.max(0, session.durationSeconds);
    }
    return Math.max(0, Math.floor((Date.parse(at) - Date.parse(session.startedAt)) / 1000));
  }

  private async resolveIdentity(childId: string, providerId: string, externalPlayerId: string): Promise<PlayerIdentity | undefined> {
    const identities = await this.manager.listPlayerIdentitiesByChild(childId);
    return identities.find((identity) => identity.providerId === providerId && identity.externalPlayerId === externalPlayerId);
  }

  private fallbackIdentity(child: ChildProfile, input: EvaluateAccessInput): PlayerIdentity {
    return {
      id: "unlinked",
      familyId: child.familyId,
      childId: child.id,
      providerId: input.providerId,
      externalPlayerId: input.externalPlayerId,
      displayName: input.displayName || input.externalPlayerId,
      identityType: input.identityType || "unknown",
      verified: false,
      createdAt: new Date().toISOString(),
    };
  }

  private async requireFamily(familyId: string): Promise<Family> {
    const family = await this.manager.getFamily(familyId);
    if (!family) {
      throw new Error(`Family not found: ${familyId}`);
    }
    return family;
  }

  private async requireChild(childId: string): Promise<ChildProfile> {
    const child = await this.manager.getChildProfile(childId);
    if (!child) {
      throw new Error(`Child not found: ${childId}`);
    }
    return child;
  }

  private async writeAudit(input: AuditWriteInput & {
    familyId?: string;
    childId?: string;
  }): Promise<void> {
    const metadata = {
      ...(input.metadata || {}),
      ...(input.familyId ? { familyId: input.familyId } : {}),
      ...(input.childId ? { childId: input.childId } : {}),
    };

    await this.manager.writeAudit({
      ...input,
      metadata,
    });
  }

  private toDecisionReason(reason: PolicyReasonCode): string {
    return reason;
  }
}
