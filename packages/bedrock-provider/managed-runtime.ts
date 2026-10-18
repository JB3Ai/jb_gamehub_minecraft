import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { BedrockProvider, type BedrockProviderConfig } from "./index";
import { canonicalManagedPath } from "../core/managed-filesystem";
import type { ManagedBootAttempt, ManagedRuntimeBootControl } from "../core/managed-boot";
import type { ProviderActionResult, ServerStatus } from "../provider-manager";

export interface UdpBinding { host: string; port: number; pid: number }
export interface ManagedBedrockOptions {
  observeUdp?: () => Promise<{ complete: boolean; bindings: UdpBinding[] }>;
  stopTimeoutMs?: number; pollMs?: number;
}
/** Complete inventory, including foreign listeners. A query failure never means ports are free. */
export async function observeWindowsUdp(): Promise<{ complete: boolean; bindings: UdpBinding[] }> {
  if (process.platform !== "win32") throw new Error("UDP_INVENTORY_UNAVAILABLE");
  const command = "$ErrorActionPreference='Stop'; $rows=@(Get-NetUDPEndpoint -ErrorAction Stop | Select-Object @{n='host';e={$_.LocalAddress}},@{n='port';e={[int]$_.LocalPort}},@{n='pid';e={[int]$_.OwningProcess}}); ConvertTo-Json -InputObject $rows -Compress";
  const text = await new Promise<string>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => error ? reject(new Error("UDP_INVENTORY_UNAVAILABLE")) : resolve(stdout)));
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 32768 || value.some(row => !row || typeof row.host !== "string" || !Number.isInteger(row.port) || !Number.isInteger(row.pid) || row.port < 1 || row.port > 65535 || row.pid < 0)) throw new Error("UDP_INVENTORY_UNAVAILABLE");
  return { complete: true, bindings: value };
}

/** G-C2 managed-only lifecycle. Configured and ADOPTED native Bedrock keep their existing behavior. */
export class ManagedBedrockRuntime extends BedrockProvider {
  private attempt?: ManagedBootAttempt;
  private signal = false;
  private version = false;
  private stopping = false;
  private persistenceFailed = false;
  private readonly root: string;
  private readonly stopTimeout: number;
  private readonly poll: number;
  constructor(config: BedrockProviderConfig, private readonly boot: ManagedRuntimeBootControl,
    private readonly endpoints: Array<{ host: string; port: number }>, private readonly options: ManagedBedrockOptions = {}) {
    super(config); this.root = config.serverDir!; this.stopTimeout = options.stopTimeoutMs ?? 30000; this.poll = options.pollMs ?? 100;
  }
  private async udp() {
    const result = await (this.options.observeUdp ?? observeWindowsUdp)();
    if (!result.complete || !Array.isArray(result.bindings)) throw new Error("UDP_INVENTORY_UNAVAILABLE");
    return result.bindings;
  }
  private free(bindings: UdpBinding[]) { return !bindings.some(row => this.endpoints.some(endpoint => row.port === endpoint.port)); }
  protected observeRuntimeLine(line: string, child: ChildProcess, stream: "stdout" | "stderr") {
    if (stream !== "stdout" || child !== this.ownedProcess() || line.length > 512) return;
    const message = line.replace(/^\[[^\]\r\n]{1,160}\]\s*/, "");
    if (/^Version: 1\.26\.51\.1\s*$/.test(message)) this.version = true;
    if (message === "Server started.") this.signal = true;
  }
  async startServer(serverId: string): Promise<ProviderActionResult> {
    await super.getServerStatus(serverId);
    if (this.ownedProcess()) throw new Error("MANAGED_RUNTIME_ALREADY_RUNNING");
    if (!this.free(await this.udp())) throw new Error("MANAGED_ENDPOINT_OCCUPIED");
    this.attempt = this.boot.begin(); this.signal = false; this.version = false; this.stopping = false; this.persistenceFailed = false;
    const attempt = this.attempt;
    try {
      const result = await super.startServer(serverId), child = this.ownedProcess();
      if (!child?.pid) throw new Error("MANAGED_SPAWN_UNVERIFIED");
      this.boot.record(attempt, "RUNNING", { pid: child.pid, startedAt: new Date().toISOString() });
      child.once("exit", (code) => {
        this.signal = false; this.version = false;
        if (!this.stopping) {
          try { this.boot.record(attempt, "FAILED", { reason: "UNEXPECTED_EXIT", exitCode: code, retryable: false }); }
          catch { this.persistenceFailed = true; }
        }
      });
      return result;
    } catch (error) {
      if (!this.ownedProcess()) this.boot.record(attempt, "FAILED", { reason: "SPAWN_FAILED", retryable: true });
      else this.persistenceFailed = true;
      throw error;
    }
  }
  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const base = await super.getServerStatus(serverId), child = this.ownedProcess(), active = this.boot.current()?.attempt;
    if (this.stopping) return { ...base, status: "stopping", readiness: "STOPPING" };
    if (!child) {
      const unresolved = active && active.state !== "STOPPED" && !(active.state === "FAILED" && (active.evidence as { retryable?: boolean })?.retryable);
      return { ...base, status: unresolved ? "error" : "offline", readiness: unresolved ? "FAILED" : "OFFLINE" };
    }
    const evidence = { startupSignal: this.signal, versionMatched: this.version, udpEndpoints: false, worldValidated: false, processId: child.pid, attemptId: this.attempt?.id };
    if (!this.persistenceFailed && this.signal && this.version) {
      try {
        const bindings = await this.udp(), owned = bindings.filter(row => row.pid === child.pid);
        evidence.udpEndpoints = owned.length === this.endpoints.length && this.endpoints.every(endpoint => owned.some(row => row.port === endpoint.port && row.host === endpoint.host)) && !bindings.some(row => row.pid !== child.pid && this.endpoints.some(endpoint => row.port === endpoint.port));
        const world = path.join(this.root, "worlds", this.boot.worldName), location = path.join(world, "level.dat");
        if (canonicalManagedPath(world) === world) {
          const metadata = await fs.lstat(location);
          const worlds = await this.getWorlds(serverId), validation = await this.validateWorld(serverId, this.boot.worldName);
          evidence.worldValidated = metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && metadata.size > 0 && worlds.some(item => item.id === this.boot.worldName) && validation.valid;
        }
      } catch { /* Missing or unverified observations keep this attempt starting. */ }
    }
    const ready = !this.persistenceFailed && child === this.ownedProcess() && child.exitCode === null && !child.killed && evidence.startupSignal && evidence.versionMatched && evidence.udpEndpoints && evidence.worldValidated;
    if (ready && this.attempt && active?.state !== "READY") {
      try { this.boot.record(this.attempt, "READY", { ...evidence }); }
      catch { this.persistenceFailed = true; }
    }
    return { ...base, status: this.persistenceFailed ? "error" : ready ? "online" : "starting", readiness: this.persistenceFailed ? "FAILED" : ready ? "READY" : "STARTING", readinessEvidence: evidence };
  }
  async stopServer(serverId: string): Promise<ProviderActionResult> {
    await super.getServerStatus(serverId);
    const child = this.ownedProcess(), attempt = this.attempt;
    if (!child || !attempt) throw new Error("MANAGED_PROCESS_OWNERSHIP_UNAVAILABLE");
    this.stopping = true;
    let exitCode: number | null | undefined = child.exitCode;
    const onExit = (code: number | null) => { exitCode = code; };
    child.once("exit", onExit);
    try {
      await super.stopServer(serverId);
      const deadline = Date.now() + this.stopTimeout;
      while (Date.now() < deadline) {
        if (exitCode !== null && exitCode !== undefined) {
          if (exitCode !== 0) throw new Error("MANAGED_STOP_EXIT_FAILED");
          if (this.free(await this.udp())) {
            this.boot.record(attempt, "STOPPED", { exitCode: 0, portsClosed: true, stoppedAt: new Date().toISOString() });
            this.stopping = false; return { message: "Managed Bedrock stopped cleanly; owned process exited and endpoints closed." };
          }
        }
        await new Promise(resolve => setTimeout(resolve, this.poll));
      }
      throw new Error("MANAGED_STOP_TIMEOUT");
    } finally { child.removeListener("exit", onExit); }
  }
}
