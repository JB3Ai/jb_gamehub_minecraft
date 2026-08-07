# JBGH-MC-004 Worlds Profile v0.1

## Metadata
- Document ID: JBGH-MC-004
- Version: 0.1
- Status: DRAFT
- Last Updated: 2026-08-07

## Dependency Declarations
- Depends On: JBGH-MC-001
- Feeds Into: CAP-MC-001 through CAP-MC-007

## Required World Artifacts
- `level.dat`
- `world_behavior_packs.json`
- `world_resource_packs.json`

## Requirement IDs
- REQ-MC-WORLD-001: World validation must check required artifacts.
- REQ-MC-WORLD-002: Missing pack references must be surfaced before deployment.
- REQ-MC-WORLD-003: World-to-pack links must be generated deterministically.

## AI Studio Consumption Guide
- Ask AI to output world validation reports with artifact-by-artifact status.

## Validation Criteria
- Required files and link generation rules are explicit.

## Completion Checklist
- [x] Artifact requirements listed.
- [x] Dependencies declared.
