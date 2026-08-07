# ADR-0007 Capability Discovery Contract

Version: 0.1.0

Status: DRAFT

ADR ID: ADR-0007

Depends on: JBGH-002, JBGH-003, JBGH-004, JBGH-005

## Context

Frontend and automation must operate across providers without hardcoded provider-specific assumptions.

## Decision

Providers must advertise capabilities through a standard discovery contract consumed by API and UI layers.

## Rationale

- Enables provider-agnostic UI rendering.
- Allows new providers without frontend rewrites.
- Supports policy-aware operation eligibility checks.

## Consequences

- Capability contracts become part of compatibility guarantees.
- Provider versions must preserve or version capability semantics.
