import { LifecycleRequestError } from "./apiClient";
import { serverIdentity, type ServerKey, type ServerCommand } from "./homeModel";
import type { OperationRecord, OperationRef, ServerStatusResponse } from "./types";
import { safeOperationReference, type CommandJournal, type CommandRecovery } from "./commandJournal";

export interface LifecycleDependencies {
  allowed: (key: ServerKey, command: ServerCommand) => boolean;
  request: (key: ServerKey, command: ServerCommand) => Promise<OperationRef>;
  operation: (id: string) => Promise<OperationRecord>;
  status: (key: ServerKey) => Promise<ServerStatusResponse>;
  changed: (pending: Record<string, ServerCommand>, errors: Record<string, string>, recoveries?: Record<string, CommandRecovery>, blocked?: boolean) => void;
  observed: (key: ServerKey, status: ServerStatusResponse) => void;
  operationObserved: (operation: OperationRecord) => void;
  journal?: CommandJournal;
  now?: () => number;
}

/** One POST per explicit action; recovery only reads. Stored uncertainty is never discarded. */
export class LifecycleCommands {
  private records = new Map<string, CommandRecovery>();
  private errors: Record<string, string> = {};
  private checking = new Set<string>();
  private storageBlocked = false;
  private unreadable = false;
  private active = true;
  private epoch = 0;
  constructor(private deps: LifecycleDependencies) {
    try {
      for (const record of deps.journal?.read() || []) {
        this.records.set(serverIdentity(record.key), { ...record, ...(record.locked ? { phase: "unknown" as const } : {}) });
        if (record.locked) this.errors[serverIdentity(record.key)] = "A saved command needs its outcome checked. It will not be sent again.";
      }
    } catch { this.unreadable = true; this.storageBlocked = true; }
  }
  restore(): void { this.active = true; this.publish(); }
  dispose(): void { this.active = false; this.epoch++; }
  private publish(): void {
    if (!this.active) return;
    if (!this.unreadable) {
      try { this.deps.journal?.write([...this.records.values()]); this.storageBlocked = false; }
      catch { this.storageBlocked = true; }
    }
    const errors = { ...this.errors };
    if (this.storageBlocked) errors.journal = "Command recovery storage is unavailable. Lifecycle actions are blocked so an uncertain command cannot be lost.";
    this.deps.changed(Object.fromEntries([...this.records].filter(([, r]) => r.locked).map(([id, r]) => [id, r.command])), errors, Object.fromEntries(this.records), this.storageBlocked);
  }
  async submit(key: ServerKey, command: ServerCommand): Promise<void> {
    const id = serverIdentity(key);
    if (!this.active || this.storageBlocked || this.records.get(id)?.locked || !this.deps.allowed(key, command)) return;
    if (!this.records.has(id) && this.records.size >= 32) {
      const closed = [...this.records].find(([, r]) => !r.locked);
      if (!closed) return;
      this.records.delete(closed[0]);
    }
    const epoch = this.epoch, now = this.deps.now?.() ?? Date.now();
    const record: CommandRecovery = { key: { ...key }, command, attemptId: `attempt_${now.toString(36)}_${Math.random().toString(36).slice(2, 12)}`, submittedAt: new Date(now).toISOString(), phase: "submitting", locked: true };
    this.records.set(id, record); delete this.errors[id]; this.publish();
    if (this.storageBlocked) return;
    try {
      const ref = await this.deps.request(key, command);
      if (!this.active || epoch !== this.epoch) return;
      if (!safeOperationReference(ref.operationId)) throw new Error("Invalid operation reference");
      record.operationId = ref.operationId; record.phase = "pending"; this.publish();
      await this.check(id, record);
    } catch (error) {
      if (!this.active || epoch !== this.epoch) return;
      record.phase = "unknown";
      if (error instanceof LifecycleRequestError && error.rejected) {
        record.rejected = true;
        this.errors[id] = "The command was rejected. Rechecking the server before another action.";
        this.publish(); await this.check(id, record);
      } else {
        this.errors[id] = "Command outcome is unconfirmed. Keep the saved reference and review Activity; it will not be sent again.";
        this.publish();
      }
    }
  }
  async refresh(): Promise<void> { await Promise.all([...this.records].filter(([, r]) => r.locked && (r.operationId || r.rejected)).map(([id, r]) => this.check(id, r))); }
  async recheck(key: ServerKey): Promise<void> {
    const id = serverIdentity(key), record = this.records.get(id);
    if (record) await this.check(id, record);
  }
  async associate(key: ServerKey, operationId: string, reviewed: boolean): Promise<void> {
    const id = serverIdentity(key), record = this.records.get(id), epoch = this.epoch;
    if (!this.active || !reviewed || !record?.locked || record.operationId || record.rejected || !safeOperationReference(operationId)) return;
    try {
      const operation = await this.deps.operation(operationId);
      if (!this.active || epoch !== this.epoch) return;
      const delta = Date.parse(operation.createdAt) - Date.parse(record.submittedAt);
      if (!this.matches(operation, record) || operation.operationId !== operationId || !Number.isFinite(delta) || delta < -5000 || delta > 120000 || [...this.records.values()].some(r => r !== record && r.operationId === operationId)) throw new Error("Unrelated reference");
      record.operationId = operationId; record.phase = "pending"; this.publish();
      await this.check(id, record);
    } catch {
      if (this.active && epoch === this.epoch) { this.errors[id] = "That reference could not be verified for this command. Actions remain locked; ask an administrator to review Activity."; this.publish(); }
    }
  }
  private matches(operation: OperationRecord, record: CommandRecovery): boolean {
    return operation.providerId === record.key.providerId && operation.serverId === record.key.serverId && operation.type === `server.${record.command}` && ["queued", "running", "completed", "failed", "cancelled"].includes(operation.status);
  }
  private async check(id: string, record: CommandRecovery): Promise<void> {
    if (!this.active || !record.locked || this.checking.has(id) || !record.operationId && !record.rejected) return;
    this.checking.add(id); const epoch = this.epoch;
    try {
      const operation = record.operationId ? await this.deps.operation(record.operationId) : undefined;
      if (!this.active || epoch !== this.epoch) return;
      if (operation && (!this.matches(operation, record) || operation.operationId !== record.operationId)) throw new Error("Mismatched operation");
      if (operation) this.deps.operationObserved(operation);
      const status = await this.deps.status(record.key);
      if (!this.active || epoch !== this.epoch) return;
      if (!["offline", "online", "starting", "stopping", "error"].includes(status.status)) throw new Error("Invalid status");
      this.deps.observed(record.key, status);
      const terminal = record.rejected || operation && ["completed", "failed", "cancelled"].includes(operation.status);
      if (terminal && ["offline", "online"].includes(status.status)) {
        record.locked = false;
        const successful = operation?.status === "completed" && status.status === (record.command === "stop" ? "offline" : "online");
        record.phase = successful ? "reconciled" : "failed";
        if (successful) delete this.errors[id];
        else this.errors[id] = record.rejected ? "The command was rejected. Server status has been rechecked; review access and settings before another action." : `The server could not ${record.command} as requested. Status has been rechecked; choose a new action only when ready.`;
      } else if (terminal) {
        record.phase = "unknown"; this.errors[id] = "The operation has ended, but current server state is unconfirmed. Actions remain locked.";
      } else { record.phase = "pending"; delete this.errors[id]; }
      this.publish();
    } catch {
      if (this.active && epoch === this.epoch) { record.phase = "unknown"; this.errors[id] = "Waiting to confirm the server command. Check the connection; it will not be sent again."; this.publish(); }
    } finally { this.checking.delete(id); }
  }
}
