import type { CompatibilityIssue, CompatibilityResult, CompatibilityStatus, ContentSourceKind, ContentType } from "./types";

export interface MinecraftCompatibilityInput {
  contentType: ContentType;
  targetId: string;
  sourceKind: ContentSourceKind;
  sizeBytes: number;
  classificationWarnings: string[];
}

const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024 * 1024; // 1 GiB

function issue(code: string, message: string, severity: CompatibilityIssue["severity"]): CompatibilityIssue {
  return { code, message, severity };
}

/**
 * Minecraft-specific compatibility rules. This is the only place in the
 * content library that knows about Java vs. Bedrock world storage, Paper
 * plugins, or Geyser's role as a protocol translator rather than a world
 * converter. Core content-library types remain provider-neutral.
 */
export function evaluateMinecraftCompatibility(input: MinecraftCompatibilityInput): CompatibilityResult {
  const { contentType, targetId, sourceKind, sizeBytes, classificationWarnings } = input;
  const issues: CompatibilityIssue[] = [];
  let status: CompatibilityStatus = "READY";

  if (sourceKind === "missing") {
    return { status: "BLOCKED", issues: [issue("SOURCE_NOT_FOUND", "The source path does not exist.", "blocking")] };
  }

  if (classificationWarnings.includes("ARCHIVE_MALFORMED")) {
    return {
      status: "UNKNOWN",
      issues: [issue("ARCHIVE_MALFORMED", "The archive could not be parsed safely and was not inspected further.", "blocking")],
    };
  }

  if (classificationWarnings.includes("EMPTY_SOURCE_DIRECTORY")) {
    status = "WARNING";
    issues.push(issue("EMPTY_SOURCE_DIRECTORY", "The source directory contains no files to inspect.", "warning"));
  }

  if (classificationWarnings.includes("RAR_FORMAT_UNSUPPORTED")) {
    status = downgrade(status, "WARNING");
    issues.push(
      issue(
        "RAR_FORMAT_UNSUPPORTED",
        "RAR archives are not inspected for internal structure. Re-package as ZIP for full compatibility evaluation.",
        "warning",
      ),
    );
  }

  if (contentType === "unknown") {
    return {
      status: issues.length > 0 ? status : "UNKNOWN",
      issues: issues.length > 0 ? issues : [issue("CONTENT_TYPE_NOT_RECOGNIZED", "No known content markers were found; the item was not guessed.", "blocking")],
    };
  }

  const isJavaTarget = targetId === "minecraft-main";
  const isBedrockTarget = targetId === "bedrock-main";

  switch (contentType) {
    case "bedrock-world":
      if (isJavaTarget) {
        status = "BLOCKED";
        issues.push(
          issue(
            "WORLD_EDITION_MISMATCH",
            "Bedrock-format world cannot be loaded directly by the selected Java/Paper provider. Geyser translates client protocol; it does not convert world storage formats.",
            "blocking",
          ),
        );
      } else if (isBedrockTarget) {
        status = downgrade(status, "READY");
      } else {
        status = "UNKNOWN";
      }
      break;

    case "java-world":
      if (isBedrockTarget) {
        status = "BLOCKED";
        issues.push(issue("WORLD_EDITION_MISMATCH", "Java-format world cannot be loaded directly by a Bedrock provider.", "blocking"));
      } else if (isJavaTarget) {
        status = downgrade(status, "READY");
      } else {
        status = "UNKNOWN";
      }
      break;

    case "paper-plugin":
      if (isBedrockTarget) {
        status = "BLOCKED";
        issues.push(issue("PROVIDER_TYPE_MISMATCH", "Paper plugins require a Java/Paper provider.", "blocking"));
      } else {
        if (classificationWarnings.includes("PLUGIN_DESCRIPTOR_NOT_FOUND")) {
          status = downgrade(status, "WARNING");
          issues.push(issue("PLUGIN_DESCRIPTOR_NOT_FOUND", "No plugin.yml/paper-plugin.yml descriptor was found inside the archive.", "warning"));
        } else {
          status = downgrade(status, "READY");
        }
      }
      break;

    case "resource-pack":
      if (isBedrockTarget) {
        status = downgrade(status, "READY");
      } else {
        status = downgrade(status, "READY");
      }
      break;

    case "behavior-pack":
      if (isJavaTarget) {
        status = "BLOCKED";
        issues.push(issue("PROVIDER_TYPE_MISMATCH", "Behavior packs are a Bedrock-only concept and cannot be applied to a Java/Paper provider.", "blocking"));
      } else {
        status = downgrade(status, "READY");
      }
      break;

    case "skin":
      status = downgrade(status, "WARNING");
      issues.push(issue("SKIN_FORMAT_UNVERIFIED", "Skin content was detected but its dimensions/format were not validated.", "info"));
      break;

    case "datapack":
      if (isBedrockTarget) {
        status = "BLOCKED";
        issues.push(issue("PROVIDER_TYPE_MISMATCH", "Data packs are a Java-only concept and cannot be applied to a Bedrock provider.", "blocking"));
      } else {
        status = downgrade(status, "READY");
      }
      break;

    default:
      status = "UNKNOWN";
  }

  if (classificationWarnings.includes("MANIFEST_UNREADABLE")) {
    status = downgrade(status, "WARNING");
    issues.push(issue("MANIFEST_UNREADABLE", "A manifest.json was present but could not be parsed as JSON.", "warning"));
  }

  if (classificationWarnings.includes("ARCHIVE_TOO_COMPLEX_TO_INSPECT")) {
    status = downgrade(status, "WARNING");
    issues.push(issue("ARCHIVE_TOO_COMPLEX_TO_INSPECT", "The archive's central directory exceeded safe in-memory inspection limits.", "warning"));
  }

  if (sizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
    issues.push(issue("LARGE_FILE_STREAMED_INSPECTION", "Source exceeds 1 GiB; hashing and inspection used bounded-memory streaming.", "info"));
  }

  return { status, issues };
}

/** Only allows a status to move towards a worse outcome (READY -> WARNING -> BLOCKED), never silently improves it. */
function downgrade(current: CompatibilityStatus, candidate: CompatibilityStatus): CompatibilityStatus {
  const rank: Record<CompatibilityStatus, number> = { READY: 0, WARNING: 1, UNKNOWN: 2, BLOCKED: 3 };
  return rank[candidate] > rank[current] ? candidate : current;
}
