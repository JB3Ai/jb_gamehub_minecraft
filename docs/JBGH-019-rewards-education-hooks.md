# JBGH-019 — Provider-Neutral Rewards and Education Hooks

Status: CLOSED / PASS

JBGH-019 adds a provider-neutral, append-only reward ledger and deterministic
entitlement resolution. A parent can grant bonus minutes or temporary access to
scoped servers without coupling policy to Minecraft, IsikoloAi, or any other
provider.

## Safety boundary

Rewards are inputs to the parental policy engine, not policy mutations. An
unlinked identity, inactive child, schedule restriction, bedtime restriction,
or provider enforcement failure remains authoritative. Temporary server access
only relaxes an explicit `SERVER_ACCESS` allow-list; it does not bypass
identity, schedule, bedtime, or provider kick/disconnect enforcement.

AI Studio remains read-only. It cannot grant, consume, revoke, or resolve
rewards and no IsikoloAi integration is included.

## Ledger and entitlements

`reward_ledger` stores immutable `grant`, `consume`, and `revoke` entries.
`resolveEntitlements` folds the entries at a requested timestamp and target
provider/server. Bonus minutes extend configured daily and weekly limits;
temporary access is scoped by server IDs and an expiry window.

## API

- `GET /api/children/:childId/rewards`
- `POST /api/children/:childId/rewards`
- `GET /api/children/:childId/entitlements?providerId=&serverId=&at=`
- `POST /api/rewards/:rewardId/redeem`
- `DELETE /api/rewards/:rewardId`

All mutations write `reward.granted`, `reward.redeemed`, or `reward.revoked`
audit records. The persistence contract has optional reward methods so older
custom repositories fail closed without weakening the existing operational
contract.

## Education hooks

Rewards are intentionally generic metadata plus a human-readable reason,
allowing future education/classroom providers to attach learning evidence or
teacher context without changing the ledger or granting AI mutation rights.

## Live acceptance evidence

The managed Paper harness passed the real Minecraft reward lifecycle using
Java 21 and Paper 1.21.4:

- exhausted base allowance denied access;
- a `BONUS_MINUTES` grant changed entitlement resolution to allow access;
- a real Java-protocol player joined Paper and opened a durable session;
- one consumed minute persisted through disconnect/reconnect;
- the remaining minute was consumed and policy returned `DENY`;
- Paper RCON kicked the player and `list` confirmed removal;
- dashboard/API reward state and child-scoped audit records reconciled;
- an active bedtime rule denied access despite the reward.

Evidence: `integration/minecraft/evidence/JBGH-019-reward-acceptance-2026-09-05.json`.

## Completion checklist

- [x] Provider-neutral reward ledger and entitlement resolver
- [x] Durable persistence and append-only grant/consume/revoke entries
- [x] Safety-policy precedence and read-only AI boundary
- [x] Synthetic and automated contract coverage
- [x] Real Paper join, reconnect, consumption, exhaustion, and RCON enforcement
- [x] Dashboard/API and audit reconciliation
