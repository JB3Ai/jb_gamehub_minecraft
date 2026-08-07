# ADR-0006 Modular Monolith MVP

Version: 0.1.0

Status: DRAFT

ADR ID: ADR-0006

Depends on: JBGH-002, JBGH-003, JBGH-004

## Context

The MVP needs fast iteration and operational simplicity while preserving clear module boundaries for future scale.

## Decision

Adopt a modular monolith for MVP delivery, with strict internal module boundaries and explicit contracts.

## Rationale

- Reduces deployment and debugging complexity.
- Avoids premature distributed-system overhead.
- Preserves future extraction paths by enforcing module contracts.

## Consequences

- Initial deployment is simpler for LAN/home environments.
- Module ownership and interface discipline must be maintained from day one.
