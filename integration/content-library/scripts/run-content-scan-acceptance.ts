/**
 * JBGH-020A acceptance runner.
 *
 * Scans the real JBGH-020 test corpus using the ContentLibraryScanner and
 * compares actual results against the ground-truth expectations recorded in
 * `docs/JBGH-020-content-acceptance-manifest.md`. This proves the scanner
 * against real, messy content rather than only against synthetic fixtures.
 *
 * Usage:
 *   npx tsx integration/content-library/scripts/run-content-scan-acceptance.ts
 *
 * By default the ~14.9 GB stress-test archive (JBGH-020-CONTENT-008) is
 * skipped to keep the run fast. Set CONTENT_SCAN_INCLUDE_LARGE=1 to include it.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContentLibraryScanner } from "../../../packages/content-library/scanner";
import type { ContentScanTarget } from "../../../packages/content-library/types";

const CORPUS_ROOT = path.resolve(process.cwd(), "JBGH-020 TEST CONTENT");
const EVIDENCE_DIR = path.resolve(process.cwd(), "integration/content-library/evidence");
const INCLUDE_LARGE = process.env.CONTENT_SCAN_INCLUDE_LARGE === "1";

const TARGET: ContentScanTarget = { targetId: "minecraft-main", providerId: "minecraft" };

interface ManifestItem {
  manifestId: string;
  relativePath: string;
  expectedType: string;
  expectedResults: string[];
  expectedSha256?: string;
  large?: boolean;
}

// Mirrors docs/JBGH-020-content-acceptance-manifest.md acceptance items 001-018.
const MANIFEST: ManifestItem[] = [
  { manifestId: "JBGH-020-CONTENT-001", relativePath: "01 WORLDS/CITY-12K", expectedType: "unknown", expectedResults: ["WARNING"] },
  { manifestId: "JBGH-020-CONTENT-002", relativePath: "01 WORLDS/HIGH-MODERN-CITY", expectedType: "unknown", expectedResults: ["WARNING"] },
  { manifestId: "JBGH-020-CONTENT-003", relativePath: "01 WORLDS/ISLAND-12K", expectedType: "unknown", expectedResults: ["WARNING"] },
  { manifestId: "JBGH-020-CONTENT-004", relativePath: "01 WORLDS/MATTUPOLIS", expectedType: "unknown", expectedResults: ["WARNING"] },
  { manifestId: "JBGH-020-CONTENT-005", relativePath: "01 WORLDS/MODERN-CITY", expectedType: "unknown", expectedResults: ["WARNING"] },
  {
    manifestId: "JBGH-020-CONTENT-006",
    relativePath: "01 WORLDS/medieval-house-andywaysmc.zip",
    expectedType: "java-world",
    expectedResults: ["READY", "WARNING"],
  },
  { manifestId: "JBGH-020-CONTENT-007", relativePath: "01 WORLDS/monrepo park.rar", expectedType: "unknown", expectedResults: ["WARNING"] },
  { manifestId: "JBGH-020-CONTENT-008", relativePath: "01 WORLDS/MUS Server Map Repository.zip", expectedType: "java-world", expectedResults: ["READY", "WARNING"], large: true },
  { manifestId: "JBGH-020-CONTENT-009", relativePath: "01 WORLDS/port-spawn.zip", expectedType: "java-world", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-010", relativePath: "02 PLUGINS/CURIOSPAPER/CuriosPaper-2.0.1.jar", expectedType: "paper-plugin", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-011", relativePath: "02 PLUGINS/PROBABLY-BACKPACKS/ProbablyBackpacks-2.4.jar", expectedType: "paper-plugin", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-012", relativePath: "02 PLUGINS/BEDROCK-SKIN-RESTORER/bedrockskinrestorer.jar", expectedType: "paper-plugin", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-013", relativePath: "STANDALONEminecraft server/greenfield", expectedType: "java-world", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-014", relativePath: "STANDALONEminecraft server/world", expectedType: "java-world", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-015", relativePath: "STANDALONEminecraft server/Greenfield.Texture.Pack.1.17.zip", expectedType: "resource-pack", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-016", relativePath: "STANDALONEminecraft server/greenfield/Greenfield.Texture.Pack.1.17.zip", expectedType: "resource-pack", expectedResults: ["READY", "WARNING"] },
  { manifestId: "JBGH-020-CONTENT-017", relativePath: "STANDALONEminecraft server/greenfield/datapacks", expectedType: "unknown", expectedResults: ["READY", "WARNING", "UNKNOWN"] },
  { manifestId: "JBGH-020-CONTENT-018", relativePath: "STANDALONEminecraft server/plugins", expectedType: "paper-plugin", expectedResults: ["READY", "WARNING"] },
];

// Known-good hashes recorded in the manifest for items whose bytes are small enough to have been hashed at manifest-authoring time.
const EXPECTED_HASHES: Record<string, string> = {
  "JBGH-020-CONTENT-006": "584288a33dc79b6f394d3774122ffb2f300d0599905a19eada99a9c29f5cc6d7".slice(0, 64),
  "JBGH-020-CONTENT-009": "baa3bb7415f83064905a765ee47d23e14809ce3beb028edb6eb02b7c9c077a72".slice(0, 64),
  "JBGH-020-CONTENT-010": "6fbe1dd5181f49744b84434a193c9d4d6b82d7c8478ea9c91a6ab4b7abe48e51".slice(0, 64),
  "JBGH-020-CONTENT-011": "69abf3adb4aae4d66254b14b2dd61936e3afa9f0408e0b9f4dae81231dd0b253".slice(0, 64),
  "JBGH-020-CONTENT-012": "1f78f787ea3edcf5e4233010a77fea85aebc7c8776f69398747a70343cfd456c".slice(0, 64),
  "JBGH-020-CONTENT-015": "ae056ba088ee65748b26de389829106f831ee9bda34d50236831e6c78724f387".slice(0, 64),
};

function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function main(): Promise<void> {
  const scanner = new ContentLibraryScanner();
  const included = MANIFEST.filter((item) => !item.large || INCLUDE_LARGE);
  const skipped = MANIFEST.filter((item) => item.large && !INCLUDE_LARGE);

  const manifestIdsByPath: Record<string, string> = {};
  const paths: string[] = [];
  for (const item of included) {
    const absolute = path.join(CORPUS_ROOT, item.relativePath);
    paths.push(absolute);
    manifestIdsByPath[absolute] = item.manifestId;
  }

  console.log(`[JBGH-020A] Scanning ${paths.length} manifest item(s) (${skipped.length} skipped: large stress file)`);
  const report = await scanner.scan({ paths, target: TARGET, manifestIdsByPath });

  const results: Array<Record<string, unknown>> = [];
  let passCount = 0;
  let failCount = 0;

  for (const item of included) {
    const absolute = path.join(CORPUS_ROOT, item.relativePath);
    const scanned = report.items.find((entry) => entry.sourcePath === path.resolve(absolute));
    const typeOk = scanned?.contentType === item.expectedType;
    const statusOk = scanned ? item.expectedResults.includes(scanned.compatibility.status) : false;

    let hashOk = true;
    const expectedHash = EXPECTED_HASHES[item.manifestId];
    if (expectedHash) {
      hashOk = scanned?.sha256 === expectedHash;
    }

    const pass = typeOk && statusOk && hashOk;
    if (pass) passCount += 1;
    else failCount += 1;

    results.push({
      manifestId: item.manifestId,
      relativePath: item.relativePath,
      expectedType: item.expectedType,
      actualType: scanned?.contentType,
      expectedResults: item.expectedResults,
      actualStatus: scanned?.compatibility.status,
      expectedSha256: expectedHash,
      actualSha256: scanned?.sha256,
      warnings: scanned?.warnings,
      pass,
    });
  }

  // Non-mutation proof: re-hash every scanned *file* (not directory) after the scan and confirm identical bytes.
  const integrityChecks: Array<{ path: string; unchanged: boolean }> = [];
  for (const item of report.items) {
    if (item.hashScope !== "file" || !item.sha256) continue;
    const rehash = await sha256OfFile(item.sourcePath);
    integrityChecks.push({ path: item.sourcePath, unchanged: rehash === item.sha256 });
  }
  const integrityFailures = integrityChecks.filter((check) => !check.unchanged);

  const evidence = {
    milestone: "JBGH-020A",
    capturedAt: new Date().toISOString(),
    corpusRoot: CORPUS_ROOT,
    target: TARGET,
    includeLarge: INCLUDE_LARGE,
    skippedItems: skipped.map((item) => item.manifestId),
    results,
    integrityChecks,
    summary: {
      totalManifestItemsEvaluated: included.length,
      pass: passCount,
      fail: failCount,
      sourceMutationDetected: integrityFailures.length > 0,
    },
  };

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const evidencePath = path.join(EVIDENCE_DIR, `JBGH-020A-content-scan-${Date.now()}.json`);
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");

  console.log(`[JBGH-020A] ${passCount}/${included.length} manifest items PASS, ${failCount} FAIL`);
  console.log(`[JBGH-020A] Source-mutation check: ${integrityFailures.length === 0 ? "PASS (no source bytes changed)" : "FAIL"}`);
  console.log(`[JBGH-020A] Evidence written to ${evidencePath}`);

  for (const result of results.filter((r) => !r.pass)) {
    console.log(`[JBGH-020A] FAIL ${result.manifestId}: expectedType=${result.expectedType} actualType=${result.actualType} expectedResults=${JSON.stringify(result.expectedResults)} actualStatus=${result.actualStatus}`);
  }

  if (failCount > 0 || integrityFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[JBGH-020A] acceptance run failed:", error);
  process.exitCode = 1;
});
