import { createHash } from "node:crypto";

interface AcceptanceArtifact { name: string; relativePath?: string; observedHash?: string }

function activeProperties(bytes: Uint8Array): Map<string, string> {
  const properties = new Map<string, string>();
  // Reject invalid UTF-8 rather than comparing replacement characters.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line);
    if (!match) throw new Error("Malformed active Java configuration: explicit key=value required.");
    const [, key, value] = match;
    if (properties.has(key)) throw new Error("Duplicate active Java configuration key: " + key);
    properties.set(key, value); // Keep literal values, including whitespace and escapes.
  }
  return properties;
}

/** Acceptance-only post-lifecycle check; production attachment verification stays byte-exact. */
export function assertAcceptanceArtifactIntact(
  kind: "java" | "bedrock",
  artifact: AcceptanceArtifact,
  after: Uint8Array,
  beforeJavaConfiguration?: Uint8Array,
): void {
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const changed = () => { throw new Error("Source artifact changed during acceptance: " + artifact.name); };
  if (kind !== "java" || artifact.name !== "configuration" || artifact.relativePath !== "server.properties") {
    if (hash(after) !== artifact.observedHash) changed();
    return;
  }
  // Anchor the pre-start semantic baseline to the verified attachment manifest.
  if (!beforeJavaConfiguration || hash(beforeJavaConfiguration) !== artifact.observedHash) changed();
  const before = activeProperties(beforeJavaConfiguration!);
  const current = activeProperties(after);
  if (before.size !== current.size) changed();
  for (const [key, value] of before) {
    if (!current.has(key) || current.get(key) !== value) changed();
  }
}
