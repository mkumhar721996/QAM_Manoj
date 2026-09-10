import test from "node:test";
import assert from "node:assert/strict";
import { renderDefectCreationForm } from "../src/render/renderDefectCreationForm.js";

const options = {
  severity: ["Low", "Medium", "High", "Critical"],
  environment: ["Staging", "Production", "QA", "Dev"],
};

function optionValues(html, selectId) {
  const selectMatch = new RegExp(`<select[^>]*id="${selectId}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(selectMatch, `expected a <select id="${selectId}"> in the rendered markup`);
  return [...selectMatch[1].matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
}

test("AC6: the severity select exposes only the predefined severity values", () => {
  const html = renderDefectCreationForm({ options, values: {}, errors: {} });
  assert.deepEqual(optionValues(html, "severity"), options.severity);
});

test("AC6: the environment select exposes only the predefined environment values", () => {
  const html = renderDefectCreationForm({ options, values: {}, errors: {} });
  assert.deepEqual(optionValues(html, "environment"), options.environment);
});

test("AC2: renders a distinct validation error message for each missing mandatory field", () => {
  const errors = {
    title: "Title is required",
    description: "Description is required",
    severity: "Severity is required",
    reporter: "Reporter is required",
    stepsToReproduce: "Steps to reproduce is required",
    environment: "Environment is required",
  };
  const html = renderDefectCreationForm({ options, values: {}, errors });

  for (const [field, message] of Object.entries(errors)) {
    assert.ok(
      html.includes(`id="${field}-error"`) && html.includes(message),
      `expected an error message for "${field}" to be rendered`,
    );
  }
});

test("renders the previously entered values back into the fields", () => {
  const html = renderDefectCreationForm({
    options,
    values: { title: "Login button unresponsive", reporter: "jane.doe" },
    errors: {},
  });

  assert.ok(html.includes("Login button unresponsive"));
  assert.ok(html.includes("jane.doe"));
});
