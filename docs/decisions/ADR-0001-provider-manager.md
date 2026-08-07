# ADR-0001 Provider Manager Boundary

## Metadata
- ADR ID: ADR-0001
- Version: 0.1
- Status: DRAFT
- Last Updated: 2026-08-07

## Dependency Declarations
- Depends On: JBGH-003, JBGH-004, JBGH-MC-001
- Feeds Into: JBGH-005, JBGH-006

## Context
Minecraft provider workflows include world and pack semantics that are domain-specific and error-prone if handled directly by generic orchestration code.

## Decision
Adopt a Provider Manager that is the only layer allowed to invoke provider-specific logic and capabilities.

## Consequences
- Positive: isolated complexity, consistent diagnostics, provider portability.
- Positive: reusable capability lifecycle across current and future providers.
- Tradeoff: requires stricter contracts and capability schema maintenance.

## Requirement IDs
- REQ-ADR-001: All provider operations must route through Provider Manager.
- REQ-ADR-002: Capability contracts must be versioned and validated.

## AI Studio Consumption Guide
- Ask AI to reject designs that call provider internals directly.
- Require AI outputs to identify capability boundaries and contract changes.

## Validation Criteria
- No architecture or API path bypasses Provider Manager.
- Capability schema versioning strategy is present.

## Completion Checklist
- [x] Decision documented.
- [x] Consequences documented.
- [x] Dependencies declared.
