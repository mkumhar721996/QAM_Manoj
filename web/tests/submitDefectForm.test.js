import test from "node:test";
import assert from "node:assert/strict";
import { submitDefectForm } from "../src/controllers/submitDefectForm.js";
import { MANDATORY_FIELDS } from "../src/validation/validateDefectForm.js";

const validValues = {
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High",
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging",
};

function apiThatMustNotBeCalled() {
  return {
    createDefect: () => {
      throw new Error("createDefect should not have been called");
    },
  };
}

test("AC1: does not call the API to create a defect when mandatory fields are missing", async () => {
  const result = await submitDefectForm({}, apiThatMustNotBeCalled());
  assert.equal(result.submitted, false);
});

test("AC2: surfaces a validation error identifying every missing mandatory field", async () => {
  const result = await submitDefectForm({}, apiThatMustNotBeCalled());
  for (const field of MANDATORY_FIELDS) {
    assert.ok(result.errors[field], `expected an error for field "${field}"`);
  }
});

test("AC3/AC5: calls the API and reports the created defect when all mandatory fields are present", async () => {
  const created = { id: "1", ...validValues, status: "Open" };
  const api = { createDefect: async (payload) => ({ ok: true, defect: { id: "1", ...payload, status: "Open" }, payload }) };

  const result = await submitDefectForm(validValues, api);

  assert.equal(result.submitted, true);
  assert.deepEqual(result.defect, created);
});

test("surfaces server-side validation errors returned by the API without submitting successfully", async () => {
  const api = { createDefect: async () => ({ ok: false, errors: { severity: "severity must be one of: Low, Medium, High, Critical" } }) };

  const result = await submitDefectForm(validValues, api);

  assert.equal(result.submitted, false);
  assert.ok(result.errors.severity);
});

test("surfaces a form-level error instead of throwing when the API call rejects", async () => {
  const api = { createDefect: async () => { throw new Error("network failure"); } };

  const result = await submitDefectForm(validValues, api);

  assert.equal(result.submitted, false);
  assert.ok(result.errors.form);
});
