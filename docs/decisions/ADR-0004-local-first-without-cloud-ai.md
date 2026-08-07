# ADR-0004 Local-First Without Cloud or AI

Version: 0.1.0

Status: DRAFT

ADR ID: ADR-0004

Depends on: JBGH-001, JBGH-002, JBGH-004

## Context

Current deployment is Windows + LAN with intermittent or absent internet tolerance requirements.

## Decision

GameHub core management functionality must remain operational without cloud services and without LLM availability.

## Rationale

- Aligns with local-first and accessibility goals.
- Prevents operational lockout on internet outages.
- Keeps cloud as optional enhancement.

## Consequences

- Core control plane cannot hard-depend on external AI or cloud APIs.
- Degradation behavior must be explicit and observable.
