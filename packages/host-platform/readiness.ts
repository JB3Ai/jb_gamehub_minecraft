import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReadinessProbeError, type HostObservation, type StorageObservation } from "../core/host-readiness";

// Fixed read-only script. No request/policy text is interpolated into a command.
export const WINDOWS_READINESS_SCRIPT = `
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
$tcpAvailable=[bool](Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)
$udpAvailable=[bool](Get-Command Get-NetUDPEndpoint -ErrorAction SilentlyContinue)
$bindings=@()
$complete=$false
if ($tcpAvailable -and $udpAvailable) {
  $tcp=@(Get-NetTCPConnection -ErrorAction Stop)
  $udp=@(Get-NetUDPEndpoint -ErrorAction Stop)
  $bindings=@($tcp | ForEach-Object { @{ transport='tcp'; bindAddress=$_.LocalAddress; port=[int]$_.LocalPort } }) + @($udp | ForEach-Object { @{ transport='udp'; bindAddress=$_.LocalAddress; port=[int]$_.LocalPort } })
  $complete=$true
}
@{ elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); nativeX64=([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq 'X64'); capabilities=($PSVersionTable.PSVersion.Major -ge 5 -and $tcpAvailable -and $udpAvailable); complete=$complete; bindings=@($bindings) } | ConvertTo-Json -Depth 5 -Compress
`;
export function parseWindowsObservation(raw: string): HostObservation {
  const value = JSON.parse(raw);
  if (!value || typeof value.elevated !== "boolean" || typeof value.nativeX64 !== "boolean" || typeof value.capabilities !== "boolean" || typeof value.complete !== "boolean" || !Array.isArray(value.bindings)) throw new Error("HOST_OBSERVATION_UNAVAILABLE");
  return { platform: "win32", architecture: value.nativeX64 && process.arch === "x64" ? "x64" : "unsupported", elevated: value.elevated,
    capabilityChecksAvailable: value.capabilities, inventory: { complete: value.complete, bindings: value.bindings } };
}
export async function observeHost(): Promise<HostObservation> {
  if (process.platform !== "win32") return { platform: process.platform, architecture: os.machine(), elevated: false, capabilityChecksAvailable: false, inventory: { complete: false, bindings: [] } };
  const raw = await new Promise<string>((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_READINESS_SCRIPT],
      { windowsHide: true, timeout: 7000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => error ? reject(new Error("HOST_OBSERVATION_UNAVAILABLE")) : resolve(stdout));
  });
  return parseWindowsObservation(raw);
}

/** Existing nearest ancestor only; never mkdir, open-for-write, probe a port, or follow a link. */
export async function observeStorage(location: string): Promise<StorageObservation> {
  if (!path.isAbsolute(location) || /^[/\\]{2}/.test(location)) throw new ReadinessProbeError("STORAGE_PATH_UNSAFE");
  const absolute = path.resolve(location), root = path.parse(absolute).root;
  let current = root, exists = true;
  for (const part of ["", ...absolute.slice(root.length).split(path.sep).filter(Boolean)]) {
    const candidate = part ? path.join(current, part) : current;
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw new ReadinessProbeError("STORAGE_PATH_UNSAFE");
      if (!stat.isDirectory()) throw new ReadinessProbeError("STORAGE_NOT_DIRECTORY");
      current = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { exists = false; break; }
      if ((error as NodeJS.ErrnoException).code === "EACCES" || (error as NodeJS.ErrnoException).code === "EPERM") throw new ReadinessProbeError("STORAGE_ACCESS_DENIED");
      throw error;
    }
  }
  let access: StorageObservation["access"] = "allowed-advisory";
  try { await fs.access(current, constants.W_OK | constants.R_OK); } catch { access = "denied"; }
  const capacity = await fs.statfs(current, { bigint: true });
  return { exists, access, availableBytes: capacity.bavail * capacity.bsize };
}

export async function observeDatabase(location: string) {
  if (!path.isAbsolute(location) || /^[/\\]{2}/.test(location)) throw new Error("DATABASE_LOCATION_UNAVAILABLE");
  const parent = await observeStorage(path.dirname(location));
  let exists = true, readable = false, formatValid = false;
  try {
    const stat = await fs.lstat(location);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("DATABASE_LOCATION_UNAVAILABLE");
    const file = await fs.open(location, "r");
    try {
      const header = Buffer.alloc(16), { bytesRead } = await file.read(header, 0, 16, 0);
      readable = true; formatValid = bytesRead === 16 && header.toString("binary") === "SQLite format 3\u0000";
    } finally { await file.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false; else throw error; }
  return { exists, readable, formatValid, locationAccess: parent.access };
}

/** Presence only; neither executes nor approves a discovered source. */
export async function requiredFilesPresent(locations: Array<string | undefined>): Promise<boolean> {
  if (!locations.length || locations.length > 16384) return false;
  for (const location of locations) {
    if (!location || !path.isAbsolute(location) || /^[/\\]{2}/.test(location)) return false;
    try { const stat = await fs.lstat(location); if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) return false; }
    catch { return false; }
  }
  return true;
}

/** Selection validation only; never executes or copies the referenced runtime. */
export async function hashSetupReference(location: string): Promise<string> {
  if (!await requiredFilesPresent([location])) throw new Error("RUNTIME_REFERENCE_UNAVAILABLE");
  await observeStorage(path.dirname(location));
  const file = await fs.open(location, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error("RUNTIME_REFERENCE_UNAVAILABLE");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest("hex");
  } finally { await file.close(); }
}
