# ADR-0005 Multi-Game Provider Extensibility

Version: 0.1.0

Status: DRAFT

ADR ID: ADR-0005

Depends on: JBGH-001, JBGH-003, JBGH-004

## Context

GameHub vision requires support for future providers beyond Minecraft without architecture rewrites.

## Decision

Provider contracts and capability descriptors are the extension mechanism for additional games.

## Rationale

- Enables game-specific innovation without core coupling.
- Keeps UI/API behavior capability-driven.
- Reduces risk of game-specific branching in core code.

## Consequences

- New providers must publish capability and health contracts.
- Core and API layers remain stable as provider set grows.
