# JBGH-012A - Lifecycle Evidence Validation

## Purpose

JBGH-012A adds deterministic validation for lifecycle evidence artifacts produced by JBGH-012.

The validator checks structure and semantic sequence, not literal timestamp values or operation IDs.

Reference baseline artifact:

- `integration/minecraft/evidence/JBGH-012-lifecycle-2026-08-08T08-08-13-731Z.json`

## Evidence Schema (required subset)

The validator expects:

- `providerId` as a non-empty string
- `startOperationId` as a non-empty string
- `stopOperationId` as a non-empty string
- `timeline` as a non-empty array

Each timeline event must include:

- `type`
- `timestamp` in ISO-8601 UTC format
- `providerId`

## Required Lifecycle Semantics

The following sequence must be present in order:

1. Start operation lifecycle for `startOperationId`
   - `operation.created`
   - `operation.started`
   - `operation.completed`
2. Online transition
   - `server.status.changed` with `status = online`
3. World validation completion
   - `world.validation.completed`
4. Stop operation lifecycle for `stopOperationId`
   - `operation.created`
   - `operation.started`
   - `operation.completed`
5. Offline transition
   - `server.status.changed` with `status = offline`

Global status progression must include:

- `offline -> online -> offline`

## Command

```bash
npm run validate:lifecycle:evidence -- <path-to-evidence.json>
```

Exit codes:

- `0` valid lifecycle evidence
- `1` invalid lifecycle evidence

## Failure Semantics

Validation errors are emitted as explicit failure lines, including:

- missing event
- incorrect event ordering
- missing operation ID
- missing provider ID
- invalid status transition
- malformed timestamp
- incomplete lifecycle

## Relationship To JBGH-012

JBGH-012 captured real integration evidence from the provider lifecycle.

JBGH-012A protects that contract by asserting future captured artifacts still satisfy the accepted lifecycle semantics.
