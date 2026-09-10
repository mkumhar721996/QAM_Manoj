import test from "node:test";
import assert from "node:assert/strict";
import { validateDefectInput } from "../src/validation/defectValidation.ts";

const validInput = {
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High",
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging",
};

test("accepts a fully populated, valid defect input", () => {
  const result = validateDefectInput(validInput);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
});

test("reports an error for every missing mandatory field when all are omitted", () => {
  const result = validateDefectInput({});
  assert.equal(result.valid, false);
  for (const field of [
    "title",
    "description",
    "severity",
    "reporter",
    "stepsToReproduce",
    "environment",
  ]) {
    assert.ok(
      typeof result.errors[field] === "string" && result.errors[field].length > 0,
      `expected an error message for missing field "${field}"`,
    );
  }
  assert.equal(Object.keys(result.errors).length, 6);
});

test("reports an error for a field left as an empty/whitespace string", () => {
  const result = validateDefectInput({ ...validInput, title: "   " });
  assert.equal(result.valid, false);
  assert.ok(result.errors.title);
});

test("rejects a severity value outside the predefined list", () => {
  const result = validateDefectInput({ ...validInput, severity: "Extreme" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.severity);
});

test("rejects an environment value outside the predefined list", () => {
  const result = validateDefectInput({ ...validInput, environment: "Local" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.environment);
});
