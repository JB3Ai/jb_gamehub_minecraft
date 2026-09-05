import type { RewardLedgerEntry, ResolvedEntitlements } from "../provider-manager/family-types";

function isActive(entry: RewardLedgerEntry, at: string): boolean {
  const atMs = Date.parse(at);
  return Number.isFinite(atMs) && atMs >= Date.parse(entry.startsAt) && atMs <= Date.parse(entry.expiresAt);
}

function appliesToServer(entry: RewardLedgerEntry, serverId: string): boolean {
  return !entry.serverIds || entry.serverIds.length === 0 || entry.serverIds.includes(serverId);
}

function appliesToProvider(entry: RewardLedgerEntry, providerId: string): boolean {
  return !entry.providerIds || entry.providerIds.length === 0 || entry.providerIds.includes(providerId);
}

/**
 * Resolves append-only reward grants into deterministic entitlements.
 * Rewards never grant access to an unlinked identity; the parental policy
 * remains responsible for all hard safety decisions.
 */
export function resolveEntitlements(
  entries: RewardLedgerEntry[],
  input: { childId: string; providerId: string; serverId: string; at: string },
): ResolvedEntitlements {
  const grouped = new Map<string, { grant?: RewardLedgerEntry; consumed: number; revoked: boolean }>();
  for (const entry of entries) {
    if (entry.childId !== input.childId) continue;
    const state = grouped.get(entry.rewardId) ?? { consumed: 0, revoked: false };
    if (entry.entryType === "grant") state.grant = entry;
    if (entry.entryType === "consume") state.consumed += Math.max(0, entry.amountMinutes ?? 0);
    if (entry.entryType === "revoke") state.revoked = true;
    grouped.set(entry.rewardId, state);
  }

  let bonusMinutes = 0;
  let temporaryServerAccess = false;
  const rewardIds: string[] = [];
  for (const [rewardId, state] of grouped) {
    const grant = state.grant;
    if (!grant || state.revoked || !isActive(grant, input.at) || !appliesToProvider(grant, input.providerId) || !appliesToServer(grant, input.serverId)) continue;
    if (grant.rewardType === "BONUS_MINUTES") {
      const remaining = Math.max(0, (grant.amountMinutes ?? 0) - state.consumed);
      if (remaining <= 0) continue;
      bonusMinutes += remaining;
    } else if (grant.rewardType === "TEMP_SERVER_ACCESS") {
      temporaryServerAccess = true;
    }
    rewardIds.push(rewardId);
  }

  return {
    childId: input.childId,
    providerId: input.providerId,
    serverId: input.serverId,
    evaluatedAt: input.at,
    bonusMinutes,
    temporaryServerAccess,
    rewardIds,
  };
}

export class EntitlementResolver {
  resolve(
    entries: RewardLedgerEntry[],
    input: { childId: string; providerId: string; serverId: string; at: string },
  ): ResolvedEntitlements {
    return resolveEntitlements(entries, input);
  }
}
