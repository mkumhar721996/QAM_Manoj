import test from "node:test";
import assert from "node:assert/strict";
import { validateDefectForm, MANDATORY_FIELDS } from "../src/validation/validateDefectForm.js";

const validValues = {
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High",
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging",
};

test("returns valid with no errors when every mandatory field is filled in", () => {
  const result = validateDefectForm(validValues);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
});

test("returns an error message for every mandatory field when all are blank", () => {
  const blankValues = Object.fromEntries(MANDATORY_FIELDS.map((field) => [field, ""]));
  const result = validateDefectForm(blankValues);

  assert.equal(result.valid, false);
  for (const field of MANDATORY_FIELDS) {
    assert.ok(
      typeof result.errors[field] === "string" && result.errors[field].length > 0,
      `expected an error message for missing field "${field}"`,
    );
  }
  assert.equal(Object.keys(result.errors).length, MANDATORY_FIELDS.length);
});

test("returns an error only for the fields left blank", () => {
  const result = validateDefectForm({ ...validValues, title: "" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.title);
  assert.equal(Object.keys(result.errors).length, 1);
});
