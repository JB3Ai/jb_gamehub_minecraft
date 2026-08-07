# ADR-0003 AI No Direct Infrastructure Execution

Version: 0.1.0

Status: DRAFT

ADR ID: ADR-0003

Depends on: JBGH-002, JBGH-003, JBGH-004

## Context

AI assistance is required for diagnostics and guidance, but direct privileged execution is a security risk.

## Decision

AI can propose actions only. Policy and authorization gates must approve all mutating operations.

## Rationale

- Prevents privilege escalation by generated output.
- Preserves explicit user/admin accountability.
- Keeps deterministic authorization and auditability.

## Consequences

- AI output is non-authoritative until validated.
- Every mutating action is auditable with user and policy context.
