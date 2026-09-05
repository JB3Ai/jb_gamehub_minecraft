export type ParentalRuleType =
  | "SERVER_ACCESS"
  | "DAILY_PLAY_LIMIT"
  | "WEEKLY_PLAY_LIMIT"
  | "ALLOWED_SCHEDULE"
  | "BEDTIME"
  | "SESSION_MAX_DURATION";

/** Provider-neutral, parent-issued rewards. Ledger entries are append-only. */
export type RewardType = "BONUS_MINUTES" | "TEMP_SERVER_ACCESS";
export type RewardLedgerEntryType = "grant" | "consume" | "revoke";

export interface RewardLedgerEntry {
  id: string;
  rewardId: string;
  entryType: RewardLedgerEntryType;
  rewardType: RewardType;
  familyId: string;
  childId: string;
  amountMinutes?: number;
  providerIds?: string[];
  serverIds?: string[];
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  actor: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface RewardLedgerRepository {
  createRewardLedgerEntry(entry: RewardLedgerEntry): Promise<void>;
  listRewardLedger(query?: { childId?: string; rewardId?: string; limit?: number }): Promise<RewardLedgerEntry[]>;
}

export interface ResolvedEntitlements {
  childId: string;
  providerId: string;
  serverId: string;
  evaluatedAt: string;
  bonusMinutes: number;
  temporaryServerAccess: boolean;
  rewardIds: string[];
}

export type PolicyDecisionResult = "ALLOW" | "DENY" | "ALLOW_UNTIL";

export type PolicyReasonCode =
  | "ALLOWED"
  | "SERVER_NOT_ALLOWED"
  | "OUTSIDE_SCHEDULE"
  | "BEDTIME_ACTIVE"
  | "DAILY_LIMIT_REACHED"
  | "WEEKLY_LIMIT_REACHED"
  | "SESSION_LIMIT_REACHED"
  | "PARENT_OVERRIDE_ACTIVE"
  | "IDENTITY_NOT_LINKED"
  | "CHILD_INACTIVE";

export interface Family {
  id: string;
  name: string;
  timezone: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ParentMembership {
  id: string;
  familyId: string;
  parentId: string;
  role: "parent" | "admin";
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ChildProfile {
  id: string;
  familyId: string;
  name: string;
  timezone?: string;
  createdAt: string;
  active: boolean;
  metadata?: Record<string, unknown>;
}

export interface PlayerIdentity {
  id: string;
  familyId: string;
  childId: string;
  providerId: string;
  externalPlayerId: string;
  displayName: string;
  identityType: string;
  verified: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ParentalRule {
  id: string;
  familyId: string;
  childId: string;
  type: ParentalRuleType;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PlaySession {
  id: string;
  familyId: string;
  childId: string;
  providerId: string;
  serverId: string;
  playerIdentityId: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  status: "active" | "ended";
  disconnectReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ParentOverride {
  id: string;
  familyId: string;
  childId: string;
  createdBy: string;
  scope: Record<string, unknown>;
  reason: string;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface FamilyPlaytimeSummary {
  childId: string;
  dailySeconds: number;
  weeklySeconds: number;
  activeSessionSeconds: number;
  remainingDailyMinutes?: number;
  remainingWeeklyMinutes?: number;
}

export interface PolicyDecision {
  decision: PolicyDecisionResult;
  reason: PolicyReasonCode;
  remainingMinutes?: number;
  allowUntil?: string;
  evaluatedAt: string;
  policyVersion: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderResolvedPlayerIdentity {
  providerId: string;
  externalPlayerId: string;
  displayName?: string;
  identityType?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderOnlinePlayer {
  providerId: string;
  serverId: string;
  externalPlayerId: string;
  displayName?: string;
  identityType?: string;
  connectedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderAccessEnforcementInput {
  providerId: string;
  serverId: string;
  externalPlayerId: string;
  decision: PolicyDecisionResult;
  reason: PolicyReasonCode;
}

export interface ProviderPlayerLifecycleEvent {
  type: "player.joined" | "player.left";
  providerId: string;
  serverId: string;
  externalPlayerId: string;
  displayName?: string;
  identityType?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}