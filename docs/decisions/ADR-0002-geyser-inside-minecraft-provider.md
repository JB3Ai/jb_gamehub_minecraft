# ADR-0002 Geyser Inside Minecraft Provider

Version: 0.1.0

Status: DRAFT

ADR ID: ADR-0002

Depends on: JBGH-003, JBGH-004

## Context

Geyser bridges Bedrock clients to Java runtimes and carries Minecraft protocol and compatibility concerns.

## Decision

Geyser belongs inside the Minecraft provider boundary, not GameHub Core.

## Rationale

- Geyser behavior is Minecraft-specific.
- Compatibility constraints are runtime-specific.
- Core should remain provider-agnostic.

## Consequences

- Provider owns Geyser lifecycle and diagnostics.
- Core consumes normalized capability and status outputs only.
