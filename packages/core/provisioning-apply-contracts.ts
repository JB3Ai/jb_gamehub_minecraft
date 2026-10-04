import { createHash } from "node:crypto";
import { canonicalProvisioningJson, type ProvisioningJson, type ProvisioningResult, type ServerProvisioningPlan } from "./provisioning";

export interface ProvisioningApplyRequest { plan: ServerProvisioningPlan; approved: true; digest: string }
export interface ProvisioningApplyError { code: string; message: string; resourceKey?: string; ownerOperationId?: string; stepId?: string }
export class ProvisioningApplyException extends Error {
  constructor(readonly detail: ProvisioningApplyError) { super(detail.message); }
}
/** Test-only crash boundary: leaves durable state untouched for lease-based recovery. */
export class ProvisioningInterrupted extends Error {}
export type ProvisioningStepKind = "CLAIM_SERVER_ID" | "CLAIM_MANAGED_PATH" | "CLAIM_ENDPOINT" | "CREATE_MANAGED_DIRECTORY" | "WRITE_CONFIGURATION" | "REGISTER_SERVER";
export interface ProvisioningApplyStep { id: string; kind: ProvisioningStepKind; resourceKey: string }
export interface ProvisioningClaim {
  resourceKey: string; operationId: string; planId: string; kind: ProvisioningStepKind;
  state: "active" | "released"; createdAt: string; updatedAt: string;
}
export interface ProvisioningJournalEntry {
  sequence: number; operationId: string; planId: string; step: string;
  status: "started" | "completed" | "failed" | "compensating" | "compensated" | "compensation_failed";
  timestamp: string; error?: ProvisioningApplyError;
}
export interface ProvisioningEffect { operationId: string; step: ProvisioningApplyStep; value: ProvisioningJson }
export interface ProvisioningApplyOperation {
  operationId: string; plan: ServerProvisioningPlan; digest: string; actor: string;
  steps: ProvisioningApplyStep[]; result: ProvisioningResult;
  error?: ProvisioningApplyError; rollbackErrors: ProvisioningApplyError[];
  createdAt: string; updatedAt: string;
  lease: { owner: string; token: number; expiresAt: string };
}
export interface ProvisioningSimulationExecutor {
  readonly executionMode: "simulation";
  execute(step: ProvisioningApplyStep, plan: ServerProvisioningPlan): Promise<ProvisioningJson>;
  compensate(effect: ProvisioningEffect): Promise<void>;
  afterStep?(step: ProvisioningApplyStep): Promise<void>;
}
/** Atomic, synchronous repository operations; service code never opens SQL transactions. */
export interface ProvisioningApplyRepository {
  begin(operation: ProvisioningApplyOperation): { operation: ProvisioningApplyOperation; acquired: boolean };
  acquire(operationId: string, owner: string, now: string, expiresAt: string): ProvisioningApplyOperation;
  get(operationId: string): ProvisioningApplyOperation | undefined;
  listIncomplete(): ProvisioningApplyOperation[];
  claims(operationId?: string): ProvisioningClaim[];
  journal(operationId: string): ProvisioningJournalEntry[];
  effects(operationId: string): ProvisioningEffect[];
  startStep(operation: ProvisioningApplyOperation, step: ProvisioningApplyStep, now: string, expiresAt: string): boolean;
  completeStep(operation: ProvisioningApplyOperation, step: ProvisioningApplyStep, value: ProvisioningJson, now: string): void;
  transition(operation: ProvisioningApplyOperation, state: ProvisioningResult["state"], now: string, error?: ProvisioningApplyError, rollbackErrors?: ProvisioningApplyError[]): ProvisioningApplyOperation;
  compensate(operation: ProvisioningApplyOperation, effect: ProvisioningEffect, status: "compensating" | "compensated" | "compensation_failed", now: string, error?: ProvisioningApplyError): void;
  finishRollback(operation: ProvisioningApplyOperation, now: string, errors: ProvisioningApplyError[]): ProvisioningApplyOperation;
}
export const provisioningDigest = (plan: ServerProvisioningPlan): string => createHash("sha256").update(canonicalProvisioningJson({ ...plan, createdAt: "" })).digest("hex");
export const terminalProvisioningState = (state: ProvisioningResult["state"]) => ["PROVISIONED", "ROLLED_BACK", "PARTIALLY_ROLLED_BACK"].includes(state);
