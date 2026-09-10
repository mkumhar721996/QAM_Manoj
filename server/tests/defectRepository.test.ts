import test from "node:test";
import assert from "node:assert/strict";
import { DefectRepository } from "../src/repositories/defectRepository.ts";

const input = {
  title: "Login button unresponsive",
  description: "Clicking login does nothing",
  severity: "High" as const,
  reporter: "jane.doe",
  stepsToReproduce: "1. Open app 2. Click login",
  environment: "Staging" as const,
};

test("create() persists a defect with status Open and returns it with an id", () => {
  const repo = new DefectRepository();
  const created = repo.create(input, "jane.doe");

  assert.equal(created.status, "Open");
  assert.ok(created.id, "expected the created defect to have an id");
  assert.equal(created.title, input.title);
  assert.equal(created.description, input.description);
  assert.equal(created.severity, input.severity);
  assert.equal(created.reporter, input.reporter);
  assert.equal(created.stepsToReproduce, input.stepsToReproduce);
  assert.equal(created.environment, input.environment);
});

test("findById() returns the previously created defect", () => {
  const repo = new DefectRepository();
  const created = repo.create(input, "jane.doe");

  const found = repo.findById(created.id);

  assert.deepEqual(found, created);
});

test("findById() returns undefined for an unknown id", () => {
  const repo = new DefectRepository();
  assert.equal(repo.findById("does-not-exist"), undefined);
});
