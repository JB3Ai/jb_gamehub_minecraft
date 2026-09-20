# JBGH-020B — Safe Import / Installation Pipeline

Status: CLOSED / PASS
Milestone: JBGH-020B — Safe Import / Installation Pipeline
Dependencies: JBGH-020A Content Scanner & Corpus Classification
Implementation: `packages/content-library/importer.ts`

## Objective

Install only scanner-validated, explicitly approved content into
provider-configured, GameHub-managed locations. Import is deliberately separate
from inspection:

```text
source (read-only)
  -> JBGH-020A ContentItem
  -> import plan
  -> compatibility and safety gate
  -> operation-scoped staging
  -> managed provider destination
```

No source file is modified, and no item is installed directly from its source
path into a live server directory.

## Supported types

| Content type | Managed target | Import method |
|---|---|---|
| `java-world` | Paper server `worlds/` root | bounded ZIP extraction to staging, world structure validation, staged directory copy |
| `paper-plugin` | Paper server `plugins/` root | source hash verification, staged file copy, `plugin.yml`/`paper-plugin.yml` validation |
| `resource-pack` | Paper server `resource_packs/` root | source hash verification and staged file copy |
| `datapack` | `<server>/worlds/<worldId>/datapacks/` | source hash verification and staged file copy |

`bedrock-world`, `behavior-pack`, `skin`, `unknown`, malformed archives, RAR
archives, invalid sources, and providers without an import adapter are blocked
with structured reason codes before staging is created.

## Safety contract

- A `ContentImportPlanner` produces a `ContentImportPlan` before any mutation.
- Plans require explicit approval at execution time.
- Source SHA-256 is rechecked immediately before staging; changes after scan
  produce `SOURCE_HASH_MISMATCH`.
- Staging is isolated at `<stagingRoot>/<operationId>/` and removed in `finally`.
- ZIP extraction rejects traversal paths, absolute paths, drive-qualified paths,
  symbolic-link entries, unsupported compression methods, excessive entry
  counts, oversized entries, and oversized total extracted content.
- Extraction is streamed; archive contents are never extracted into source,
  provider, or live server directories.
- Minecraft's provider adapter owns its Paper `worlds/`, `plugins/`, and
  `resource_packs/` roots. All destinations are boundary-checked; derived names
  cannot escape them.
- Existing destinations cause `DESTINATION_COLLISION`; no overwrite path exists.
- A failure after destination creation removes only that newly-created
  destination and records `content.import.rolled-back`.
- Audit records are append-only JSON Lines at the configured audit-log path.

## Normalized plan

```ts
interface ContentImportPlan {
  operationId: string;
  contentId: string;
  contentType: ContentType;
  sourcePath: string;
  stagingPath: string;
  destinationPath: string;
  providerId: string;
  serverId?: string;
  compatibilityStatus: CompatibilityStatus;
  actions: ImportAction[];
  warnings: CompatibilityIssue[];
  requiresApproval: boolean;
}
```

## Automated acceptance evidence

`tests/content-import.test.ts` proves:

- Java-world ZIP imports through staging, validates `level.dat`, leaves the
  archive byte-identical, removes staging, and produces append-only audit
  records.
- Paper plugin JAR import validates the descriptor and preserves source bytes.
- Resource packs and datapacks are routed only to their correct managed roots;
  datapacks require an explicit target `worldId`.
- Execution without approval is blocked.
- Malformed ZIPs, RAR, unknown content, wrong provider, unsafe archive paths,
  destination collisions, and post-scan source-hash changes are blocked.

## Live Paper acceptance

The controlled live-Paper proof passed on 2026-09-20 using the disposable
managed Paper harness. The repeatable command is:

```text
npx tsx integration/minecraft/scripts/run-content-import-acceptance.ts
```

```text
Java world ZIP -> scan -> approved plan -> staged extraction
-> managed Paper world location -> Paper start -> provider detects world
-> original archive hash unchanged

Paper plugin JAR -> scan -> approved plan -> managed plugins directory
-> Paper restart -> plugin detected -> original JAR hash unchanged
```

Evidence: `integration/minecraft/evidence/JBGH-020B-live-import-1789919396431.json`

The run proved:

- Java world source archive scanned as `READY`, approved, safely staged, and
  installed at the provider-owned Paper `worlds/JBGH020BLiveWorld` destination.
- Paper started with `level-name=worlds/JBGH020BLiveWorld`; the Minecraft
  provider discovered the installed world and a real protocol client joined it.
- The source world archive SHA-256 was identical before and after import.
- A freshly compiled Paper plugin JAR was scanned, approved, staged, installed
  to the provider-owned `plugins/` destination, and enabled by Paper after a
  restart (`JBGH-020B acceptance plugin enabled`).
- The source plugin JAR SHA-256 was identical before and after import.
- Staging was empty after both operations, audit JSONL contained installation
  lifecycle entries, and all artifacts created by the run were removed after
  evidence capture.

The run used only generated temporary source content and the disposable
managed server harness; no newly discovered unmanifested archives were added to
the official JBGH-020 corpus.

## Completion checklist

- [x] Provider-neutral import plan and explicit approval gate
- [x] Isolated staging and guaranteed cleanup
- [x] SHA-256 re-verification before mutation
- [x] ZIP traversal, symlink, compression, count, and extraction-size controls
- [x] Managed-destination boundary and collision protection
- [x] Rollback and append-only audit trail
- [x] Automated acceptance for supported and blocked cases
- [x] Live Paper world import/start/detection acceptance
- [x] Live Paper plugin restart/detection acceptance

## AI Studio Consumption Guide

AI Studio may present a plan, its warnings, blocking reason codes, actions, and
append-only audit history. It must not auto-approve a plan, weaken a blocking
issue, change a destination boundary, or install from an unverified source.
