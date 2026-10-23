import type { ServerCommand, ServerKey } from "./homeModel";

export type RecoveryPhase = "submitting" | "pending" | "unknown" | "failed" | "reconciled";
export interface CommandRecovery {
  key: ServerKey;
  command: ServerCommand;
  attemptId: string;
  submittedAt: string;
  operationId?: string;
  phase: RecoveryPhase;
  locked: boolean;
  rejected?: boolean;
}
export interface CommandJournal { read(): CommandRecovery[]; write(records: CommandRecovery[]): void }
export const COMMAND_JOURNAL_KEY = "jbgh.lifecycle.v1";
export const safeOperationReference = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
function parseRecord(value: unknown): CommandRecovery {
  const r = value as CommandRecovery;
  if (!r || typeof r !== "object" || !r.key || typeof r.key.providerId !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(r.key.providerId) || typeof r.key.serverId !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(r.key.serverId)
    || !["start", "stop", "restart"].includes(r.command) || !safeOperationReference(r.attemptId) || typeof r.submittedAt !== "string" || !Number.isFinite(Date.parse(r.submittedAt)) || r.operationId !== undefined && !safeOperationReference(r.operationId)
    || !["submitting", "pending", "unknown", "failed", "reconciled"].includes(r.phase) || typeof r.locked !== "boolean" || r.rejected !== undefined && typeof r.rejected !== "boolean"
    || ["submitting", "pending", "unknown"].includes(r.phase) !== r.locked || ["failed", "reconciled"].includes(r.phase) && r.locked) throw new Error("Recovery journal is invalid");
  return { key: { providerId: r.key.providerId, serverId: r.key.serverId }, command: r.command, attemptId: r.attemptId, submittedAt: r.submittedAt, ...(r.operationId ? { operationId: r.operationId } : {}), phase: r.phase, locked: r.locked, ...(r.rejected ? { rejected: true } : {}) };
}
/** Only command references are retained; credentials, diagnostics and player data never enter storage. */
export function sessionCommandJournal(storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.sessionStorage): CommandJournal {
  return {
    read() {
      const raw = storage().getItem(COMMAND_JOURNAL_KEY);
      if (!raw) return [];
      const value = JSON.parse(raw);
      if (value?.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.length > 32) throw new Error("Recovery journal is invalid");
      const records = value.records.map(parseRecord);
      if (new Set(records.map(r => JSON.stringify([r.key.providerId, r.key.serverId]))).size !== records.length) throw new Error("Duplicate recovery identity");
      return records;
    },
    write(records) {
      if (records.length > 32) throw new Error("Recovery journal is full");
      storage().setItem(COMMAND_JOURNAL_KEY, JSON.stringify({ schemaVersion: 1, records: records.map(parseRecord) }));
    },
  };
}
