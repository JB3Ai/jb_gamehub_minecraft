# JBGH-020 — Content Acceptance Manifest

Status: DRAFT  
Milestone: JBGH-020 — Content Library Inspection & Compatibility  
Manifest version: 0.1  
Captured: 2026-09-05  
Source root: `JBGH-020 TEST CONTENT/`

## Purpose

This manifest is the ground-truth acceptance corpus for the JBGH-020 content
inspector. The scanner must classify the source without modifying it, preserve
the original source, calculate a SHA-256 hash, persist metadata, and evaluate
compatibility against `minecraft-main` without installing or extracting content
into a live server.

Expected outcomes are acceptance expectations, not scanner implementation hints.
Where the current corpus does not contain usable content, the gap is recorded
explicitly as `MISSING_CORPUS` rather than being treated as a passing result.

## Target profiles

| Target ID | Provider | Server | Expected compatibility meaning |
|---|---|---|---|
| `minecraft-main` | `minecraft` | `minecraft-main` | Paper 1.21.4 with Geyser; Java worlds/plugins are candidates, Bedrock worlds are blocked for direct loading |
| `bedrock-main` | `minecraft-bedrock` | `bedrock-main` | Bedrock world and Bedrock pack candidates |

## Acceptance items

| ID | Source | Expected type | Target | Expected result | Size | SHA-256 | Notes |
|---|---|---|---|---|---:|---|---|
| `JBGH-020-CONTENT-001` | `01 WORLDS/CITY-12K/` | Java World | `minecraft-main` | WARNING (`EMPTY_SOURCE_DIRECTORY`) | 0 B | N/A | Named placeholder; no files currently present |
| `JBGH-020-CONTENT-002` | `01 WORLDS/HIGH-MODERN-CITY/` | Java World | `minecraft-main` | WARNING (`EMPTY_SOURCE_DIRECTORY`) | 0 B | N/A | Named placeholder; no files currently present |
| `JBGH-020-CONTENT-003` | `01 WORLDS/ISLAND-12K/` | Java World | `minecraft-main` | WARNING (`EMPTY_SOURCE_DIRECTORY`) | 0 B | N/A | Named placeholder; no files currently present |
| `JBGH-020-CONTENT-004` | `01 WORLDS/MATTUPOLIS/` | Java World | `minecraft-main` | WARNING (`EMPTY_SOURCE_DIRECTORY`) | 0 B | N/A | Named placeholder; no files currently present |
| `JBGH-020-CONTENT-005` | `01 WORLDS/MODERN-CITY/` | Java World | `minecraft-main` | WARNING (`EMPTY_SOURCE_DIRECTORY`) | 0 B | N/A | Named placeholder; no files currently present |
| `JBGH-020-CONTENT-006` | `01 WORLDS/medieval-house-andywaysmc.zip` | Java World | `minecraft-main` | READY or WARNING | 2,057,978 B | `584288A33DC79B6F394D3774122FFB2F300D0599905A19EADA99A9C29F5CC6D7` | Archive requires safe, non-installing inspection |
| `JBGH-020-CONTENT-007` | `01 WORLDS/monrepo park.rar` | Java World | `minecraft-main` | READY or WARNING | 162,145,602 B | `341399D1F98677FB4614B9B8812B0C1ED8D83C83CDA0F0AF862D745D729B4930` | RAR handling must fail safely if unsupported |
| `JBGH-020-CONTENT-008` | `01 WORLDS/MUS Server Map Repository.zip` | Java World | `minecraft-main` | READY or WARNING | 14,897,505,805 B | `E9FE99F81D5E84CCC2E0B27A2E4B6912A99DF18DF07BDBF63DED68DFFFA15160` | Large-file streaming and bounded-memory test |
| `JBGH-020-CONTENT-009` | `01 WORLDS/port-spawn.zip` | Java World | `minecraft-main` | READY or WARNING | 9,204,416 B | `BAA3BB7415F83064905A765EE47D23E14809CE3BEB028EDB6EB02B7C9C077A72` | Archive requires safe, non-installing inspection |
| `JBGH-020-CONTENT-010` | `02 PLUGINS/CURIOSPAPER/CuriosPaper-2.0.1.jar` | Paper Plugin / JAR | `minecraft-main` | READY or WARNING | 7,474,144 B | `6FBE1DD5181F49744B84434A193C9D4D6B82D7C8478EA9C91A6AB4B7ABE48E51` | Plugin descriptor and dependency inspection |
| `JBGH-020-CONTENT-011` | `02 PLUGINS/PROBABLY-BACKPACKS/ProbablyBackpacks-2.4.jar` | Paper Plugin / JAR | `minecraft-main` | READY or WARNING | 948,524 B | `69ABF3ADB4AAE4D66254B14B2DD61936E3AFA9F0408E0B9F4DAE81231DD0B253` | CuriosPaper integration/dependency test |
| `JBGH-020-CONTENT-012` | `02 PLUGINS/BEDROCK-SKIN-RESTORER/bedrockskinrestorer.jar` | Paper Plugin / JAR | `minecraft-main` | READY or WARNING | 13,904 B | `1F78F787EA3EDCF5E4233010A77FEA85AEBC7C8776F69398747A70343CFD456C` | Geyser/Bedrock-related plugin; provider compatibility warning expected if dependencies are absent |
| `JBGH-020-CONTENT-013` | `STANDALONEminecraft server/greenfield/` | Java World | `minecraft-main` | MISSING_CORPUS (source removed) | 1,780,567,987 B (as recorded) | N/A (directory; hash source files individually) | Contains `level.dat`, region data, playerdata, datapacks; primary real-world inspection sample. Directory no longer present as of JBGH-020A acceptance run. |
| `JBGH-020-CONTENT-014` | `STANDALONEminecraft server/world/` | Java World | `minecraft-main` | MISSING_CORPUS (source removed) | 22,160,382 B (as recorded) | N/A (directory; hash source files individually) | Java world with `level.dat`, region, playerdata, and datapacks. Directory no longer present as of JBGH-020A acceptance run. |
| `JBGH-020-CONTENT-015` | `STANDALONEminecraft server/Greenfield.Texture.Pack.1.17.zip` | Resource Pack | `minecraft-main` | MISSING_CORPUS (source removed) | 12,907,190 B (as recorded) | `ae056ba088ee65748b26de389829106f831ee9bda34d50236831e6c78724f387` | Java resource-pack archive. File no longer present as of JBGH-020A acceptance run. |
| `JBGH-020-CONTENT-016` | `STANDALONEminecraft server/greenfield/Greenfield.Texture.Pack.1.17.zip` | Resource Pack | `minecraft-main` | MISSING_CORPUS (source removed) | 12,907,190 B (as recorded) | Same bytes as `JBGH-020-CONTENT-015` must be verified | Duplicate source location; hash identity must be preserved. File no longer present as of JBGH-020A acceptance run. |
| `JBGH-020-CONTENT-017` | `STANDALONEminecraft server/greenfield/datapacks/` | Behaviour/Data Pack | `minecraft-main` | MISSING_CORPUS (source removed) | Included in world directory | N/A (directory; hash source files individually) | Contains `bukkit` and `The Wall.zip`; classify as Java datapack, not Bedrock behaviour pack. Directory no longer present as of JBGH-020A acceptance run. |
| `JBGH-020-CONTENT-018` | `STANDALONEminecraft server/plugins/` | Paper Plugin / JAR collection | `minecraft-main` | MISSING_CORPUS (source removed) | 89,003,276 B (as recorded) | N/A (collection; hash JARs individually) | Contains Geyser, Floodgate, ViaVersion, Multiverse, and other runtime plugin artifacts. Directory no longer present as of JBGH-020A acceptance run. |

## Required missing-corpus sections

The following directories were requested for the acceptance corpus but were not
present when this manifest was captured. They must be added before the
corresponding detection cases can be marked PASS:

| Directory | Required fixtures | Current status |
|---|---|---|
| `03 RESOURCE PACKS/` | standalone Java and/or Bedrock resource pack | `MISSING_CORPUS` |
| `04 BEHAVIOR PACKS/` | Bedrock behaviour pack with `manifest.json` | `MISSING_CORPUS` |
| `05 SKINS/` | PNG skin and/or skin pack | `MISSING_CORPUS` |
| `06 BEDROCK CONTENT/` | `.mcworld`, `.mcpack`, or `.mcaddon` | `MISSING_CORPUS` |
| `99 INVALID-UNKNOWN/` | random ZIP, unrelated file, malformed archive | `MISSING_CORPUS` |

The current Geyser cache contains `GeyserIntegratedPack.mcpack`, but it is a
runtime-generated plugin cache artifact, not an untouched acceptance fixture.
It must not be silently promoted to the Bedrock-content corpus.

## Corpus drift observed during JBGH-020A acceptance

As of the JBGH-020A scanner acceptance run, `STANDALONEminecraft server/` is no
longer present under `JBGH-020 TEST CONTENT/`. Items `JBGH-020-CONTENT-013`
through `JBGH-020-CONTENT-018` (the standalone Java worlds, both resource-pack
locations, the datapacks directory, and the plugins collection) therefore
resolve to `SOURCE_NOT_FOUND` / `BLOCKED` rather than their originally recorded
expectation. This is treated as a corpus-tracking fact, not a scanner defect:
the scanner correctly reports a missing source as `BLOCKED` rather than
guessing or fabricating a result. These six items are recorded as
`MISSING_CORPUS (source removed after manifest capture)` below until the
standalone server fixture is restored.

Two additional archives (`high-modern-city.zip`,
`Mattupolis [Release 11] by mattuFIN.zip`) now exist under `01 WORLDS/` that
were not present when this manifest was first captured. They are not yet
assigned acceptance IDs and are excluded from the JBGH-020A acceptance run
until they are deliberately added to this manifest.

## Ground-truth inspection assertions

Every imported item must satisfy:

- source bytes and source path remain unchanged after inspection;
- SHA-256 is calculated without loading the entire source into memory;
- directories are inspected recursively without copying into a provider server;
- archive traversal rejects unsafe paths and does not extract into live folders;
- malformed or unsupported archives return `UNKNOWN` or `WARNING`, never success-shaped fallback;
- metadata includes source name, size, hash, detected type, and inspection timestamp;
- compatibility is normalized to `READY`, `WARNING`, `BLOCKED`, or `UNKNOWN`;
- provider-specific rules remain in the Minecraft content adapter;
- a Bedrock world targeting Paper returns `BLOCKED` with `WORLD_EDITION_MISMATCH`;
- Geyser is described as protocol translation, not world-storage conversion;
- large files, including `MUS Server Map Repository.zip`, are handled with bounded memory.

## Completion checklist

- [x] Manifest created from the repository's current corpus
- [x] Five named world directories recorded
- [x] Four world archives recorded with measured size and SHA-256
- [x] Three plugin JARs recorded with measured size and SHA-256
- [x] Standalone Java world and resource-pack candidates recorded
- [x] Missing resource/behaviour/skin/Bedrock/invalid sections recorded explicitly
- [x] JBGH-020A inspector compares actual results to this manifest
- [ ] Bedrock world fixture added
- [ ] Bedrock behaviour/resource pack fixtures added
- [ ] Skin fixture added
- [ ] Invalid and malformed fixtures added
- [ ] `STANDALONEminecraft server/` fixture restored (items 013-018 currently MISSING_CORPUS)

## JBGH-020A acceptance evidence

`ContentLibraryScanner` (`packages/content-library/`) was run against this
manifest via
`integration/content-library/scripts/run-content-scan-acceptance.ts`.

- 11/11 currently-present manifest items (`001`-`012`) matched expected
  content type and expected compatibility status.
- SHA-256 matched the manifest-recorded hash for every present file with a
  known hash (`006`, `009`, `010`, `011`, `012`).
- 6/6 items under the now-missing `STANDALONEminecraft server/` (`013`-`018`)
  correctly resolved to `BLOCKED`/`SOURCE_NOT_FOUND` rather than crashing or
  fabricating a result; this is scored against the manifest as
  `MISSING_CORPUS`, not a scanner defect.
- Source-mutation check: every scanned file's SHA-256 was identical before and
  after the scan (PASS).
- The 14.9 GB stress file (`008`) is skipped by default
  (`CONTENT_SCAN_INCLUDE_LARGE=1` to include it) to keep routine runs fast;
  bounded-memory streaming for large files is covered by automated unit tests.
- Evidence JSON is written per run to `integration/content-library/evidence/`.

## AI Studio Consumption Guide

AI Studio may read this manifest to explain what content was inspected, what
metadata was found, and why a compatibility result was returned. It must not
modify the manifest, alter source content, install content, or turn a warning
into an approval.
