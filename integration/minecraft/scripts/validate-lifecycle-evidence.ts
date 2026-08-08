import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export interface LifecycleEvidenceValidationResult {
  valid: boolean;
  failures: string[];
}

type EvidenceEvent = {
  type?: unknown;
  timestamp?: unknown;
  providerId?: unknown;
  operationId?: unknown;
  status?: unknown;
};

type EvidenceDocument = {
  providerId?: unknown;
  startOperationId?: unknown;
  stopOperationId?: unknown;
  timeline?: unknown;
  statusChecks?: {
    beforeStart?: unknown;
    afterStart?: unknown;
    afterStop?: unknown;
  };
};

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const iso8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!iso8601.test(value)) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function ensureString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function indexOfEvent(
  timeline: EvidenceEvent[],
  startIndex: number,
  predicate: (event: EvidenceEvent) => boolean,
): number {
  for (let i = startIndex; i < timeline.length; i += 1) {
    if (predicate(timeline[i])) {
      return i;
    }
  }
  return -1;
}

function firstIndexByOperation(timeline: EvidenceEvent[], type: string, operationId: string): number {
  return indexOfEvent(timeline, 0, (event) => event.type === type && event.operationId === operationId);
}

function pushFailure(failures: string[], reason: string): void {
  failures.push(reason);
}

export function validateLifecycleEvidenceDocument(raw: unknown): LifecycleEvidenceValidationResult {
  const failures: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, failures: ["Evidence file must be a JSON object."] };
  }

  const doc = raw as EvidenceDocument;
  const providerId = ensureString(doc.providerId);
  const startOperationId = ensureString(doc.startOperationId);
  const stopOperationId = ensureString(doc.stopOperationId);

  if (!providerId) {
    pushFailure(failures, "Missing provider ID: providerId must be a non-empty string.");
  }

  if (!startOperationId || !stopOperationId) {
    pushFailure(
      failures,
      "Missing operation ID: startOperationId and stopOperationId must be non-empty strings.",
    );
  }

  if (!Array.isArray(doc.timeline)) {
    pushFailure(failures, "Incomplete lifecycle: timeline must be an array.");
    return { valid: false, failures };
  }

  const timeline = doc.timeline as EvidenceEvent[];
  if (timeline.length === 0) {
    pushFailure(failures, "Incomplete lifecycle: timeline is empty.");
    return { valid: false, failures };
  }

  timeline.forEach((event, index) => {
    if (!isIsoTimestamp(event.timestamp)) {
      pushFailure(
        failures,
        `Malformed timestamp: timeline[${index}] has invalid timestamp ${JSON.stringify(event.timestamp)}.`,
      );
    }

    if (!ensureString(event.providerId)) {
      pushFailure(failures, `Missing provider ID: timeline[${index}] is missing providerId.`);
    }
  });

  if (!startOperationId || !stopOperationId || !providerId) {
    return { valid: false, failures };
  }

  const startCreatedIndex = firstIndexByOperation(timeline, "operation.created", startOperationId);
  const startStartedIndex = firstIndexByOperation(timeline, "operation.started", startOperationId);
  const startCompletedIndex = firstIndexByOperation(timeline, "operation.completed", startOperationId);

  if (startCreatedIndex === -1) {
    pushFailure(failures, `Missing event: operation.created for start operation ${startOperationId}.`);
  }
  if (startStartedIndex === -1) {
    pushFailure(failures, `Missing event: operation.started for start operation ${startOperationId}.`);
  }
  if (startCompletedIndex === -1) {
    pushFailure(failures, `Missing event: operation.completed for start operation ${startOperationId}.`);
  }

  if (startCreatedIndex !== -1 && startStartedIndex !== -1 && startCreatedIndex > startStartedIndex) {
    pushFailure(failures, "Incorrect event ordering: start operation.created appears after operation.started.");
  }
  if (startCreatedIndex !== -1 && startCompletedIndex !== -1 && startCreatedIndex > startCompletedIndex) {
    pushFailure(failures, "Incorrect event ordering: start operation.created appears after operation.completed.");
  }
  if (startStartedIndex !== -1 && startCompletedIndex !== -1 && startStartedIndex > startCompletedIndex) {
    pushFailure(failures, "Incorrect event ordering: start operation.started appears after operation.completed.");
  }

  const onlineIndex = indexOfEvent(
    timeline,
    Math.max(0, startCompletedIndex + 1),
    (event) => event.type === "server.status.changed" && event.status === "online",
  );
  if (onlineIndex === -1) {
    pushFailure(failures, "Invalid status: missing server.status.changed event with status=online after start lifecycle.");
  }

  const validationIndex = indexOfEvent(
    timeline,
    Math.max(0, onlineIndex + 1),
    (event) => event.type === "world.validation.completed",
  );
  if (validationIndex === -1) {
    pushFailure(failures, "Missing event: world.validation.completed after online transition.");
  }

  const stopCreatedIndex = firstIndexByOperation(timeline, "operation.created", stopOperationId);
  const stopStartedIndex = firstIndexByOperation(timeline, "operation.started", stopOperationId);
  const stopCompletedIndex = firstIndexByOperation(timeline, "operation.completed", stopOperationId);

  if (stopCreatedIndex === -1) {
    pushFailure(failures, `Missing event: operation.created for stop operation ${stopOperationId}.`);
  }
  if (stopStartedIndex === -1) {
    pushFailure(failures, `Missing event: operation.started for stop operation ${stopOperationId}.`);
  }
  if (stopCompletedIndex === -1) {
    pushFailure(failures, `Missing event: operation.completed for stop operation ${stopOperationId}.`);
  }

  if (stopCreatedIndex !== -1 && stopStartedIndex !== -1 && stopCreatedIndex > stopStartedIndex) {
    pushFailure(failures, "Incorrect event ordering: stop operation.created appears after operation.started.");
  }
  if (stopCreatedIndex !== -1 && stopCompletedIndex !== -1 && stopCreatedIndex > stopCompletedIndex) {
    pushFailure(failures, "Incorrect event ordering: stop operation.created appears after operation.completed.");
  }
  if (stopStartedIndex !== -1 && stopCompletedIndex !== -1 && stopStartedIndex > stopCompletedIndex) {
    pushFailure(failures, "Incorrect event ordering: stop operation.started appears after operation.completed.");
  }

  const offlineIndex = indexOfEvent(
    timeline,
    Math.max(0, stopCompletedIndex + 1),
    (event) => event.type === "server.status.changed" && event.status === "offline",
  );
  if (offlineIndex === -1) {
    pushFailure(failures, "Invalid status: missing server.status.changed event with status=offline after stop lifecycle.");
  }

  const statusSequence = timeline
    .filter((event) => event.type === "server.status.changed")
    .map((event) => event.status)
    .filter((status): status is string => typeof status === "string");

  const firstOffline = statusSequence.indexOf("offline");
  const firstOnline = statusSequence.indexOf("online");
  const secondOffline = firstOnline === -1 ? -1 : statusSequence.indexOf("offline", firstOnline + 1);

  if (!(firstOffline !== -1 && firstOnline !== -1 && secondOffline !== -1 && firstOffline < firstOnline && firstOnline < secondOffline)) {
    pushFailure(failures, "Incomplete lifecycle: overall status sequence must include offline -> online -> offline.");
  }

  if (doc.statusChecks) {
    const beforeStart = ensureString(doc.statusChecks.beforeStart);
    const afterStart = ensureString(doc.statusChecks.afterStart);
    const afterStop = ensureString(doc.statusChecks.afterStop);

    if (beforeStart && beforeStart !== "offline") {
      pushFailure(failures, `Invalid status: statusChecks.beforeStart must be offline (received ${beforeStart}).`);
    }
    if (afterStart && afterStart !== "online") {
      pushFailure(failures, `Invalid status: statusChecks.afterStart must be online (received ${afterStart}).`);
    }
    if (afterStop && afterStop !== "offline") {
      pushFailure(failures, `Invalid status: statusChecks.afterStop must be offline (received ${afterStop}).`);
    }
  }

  return {
    valid: failures.length === 0,
    failures,
  };
}

export async function validateLifecycleEvidenceFile(evidencePath: string): Promise<LifecycleEvidenceValidationResult> {
  const content = await fs.readFile(evidencePath, "utf8");
  try {
    const parsed = JSON.parse(content) as unknown;
    return validateLifecycleEvidenceDocument(parsed);
  } catch {
    return {
      valid: false,
      failures: ["Evidence file is not valid JSON."],
    };
  }
}

async function main(): Promise<void> {
  const evidencePath = process.argv[2];
  if (!evidencePath) {
    console.error("Usage: npm run validate:lifecycle:evidence -- <path-to-evidence.json>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await validateLifecycleEvidenceFile(evidencePath);
    if (result.valid) {
      console.log(`VALID lifecycle evidence: ${evidencePath}`);
      process.exitCode = 0;
      return;
    }

    console.error(`INVALID lifecycle evidence: ${evidencePath}`);
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedFilePath === currentFilePath) {
  void main();
}
