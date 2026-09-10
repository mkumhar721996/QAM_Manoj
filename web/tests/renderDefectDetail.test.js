import test from "node:test";
import assert from "node:assert/strict";
import { renderDefectDetail } from "../src/render/renderDefectDetail.js";

const defect = {
  id: "1",
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High",
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging",
  status: "Open",
};

test("AC4/AC7: renders every submitted field value", () => {
  const html = renderDefectDetail(defect);
  for (const value of [
    defect.title,
    defect.description,
    defect.severity,
    defect.reporter,
    defect.stepsToReproduce,
    defect.environment,
  ]) {
    assert.ok(html.includes(value), `expected rendered detail to include "${value}"`);
  }
});

test("AC8: renders the Open status", () => {
  const html = renderDefectDetail(defect);
  assert.ok(html.includes('id="defect-status"'));
  assert.ok(html.includes("Open"));
});
