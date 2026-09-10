import { test } from "node:test";
import assert from "node:assert/strict";
import { DefectController } from "../../src/api/defectController.ts";
import { DefectService } from "../../src/services/defectService.ts";
import { DefectRepository } from "../../src/repositories/defectRepository.ts";
import { AuditLogRepository } from "../../src/repositories/auditLogRepository.ts";
import { AuditLogService } from "../../src/services/auditLogService.ts";
import type { Defect } from "../../src/models/defect.ts";
import type { User } from "../../src/models/user.ts";

function makeDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "defect-1",
    title: "Original title",
    description: "Original description",
    severity: "LOW",
    stepsToReproduce: "Original steps",
    environment: "Original environment",
    reporter: "reporter-1",
    status: "OPEN",
    ...overrides,
  };
}

function makeController() {
  const defectRepository = new DefectRepository();
  const auditLogRepository = new AuditLogRepository();
  const auditLogService = new AuditLogService(auditLogRepository);
  const service = new DefectService(defectRepository, auditLogService);
  const controller = new DefectController(service);
  return { controller, defectRepository };
}

test("GET a CLOSED defect returns editable:false and omits edit/delete action links", () => {
  const { controller, defectRepository } = makeController();
  const defect = makeDefect({ status: "CLOSED" });
  defectRepository.save(defect);

  const response = controller.getDefect(defect.id);

  assert.equal(response.status, 200);
  const body = response.body as any;
  assert.equal(body.editable, false);
  assert.deepEqual(body.links, []);
});

test("GET an OPEN defect returns editable:true and includes edit/delete action links", () => {
  const { controller, defectRepository } = makeController();
  const defect = makeDefect({ status: "OPEN" });
  defectRepository.save(defect);

  const response = controller.getDefect(defect.id);

  assert.equal(response.status, 200);
  const body = response.body as any;
  assert.equal(body.editable, true);
  const rels = body.links.map((link: { rel: string }) => link.rel);
  assert.ok(rels.includes("edit"));
  assert.ok(rels.includes("delete"));
});

test("PATCH on a CLOSED defect returns 409 via the API layer", () => {
  const { controller, defectRepository } = makeController();
  const defect = makeDefect({ status: "CLOSED" });
  defectRepository.save(defect);
  const user: User = { id: "user-1", role: "ADMIN" };

  const response = controller.updateDefect(defect.id, { title: "New" }, user);

  assert.equal(response.status, 409);
});

test("DELETE on a CLOSED defect returns 409 via the API layer", () => {
  const { controller, defectRepository } = makeController();
  const defect = makeDefect({ status: "CLOSED" });
  defectRepository.save(defect);
  const user: User = { id: "user-1", role: "ADMIN" };

  const response = controller.deleteDefect(defect.id, user);

  assert.equal(response.status, 409);
});

test("reopen by a tester returns 403 via the API layer", () => {
  const { controller, defectRepository } = makeController();
  const defect = makeDefect({ status: "CLOSED" });
  defectRepository.save(defect);
  const user: User = { id: "user-1", role: "TESTER" };

  const response = controller.reopenDefect(defect.id, user);

  assert.equal(response.status, 403);
});
