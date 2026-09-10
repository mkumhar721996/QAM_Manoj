import test from "node:test";
import assert from "node:assert/strict";
import { createDefectFlow } from "../src/pages/createDefectFlow.js";

const validValues = {
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High",
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging",
};

test("AC5: a tester who fills in all mandatory fields is shown the newly created defect", async () => {
  const created = { id: "1", ...validValues, status: "Open" };
  const api = { createDefect: async (payload) => ({ ok: true, defect: { id: "1", ...payload, status: "Open" } }) };

  const result = await createDefectFlow(validValues, api);

  assert.equal(result.view, "detail");
  assert.deepEqual(result.defect, created);
});

test("AC1/AC2: a tester who omits mandatory fields stays on the form with errors and nothing is created", async () => {
  const api = {
    createDefect: () => {
      throw new Error("createDefect should not have been called");
    },
  };

  const result = await createDefectFlow({}, api);

  assert.equal(result.view, "form");
  assert.ok(Object.keys(result.errors).length > 0);
});
