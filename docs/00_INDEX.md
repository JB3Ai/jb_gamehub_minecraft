# JBGH-000 Documentation Index

## Metadata
- Document ID: JBGH-000
- Version: 0.1
- Status: DRAFT
- Last Updated: 2026-08-07

## Purpose
This index defines the documentation contract for JB3 GameHub and enforces the dependency chain before implementation work.

## Canonical Dependency Chain
1. JBGH-001 Vision
2. JBGH-002 PRD
3. JBGH-003 Master Technical Spec
4. JBGH-004 Architecture
5. JBGH-005 API Spec
6. JBGH-006 Database Schema
7. JBGH-007 Design System
8. JBGH-008 Foundation Validation
9. JBGH-009 Implementation Contract

## Core Documents
- JBGH-001: [01_VISION.md](01_VISION.md)
- JBGH-002: [02_PRD.md](02_PRD.md)
- JBGH-003: [03_MASTER_TECHNICAL_SPEC.md](03_MASTER_TECHNICAL_SPEC.md)
- JBGH-004: [04_ARCHITECTURE.md](04_ARCHITECTURE.md)
- JBGH-005: [05_API_SPEC.md](05_API_SPEC.md)
- JBGH-006: [06_DATABASE_SCHEMA.md](06_DATABASE_SCHEMA.md)
- JBGH-007: [07_DESIGN_SYSTEM.md](07_DESIGN_SYSTEM.md)
- JBGH-008: [08_VALIDATION.md](08_VALIDATION.md)
- JBGH-009: [09_IMPLEMENTATION_CONTRACT.md](09_IMPLEMENTATION_CONTRACT.md)

## Provider-Specific Documents
- [providers/minecraft/PROVIDER_SPEC.md](providers/minecraft/PROVIDER_SPEC.md)
- [providers/minecraft/GEYSER.md](providers/minecraft/GEYSER.md)
- [providers/minecraft/PAPER.md](providers/minecraft/PAPER.md)
- [providers/minecraft/WORLDS.md](providers/minecraft/WORLDS.md)
- [providers/minecraft/ADDONS.md](providers/minecraft/ADDONS.md)

## Decision Records
- [decisions/ADR-0001-provider-manager.md](decisions/ADR-0001-provider-manager.md)
- [decisions/ADR-0002-geyser-inside-minecraft-provider.md](decisions/ADR-0002-geyser-inside-minecraft-provider.md)
- [decisions/ADR-0003-ai-no-direct-infra-execution.md](decisions/ADR-0003-ai-no-direct-infra-execution.md)
- [decisions/ADR-0004-local-first-without-cloud-ai.md](decisions/ADR-0004-local-first-without-cloud-ai.md)
- [decisions/ADR-0005-multi-game-provider-extensibility.md](decisions/ADR-0005-multi-game-provider-extensibility.md)
- [decisions/ADR-0006-modular-monolith-mvp.md](decisions/ADR-0006-modular-monolith-mvp.md)
- [decisions/ADR-0007-capability-discovery-contract.md](decisions/ADR-0007-capability-discovery-contract.md)

## Consolidated Foundation
- [JBGH-FOUNDATION-v0.1/README.md](JBGH-FOUNDATION-v0.1/README.md)

## Schemas
- [schemas/provider.schema.json](schemas/provider.schema.json)
- [schemas/server.schema.json](schemas/server.schema.json)
- [schemas/capability.schema.json](schemas/capability.schema.json)

## Dependency Declarations
- Depends On: none
- Feeds Into: JBGH-001 through JBGH-009

## AI Studio Consumption Guide
- Load order: 00_INDEX -> 01_VISION -> 02_PRD -> 03_MASTER_TECHNICAL_SPEC -> 04_ARCHITECTURE -> 05_API_SPEC -> 06_DATABASE_SCHEMA -> 07_DESIGN_SYSTEM -> 08_VALIDATION -> 09_IMPLEMENTATION_CONTRACT
- Prompt contract: ask AI to cite source doc IDs and requirement IDs for every design or implementation recommendation.
- Constraint: if chain links are missing or conflicting, block implementation recommendations until resolved.

## Validation Criteria
- Every core document contains: `Status: DRAFT`, stable `JBGH-*` ID, requirement IDs, dependency declaration, AI Studio guide, validation criteria, completion checklist.
- JBGH-001 through JBGH-007 form a strict forward dependency chain without cycles.
- Provider capability model is represented in provider docs and schema artifacts.

## Completion Checklist
- [x] Core chain files created.
- [x] Provider docs created.
- [x] ADR created.
- [x] Schemas created.
- [ ] Final consistency pass approved by maintainers.
