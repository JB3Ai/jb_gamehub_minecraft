# JBGH-018 — Family Management & Parental Controls

Status: CLOSED / PASS

## Summary

JBGH-018 introduces provider-neutral family management and deterministic parental controls. The rules engine remains authoritative, while AI remains read-only and cannot influence access decisions.

## Scope

- Family records and child profiles
- Player identity linking across providers
- Time-based parental rules
- Daily and weekly play limits
- Bedtime and schedule enforcement
- Play-session tracking and reconnect protection
- Parent override semantics
- Provider-neutral evaluation API

## Domain model

- Family
- ParentMembership
- ChildProfile
- PlayerIdentity
- ParentalRule
- PlaySession
- ParentOverride
- PolicyDecision

## Policy engine

The core rules engine evaluates:

- child identity linked to provider/player
- server allowance
- timezone-aware schedule
- bedtime windows
- daily and weekly usage totals
- active session age
- parent override status

Reasons include:

- ALLOWED
- SERVER_NOT_ALLOWED
- OUTSIDE_SCHEDULE
- BEDTIME_ACTIVE
- DAILY_LIMIT_REACHED
- WEEKLY_LIMIT_REACHED
- SESSION_LIMIT_REACHED
- PARENT_OVERRIDE_ACTIVE
- IDENTITY_NOT_LINKED

## Reconnect behavior

Play sessions are tracked by child, provider, server, and identity. A disconnect does not reset the daily or weekly allowance; usage continues from the active session and prior accumulated totals.

## Audit contract

Every access decision, rule change, identity link, session lifecycle transition, and override event must leave an audit record. Historical audit records are immutable from normal operations.

## API contract

The server exposes a provider-neutral family API with endpoints for creating and reading families, child profiles, identities, rules, sessions, playtime, and access decisions.

## Dashboard view

The family dashboard displays:

- family overview
- child summary
- linked identities
- allowance remaining
- rule state
- recent activity
- override status

## AI Studio integration

AI may answer read-only questions about family access history and play-time patterns, but it cannot change rules, create overrides, or decide policy. The deterministic rules engine remains authoritative.

## Validation checklist

- [x] Family created and persisted
- [x] Child created and linked to identity
- [x] Rules evaluate correctly
- [x] Daily limit denies once exhausted
- [x] Weekly limit accumulates over time
- [x] Schedule and bedtime reject outside windows
- [x] Reconnects preserve quota
- [x] Parent override grants temporary access
- [x] Audit records remain intact
- [x] Synthetic and Minecraft providers behave the same under the live provider contract

## JBGH-018C acceptance evidence

The provider-neutral lifecycle path is covered by the focused and full automated suites:

- Synthetic player join, identity resolution, durable session start, leave, reconnect, and accumulated usage pass.
- Persistence restart coverage confirms rules, sessions, usage, overrides, and audit history remain durable.
- The live dashboard renders family, children, playtime, rules, activity, access state, active session, remaining allowance, and override status from the family APIs.
- The full closure gate passes: lint, provider/API contracts, 38 full tests, production build, and `git diff --check`.

JBGH-018D completed the live Minecraft acceptance. The managed Paper harness uses an explicit Java 21 executable, a real Java protocol client observes join/leave/reconnect, and the provider-local Paper RCON adapter confirms live kick removal. The full JBGH-018 acceptance gate is now CLOSED / PASS.

## AI Studio Consumption Guide

GameHub exposes family data through the provider-neutral family API and persistent operational history. Consumers should treat access decisions as data, not policy generation, and should preserve the read-only AI contract.
