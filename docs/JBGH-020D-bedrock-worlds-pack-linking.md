# JBGH-020D - Bedrock Worlds & Pack Linking

Status: CLOSED / PASS
Milestone: JBGH-020D - Bedrock Worlds & Pack Linking
Dependencies: JBGH-020A, JBGH-020B, JBGH-020C
Requirement IDs: JBGH-020D-REQ-001 through JBGH-020D-REQ-014

## Objective

Extend the existing JBGH-020 content pipeline for deliberately supplied Bedrock
worlds and packs. This is not a parallel scanner, planner, installer, audit
trail, or dashboard:

```text
Bedrock .mcworld / .mcpack
  -> existing scanner
  -> existing ContentItem
  -> canonical ContentImportPlan
  -> explicit approval
  -> existing operation-scoped staging
  -> Bedrock manifest and world validation
  -> Bedrock-provider-owned destination mapping
  -> world pack-link generation
  -> Bedrock runtime verification
  -> existing immutable audit/history/inventory surfaces
```

JBGH-020D must preserve source bytes, source hashes, planning, approval,
collision protection, rollback, staging cleanup, and the archive protections
already closed in JBGH-020A through JBGH-020C.

## Implementation progress

The read-only scanner foundation is implemented and covered by generated,
deliberate test fixtures:

- `.mcworld` classification now requires `level.dat` plus a Bedrock storage
  indicator (`db/` or `levelname.txt`); an extension alone is insufficient.
- `.mcpack` and `.mcaddon` manifests are parsed for canonical header/module
  UUIDs, three-part versions, supported module types, duplicate module UUIDs,
  and dependency identity.
- Invalid manifests and malformed archives are reported as `unknown` with
  structured reason codes; they are never upgraded to a guessed pack type.
- Linkage reads validate existing JSON records, merge only matching UUID/version
  identities, and write through a same-directory temporary replacement.

The provider-owned staged import/link adapter and the existing Content Library
API approval route are implemented behind an explicit `BEDROCK_CONTENT_DIR`;
when JBGH-021 configures `BEDROCK_SERVER_DIR`, the API maps plans to that
native provider root instead. A content-only directory is **not** a native
runtime registration.
The generic dashboard continues to display backend plans and lifecycle results;
it must not construct linkage JSON or select arbitrary paths. Native Bedrock
runtime verification remains unimplemented. `minecraft-main` remains correctly
blocked for all native Bedrock targets.

## Deliberate automated fixture acceptance

The automated corpus is generated in
[`tests/bedrock-content-import.test.ts`](../tests/bedrock-content-import.test.ts)
and never sourced from the removed standalone server directory or an
uncontrolled download:

| Stable fixture ID | Fixture | Expected result |
|---|---|---|
| JBGH-020D-CONTENT-001 | Minimal `.mcworld` with `level.dat`, `levelname.txt`, and `db/` | `READY` for `bedrock-main`; staged import preserves source bytes |
| JBGH-020D-CONTENT-002 | Valid resource `.mcpack` | staged provider-owned install plus `world_resource_packs.json` linkage |
| JBGH-020D-CONTENT-003 | Pack aimed at a missing managed world | rollback with `BEDROCK_TARGET_WORLD_NOT_FOUND` |
| JBGH-020D-CONTENT-004 | Pack declaring an absent dependency | plan blocked with `BEDROCK_PACK_DEPENDENCY_MISSING` |
| JBGH-020D-CONTENT-005 | Invalid/malformed manifests and linkage | safe unknown/blocked classification with structured reason codes |

The filesystem-backed adapter used by this acceptance is explicitly a
disposable provider-adapter fixture. It establishes pipeline and rollback
behavior; it is not evidence of a live native Bedrock server runtime.

## Critical runtime boundary

`minecraft-main` is a Java/Paper server with Geyser. Geyser translates client
protocol; it does **not** convert or load Bedrock world storage. Therefore:

- a `bedrock-world` must remain `BLOCKED` for direct installation on
  `minecraft-main`;
- Java/Paper destinations must never be used for `.mcworld`, behavior-pack, or
  Bedrock resource-pack installation;
- JBGH-020D requires an explicitly configured Bedrock provider/server target
  before any runtime acceptance can pass;
- pack links belong to the Bedrock world installed for that Bedrock target.

This protects the existing provider-neutral planning boundary and prevents a
Geyser-enabled Paper server from being treated as a Bedrock world runtime.

## Extension requirements

| ID | Requirement | Validation |
|---|---|---|
| JBGH-020D-REQ-001 | Reuse `ContentLibraryScanner`, `ContentItem`, `ContentImportPlanner`, `ContentImportExecutor`, Content Library APIs, UI approval, audit, and inventory patterns. | No parallel import path or client-side destination selection exists. |
| JBGH-020D-REQ-002 | Detect a genuine `.mcworld` as `bedrock-world` from file contents and preserve its streamed SHA-256. | Valid fixture scan returns source hash, markers, metadata, and compatibility. |
| JBGH-020D-REQ-003 | Validate Bedrock world structure before planning/execution. | Required `level.dat` and Bedrock world metadata are checked from safe staging. |
| JBGH-020D-REQ-004 | Detect and validate behavior/resource-pack `manifest.json` fields, UUIDs, versions, and module types. | Invalid/missing manifests are blocked with structured reason codes. |
| JBGH-020D-REQ-005 | Map Bedrock worlds and packs only through a Bedrock provider adapter. | Provider-owned destinations remain inside the managed Bedrock server root. |
| JBGH-020D-REQ-006 | Generate `world_behavior_packs.json` and `world_resource_packs.json` only from validated, installed manifests. | Generated links exactly reference installed pack UUID/version metadata. |
| JBGH-020D-REQ-007 | Treat unresolved pack dependencies, duplicate UUIDs, incompatible versions, and dangling links as blocking conditions. | Plan is `blocked`; no staging/destination mutation occurs. |
| JBGH-020D-REQ-008 | Preserve existing source re-hash, zip-slip, symlink, extraction-limit, collision, rollback, and cleanup controls. | Existing JBGH-020B cases and Bedrock-specific failure cases pass. |
| JBGH-020D-REQ-009 | Keep Java/Paper target incompatibility visible. | Bedrock content aimed at `minecraft-main` is `BLOCKED` with `WORLD_EDITION_MISMATCH` or equivalent structured issue. |
| JBGH-020D-REQ-010 | Require plan preview then explicit approval before mutation. | No execution path accepts a client-provided destination, manifest link, UUID, version, or staging path. |
| JBGH-020D-REQ-011 | Extend provider-derived installed inventory and immutable import history. | Inventory distinguishes installed from runtime-loaded/linked state. |
| JBGH-020D-REQ-012 | Verify a real managed Bedrock runtime discovers the world and applies validated links. | Live runtime acceptance observes discovery and reported pack links. |
| JBGH-020D-REQ-013 | Preserve source content unchanged. | Source SHA-256 is identical before/after every completed and rejected path. |
| JBGH-020D-REQ-014 | Keep AI Studio read-only. | AI may explain scans/plans/history but cannot approve, execute, link, or alter pack metadata. |

## Acceptance corpus manifest

The intentionally removed `STANDALONEminecraft server/` directory is not a
JBGH-020D source. It must not be restored, recycled, or used as implied
ground truth.

As of 2026-09-20, the configured corpus has no files beneath:

```text
JBGH-020 TEST CONTENT/03 RESOURCE PACKS/
JBGH-020 TEST CONTENT/04 BEHAVIOR PACKS/
JBGH-020 TEST CONTENT/06 BEDROCK CONTENT/
```

Before implementation or live acceptance, add untouched, lawful fixtures and
record each stable ID, source path, byte size, SHA-256, expected classification,
target provider, expected compatibility, and expected reason codes in
`docs/JBGH-020-content-acceptance-manifest.md`.

Minimum deliberate corpus:

| Proposed ID | Fixture | Expected result |
|---|---|---|
| JBGH-020D-CONTENT-001 | Valid `.mcworld` with `level.dat` | `bedrock-world`; candidate only for the configured Bedrock provider |
| JBGH-020D-CONTENT-002 | Valid behavior pack with `manifest.json` data module | behavior pack; linkable only after matching Bedrock world/provider validation |
| JBGH-020D-CONTENT-003 | Valid resource pack with `manifest.json` resources module | resource pack; linkable only after matching Bedrock world/provider validation |
| JBGH-020D-CONTENT-004 | World plus both packs with matching dependency metadata | READY only for configured Bedrock target; generated links expected |
| JBGH-020D-CONTENT-005 | Pack with unresolved dependency or UUID/version mismatch | BLOCKED; `PACK_DEPENDENCY_UNRESOLVED` or equivalent |
| JBGH-020D-CONTENT-006 | Malformed `.mcworld` or manifest | BLOCKED; archive/manifest reason code |
| JBGH-020D-CONTENT-007 | Bedrock content targeted at `minecraft-main` | BLOCKED; Java/Paper edition mismatch |

No runtime-generated Geyser cache artifact may be promoted to this corpus.

## Acceptance sequence

```text
1. Scan untouched Bedrock world and packs.
2. Verify source hashes and normalized classification.
3. Show Java/Paper incompatibility without attempting an install.
4. Create a canonical Bedrock-target plan.
5. Validate manifests, UUID/version dependencies, and link graph.
6. Review provider-owned destinations and generated link preview.
7. Explicitly approve.
8. Re-verify source hashes, stage safely, install, and generate links.
9. Start/reload only the disposable managed Bedrock runtime.
10. Verify world discovery and effective behavior/resource-pack links.
11. Verify audit, inventory, cleanup, source integrity, restart persistence,
    collisions, malformed input, and dependency failure paths.
```

## Completion checklist

- [ ] Deliberate Bedrock fixture corpus recorded with stable IDs and hashes
- [ ] Configured Bedrock provider/server target documented
- [ ] Provider-scoped world/pack classifier and manifest validation implemented
- [ ] Canonical plan/link preview implemented
- [ ] Explicit approval, safe staging, rollback, collision, and audit reused
- [ ] Java/Paper mismatch acceptance passes
- [ ] Bedrock runtime world/link verification passes
- [ ] Source integrity, malformed archive, dependency, collision, and restart acceptance pass
- [ ] Full lint, contracts, tests, build, and `git diff --check` pass

## AI Studio Consumption Guide

AI Studio may summarize Bedrock scan results, manifest validation, dependency
issues, canonical plans, generated link previews, installed inventory, and
immutable audit history. It must not create or approve a plan, modify a
manifest, select a destination, generate a replacement UUID, link a pack, or
execute an import.
