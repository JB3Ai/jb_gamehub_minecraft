import type {
  ChildProfile,
  ParentOverride,
  ParentalRule,
  ParentalRuleType,
  PlaySession,
  PlayerIdentity,
  PolicyDecision,
  PolicyDecisionResult,
  PolicyReasonCode,
  ResolvedEntitlements,
} from "../provider-manager/family-types";

export type { PolicyDecisionResult, PolicyReasonCode } from "../provider-manager/family-types";

export interface PolicyEvaluationInput {
  child: ChildProfile;
  providerId: string;
  serverId: string;
  playerIdentity?: PlayerIdentity;
  timezone: string;
  currentTimestamp: string;
  rules: ParentalRule[];
  activeSession?: PlaySession;
  dailyUsageSeconds: number;
  weeklyUsageSeconds: number;
  activeOverrides: ParentOverride[];
  entitlements?: ResolvedEntitlements;
}

function toLocalParts(isoTimestamp: string, timezone: string): { weekday: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(isoTimestamp));
  const weekday = parts.find((part) => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  return { weekday, hour, minute };
}

function parseMinutesOfDay(timeValue: string): number {
  const [hour, minute] = timeValue.split(":").map((value) => Number(value));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return 0;
  }
  return hour * 60 + minute;
}

function isWithinWindow(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function findEnabledRule(rules: ParentalRule[], type: ParentalRuleType): ParentalRule | undefined {
  return rules.find((rule) => rule.enabled && rule.type === type);
}

function overrideAppliesToTarget(
  override: ParentOverride,
  providerId: string,
  serverId: string,
): boolean {
  const scopedProviderId = override.scope.providerId;
  const scopedServerId = override.scope.serverId;
  return (
    (typeof scopedProviderId !== "string" || scopedProviderId === providerId) &&
    (typeof scopedServerId !== "string" || scopedServerId === serverId)
  );
}

export function evaluateParentalPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const evaluatedAt = input.currentTimestamp;
  const policyVersion = input.entitlements ? "jbgh-019-v1" : "jbgh-018-v1";

  if (!input.playerIdentity) {
    return {
      decision: "DENY",
      reason: "IDENTITY_NOT_LINKED",
      remainingMinutes: 0,
      evaluatedAt,
      policyVersion,
    };
  }

  if (!input.child.active) {
    return {
      decision: "DENY",
      reason: "CHILD_INACTIVE",
      remainingMinutes: 0,
      evaluatedAt,
      policyVersion,
    };
  }

  const nowMs = Date.parse(input.currentTimestamp);
  const activeOverride = input.activeOverrides.find(
    (override) =>
      !override.revokedAt &&
      nowMs >= Date.parse(override.startsAt) &&
      nowMs <= Date.parse(override.expiresAt) &&
      overrideAppliesToTarget(override, input.providerId, input.serverId),
  );

  if (activeOverride) {
    return {
      decision: "ALLOW",
      reason: "PARENT_OVERRIDE_ACTIVE",
      evaluatedAt,
      policyVersion,
      metadata: {
        overrideId: activeOverride.id,
      },
    };
  }

  const serverAccessRule = findEnabledRule(input.rules, "SERVER_ACCESS");
  if (serverAccessRule) {
    const allowedServers = Array.isArray(serverAccessRule.config.allowedServers)
      ? (serverAccessRule.config.allowedServers as unknown[]).map((value) => String(value))
      : [];
    const temporaryAccess = input.entitlements?.temporaryServerAccess === true;
    if (allowedServers.length > 0 && !allowedServers.includes(input.serverId) && !temporaryAccess) {
      return {
        decision: "DENY",
        reason: "SERVER_NOT_ALLOWED",
        remainingMinutes: 0,
        evaluatedAt,
        policyVersion,
      };
    }
  }

  const local = toLocalParts(input.currentTimestamp, input.timezone);
  const currentMinutes = local.hour * 60 + local.minute;

  const scheduleRule = findEnabledRule(input.rules, "ALLOWED_SCHEDULE");
  if (scheduleRule) {
    const windows = Array.isArray(scheduleRule.config.windows) ? (scheduleRule.config.windows as Array<Record<string, unknown>>) : [];
    if (windows.length > 0) {
      const dayWindow = windows.find((window) => String(window.weekday || "").toLowerCase() === local.weekday.toLowerCase());
      if (!dayWindow) {
        return {
          decision: "DENY",
          reason: "OUTSIDE_SCHEDULE",
          remainingMinutes: 0,
          evaluatedAt,
          policyVersion,
        };
      }

      const startMinutes = parseMinutesOfDay(String(dayWindow.start || "00:00"));
      const endMinutes = parseMinutesOfDay(String(dayWindow.end || "23:59"));
      if (!isWithinWindow(currentMinutes, startMinutes, endMinutes)) {
        return {
          decision: "DENY",
          reason: "OUTSIDE_SCHEDULE",
          remainingMinutes: 0,
          evaluatedAt,
          policyVersion,
        };
      }
    }
  }

  const bedtimeRule = findEnabledRule(input.rules, "BEDTIME");
  if (bedtimeRule) {
    const startMinutes = parseMinutesOfDay(String(bedtimeRule.config.start || "22:00"));
    const endMinutes = parseMinutesOfDay(String(bedtimeRule.config.end || "06:00"));
    if (isWithinWindow(currentMinutes, startMinutes, endMinutes)) {
      return {
        decision: "DENY",
        reason: "BEDTIME_ACTIVE",
        remainingMinutes: 0,
        evaluatedAt,
        policyVersion,
      };
    }
  }

  const dailyLimitRule = findEnabledRule(input.rules, "DAILY_PLAY_LIMIT");
  const bonusMinutes = Math.max(0, input.entitlements?.bonusMinutes ?? 0);
  const dailyLimitMinutes = dailyLimitRule ? Number(dailyLimitRule.config.minutes ?? 0) + bonusMinutes : undefined;
  if (dailyLimitMinutes && input.dailyUsageSeconds >= dailyLimitMinutes * 60) {
    return {
      decision: "DENY",
      reason: "DAILY_LIMIT_REACHED",
      remainingMinutes: 0,
      evaluatedAt,
      policyVersion,
    };
  }

  const weeklyLimitRule = findEnabledRule(input.rules, "WEEKLY_PLAY_LIMIT");
  const weeklyLimitMinutes = weeklyLimitRule ? Number(weeklyLimitRule.config.minutes ?? 0) + bonusMinutes : undefined;
  if (weeklyLimitMinutes && input.weeklyUsageSeconds >= weeklyLimitMinutes * 60) {
    return {
      decision: "DENY",
      reason: "WEEKLY_LIMIT_REACHED",
      remainingMinutes: 0,
      evaluatedAt,
      policyVersion,
    };
  }

  const sessionLimitRule = findEnabledRule(input.rules, "SESSION_MAX_DURATION");
  const sessionLimitMinutes = sessionLimitRule ? Number(sessionLimitRule.config.minutes ?? 0) : undefined;

  let sessionRemainingMinutes: number | undefined;
  if (sessionLimitMinutes && input.activeSession) {
    const observedSeconds = Math.max(0, Number(input.activeSession.durationSeconds ?? 0));
    if (observedSeconds >= sessionLimitMinutes * 60) {
      return {
        decision: "DENY",
        reason: "SESSION_LIMIT_REACHED",
        remainingMinutes: 0,
        evaluatedAt,
        policyVersion,
      };
    }
    sessionRemainingMinutes = Math.floor((sessionLimitMinutes * 60 - observedSeconds) / 60);
  }

  const remainingDailyMinutes = dailyLimitMinutes
    ? Math.max(0, Math.floor((dailyLimitMinutes * 60 - input.dailyUsageSeconds) / 60))
    : undefined;
  const remainingWeeklyMinutes = weeklyLimitMinutes
    ? Math.max(0, Math.floor((weeklyLimitMinutes * 60 - input.weeklyUsageSeconds) / 60))
    : undefined;

  const finiteRemaining = [remainingDailyMinutes, remainingWeeklyMinutes, sessionRemainingMinutes].filter(
    (value): value is number => value !== undefined,
  );

  if (finiteRemaining.length > 0) {
    const remainingMinutes = Math.min(...finiteRemaining);
    if (remainingMinutes <= 0) {
      return {
        decision: "DENY",
        reason: "DAILY_LIMIT_REACHED",
        remainingMinutes: 0,
        evaluatedAt,
        policyVersion,
      };
    }
    return {
      decision: "ALLOW",
      reason: "ALLOWED",
      remainingMinutes,
      allowUntil: new Date(Date.parse(input.currentTimestamp) + remainingMinutes * 60 * 1000).toISOString(),
      evaluatedAt,
      policyVersion,
    };
  }

  return {
    decision: "ALLOW",
    reason: "ALLOWED",
    evaluatedAt,
    policyVersion,
  };
}
