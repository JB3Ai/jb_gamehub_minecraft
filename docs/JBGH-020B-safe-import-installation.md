# JBGH-020B — Safe Import / Installation Pipeline

Status: IMPLEMENTED / LIVE ACCEPTANCE PENDING
Milestone: JBGH-020B — Safe Import / Installation Pipeline
Dependencies: JBGH-020A Content Scanner & Corpus Classification
Implementation: `packages/content-library/importer.ts`

## Objective

Install only scanner-validated, explicitly approved content into GameHub-managed
locations. Import is deliberately separate from inspection:

```text
source (read-only)
  -> JBGH-020A ContentItem
  -> import plan
  -> compatibility and safety gate
  -> operation-scoped staging
  -> managed destination
```

No source file is modified, and no item is installed directly from its source
path into a live server directory.

## Supported types

| Content type | Managed target | Import method |
|---|---|---|
| `java-world` | configured managed-world root | bounded ZIP extraction to staging, world structure validation, staged directory copy |
| `paper-plugin` | configured managed-plugin root | source hash verification, staged file copy, `plugin.yml`/`paper-plugin.yml` validation |
| `resource-pack` | configured managed-resource-pack root | source hash verification and staged file copy |
| `datapack` | `<managed-worlds>/<worldId>/datapacks/` | source hash verification and staged file copy |

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
- Managed destination roots are boundary-checked; derived names cannot escape
  them.
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

## Live Paper acceptance still required

The controlled live-Paper proof remains an explicit gate before this milestone
can be closed:

```text
Java world ZIP -> scan -> approved plan -> staged extraction
-> managed Paper world location -> Paper start -> provider detects world
-> original archive hash unchanged

Paper plugin JAR -> scan -> approved plan -> managed plugins directory
-> Paper restart -> plugin detected -> original JAR hash unchanged
```

That run must use disposable managed server directories and must not introduce
the newly discovered unmanifested world archives into the official JBGH-020
corpus.

## Completion checklist

- [x] Provider-neutral import plan and explicit approval gate
- [x] Isolated staging and guaranteed cleanup
- [x] SHA-256 re-verification before mutation
- [x] ZIP traversal, symlink, compression, count, and extraction-size controls
- [x] Managed-destination boundary and collision protection
- [x] Rollback and append-only audit trail
- [x] Automated acceptance for supported and blocked cases
- [ ] Live Paper world import/start/detection acceptance
- [ ] Live Paper plugin restart/detection acceptance

## AI Studio Consumption Guide

AI Studio may present a plan, its warnings, blocking reason codes, actions, and
append-only audit history. It must not auto-approve a plan, weaken a blocking
issue, change a destination boundary, or install from an unverified source.
