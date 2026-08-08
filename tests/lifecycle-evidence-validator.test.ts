import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { validateLifecycleEvidenceFile } from "../integration/minecraft/scripts/validate-lifecycle-evidence";

const fixture = (name: string) => path.resolve(process.cwd(), "tests/fixtures/lifecycle-evidence", name);

test("valid evidence fixture passes", async () => {
  const result = await validateLifecycleEvidenceFile(fixture("valid-evidence.json"));
  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
});

test("baseline JBGH-012 evidence passes", async () => {
  const baselinePath = path.resolve(
    process.cwd(),
    "integration/minecraft/evidence/JBGH-012-lifecycle-2026-08-08T08-08-13-731Z.json",
  );
  const result = await validateLifecycleEvidenceFile(baselinePath);
  assert.equal(result.valid, true);
});

test("missing start event fails", async () => {
  const result = await validateLifecycleEvidenceFile(fixture("missing-start-event.json"));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.includes("operation.started for start operation")));
});

test("incorrect ordering fails", async () => {
  const result = await validateLifecycleEvidenceFile(fixture("incorrect-ordering.json"));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.includes("Incorrect event ordering")));
});

test("missing online transition fails", async () => {
  const result = await validateLifecycleEvidenceFile(fixture("missing-online-transition.json"));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.includes("status=online")));
});

test("missing validation event fails", async () => {
  const result = await validateLifecycleEvidenceFile(fixture("missing-validation-event.json"));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.includes("world.validation.completed")));
});

test("missing offline transition fails", async () => {
  const result = await validateLifecycleEvidenceFile(fixture("missing-offline-transition.json"));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.includes("status=offline")));
});
