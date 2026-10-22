import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ReadinessCheck } from "../core/host-readiness";
import type { RuntimeAttachmentPolicy } from "../core/runtime-attachment";
import { requiredFilesPresent } from "../host-platform/readiness";

export interface JavaDiscoveryOptions {
  approvedLocations: string[]; env?: NodeJS.ProcessEnv; selected?: boolean;
  versionProbe?: (executable: string) => Promise<{ stdout: string; stderr: string }>;
}
/** Only a bounded version command, never a server/JAR launch. No shell or Java option injection. */
export function probeJavaVersion(executable: string): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH"].includes(key.toUpperCase())) delete env[key];
  return new Promise((resolve, reject) => {
    execFile(executable, ["-version"], { shell: false, windowsHide: true, timeout: 4000, maxBuffer: 16384, encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error) reject(new Error("JAVA_VERSION_PROBE_FAILED")); else resolve({ stdout, stderr });
    });
  });
}
export function parseJavaVersion(output: string): { version: string; major: number } | undefined {
  if (output.length > 32768) return;
  const matches = [...output.matchAll(/^(?:openjdk|java) version "([0-9][0-9A-Za-z._+-]{0,63})"[^\r\n]*\r?$/gm)];
  if (matches.length !== 1) return;
  const version = matches[0][1], major = Number(version.startsWith("1.") ? version.split(".")[1] : version.split(/[._+-]/)[0]);
  return Number.isSafeInteger(major) && major > 0 ? { version, major } : undefined;
}
/** Provider-owned discovery reports versions; profile compatibility remains a preflight concern. */
export async function discoverJavaRuntimes(options: JavaDiscoveryOptions): Promise<ReadinessCheck[]> {
  const env = options.env ?? process.env;
  const candidates = new Map<string, { location: string; source: string }>();
  const add = (location: string | undefined, source: string) => {
    if (!location || !path.isAbsolute(location) || /^[/\\]{2}/.test(location) || candidates.size >= 64) return;
    const absolute = path.resolve(location), key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (!candidates.has(key)) candidates.set(key, { location: absolute, source });
  };
  for (const location of options.approvedLocations) add(location, "policy-reference");
  add(env.MINECRAFT_JAVA_PATH, "configured-path");
  const binary = process.platform === "win32" ? "java.exe" : "java";
  if (env.JAVA_HOME) add(path.join(env.JAVA_HOME, "bin", binary), "JAVA_HOME");
  for (const directory of (env.PATH ?? env.Path ?? "").split(path.delimiter).slice(0, 64)) if (path.isAbsolute(directory)) add(path.join(directory, binary), "PATH");
  const checks: ReadinessCheck[] = [];
  for (const { location, source } of candidates.values()) {
    const id = "java." + createHash("sha256").update(process.platform === "win32" ? location.toLowerCase() : location).digest("hex").slice(0, 20);
    try {
      const stat = await fs.lstat(location);
      if (!stat.isFile() || stat.isSymbolicLink()) { checks.push({ id, category: "runtime", status: "WARNING", code: "JAVA_CANDIDATE_UNSAFE" }); continue; }
      let discovered: ReturnType<typeof parseJavaVersion>;
      try {
        const result = await (options.versionProbe ?? probeJavaVersion)(location);
        discovered = parseJavaVersion(result.stderr + "\n" + result.stdout);
      } catch { /* Do not expose output, executable paths or subprocess errors. */ }
      checks.push({ id, category: "runtime", status: discovered ? "PASS" : "WARNING", code: discovered ? "JAVA_VERSION_DISCOVERED" : "JAVA_VERSION_UNAVAILABLE",
        facts: { source, ...(discovered ?? {}), versionProbeRun: true, serverLaunched: false, approvedRuntimeValidated: false } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") checks.push({ id, category: "runtime", status: "WARNING", code: "JAVA_CANDIDATE_UNREADABLE" });
      else if (source !== "PATH") checks.push({ id, category: "runtime", status: "WARNING", code: "JAVA_CONFIGURED_CANDIDATE_MISSING" });
    }
  }
  if (!checks.length) checks.push({ id: "java.discovery", category: "runtime", status: "WARNING", code: "JAVA_NOT_DISCOVERED" });
  if (options.selected && !checks.some(check => check.code === "JAVA_VERSION_DISCOVERED")) checks.push({ id: "java.required", category: "runtime", status: "BLOCKED", code: "JAVA_REQUIRED_NOT_DISCOVERED" });
  return checks;
}

export async function javaPrerequisites(policy: RuntimeAttachmentPolicy | undefined, selected: boolean): Promise<ReadinessCheck> {
  const profiles = Object.values(policy?.managedCreate?.profiles ?? {}).filter(profile => profile.providerId === "minecraft");
  if (!profiles.length) return { id: "java.prerequisites", category: "runtime", status: selected ? "BLOCKED" : "WARNING", code: "JAVA_PROFILE_NOT_CONFIGURED" };
  let available = 0;
  for (const profile of profiles) {
    const references = [...profile.artifacts.map(artifact => artifact.reference), profile.runtime?.reference];
    if (profile.runtime && await requiredFilesPresent(references.map(reference => reference && policy?.artifactLocations[reference]))) available++;
  }
  return { id: "java.prerequisites", category: "runtime", status: available ? "PASS" : selected ? "BLOCKED" : "WARNING", code: available ? "JAVA_SOURCE_PATHS_AVAILABLE" : "JAVA_SOURCE_PATHS_MISSING", facts: { profileCount: profiles.length, availableProfileCount: available, approvalValidated: false } };
}
