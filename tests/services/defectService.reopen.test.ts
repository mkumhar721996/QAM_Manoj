import { test } from "node:test";
import assert from "node:assert/strict";
import { DefectService } from "../../src/services/defectService.ts";
import { DefectRepository } from "../../src/repositories/defectRepository.ts";
import { AuditLogRepository } from "../../src/repositories/auditLogRepository.ts";
import { AuditLogService } from "../../src/services/auditLogService.ts";
import { ForbiddenReopenError } from "../../src/errors/defectErrors.ts";
import type { Defect } from "../../src/models/defect.ts";
import type { Role, User } from "../../src/models/user.ts";

function makeDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "defect-1",
    title: "Original title",
    description: "Original description",
    severity: "LOW",
    stepsToReproduce: "Original steps",
    environment: "Original environment",
    reporter: "reporter-1",
    status: "CLOSED",
    ...overrides,
  };
}

function makeService() {
  const defectRepository = new DefectRepository();
  const auditLogRepository = new AuditLogRepository();
  const auditLogService = new AuditLogService(auditLogRepository);
  const service = new DefectService(defectRepository, auditLogService);
  return { service, defectRepository, auditLogRepository };
}

const allowedRoles: Role[] = ["QA_LEAD", "ADMIN"];

for (const role of allowedRoles) {
  test(`${role} can reopen a CLOSED defect, changing status to a non-closed state`, () => {
    const { service, defectRepository } = makeService();
    const defect = makeDefect();
    defectRepository.save(defect);
    const user: User = { id: "user-1", role };

    const result = service.reopenDefect(defect.id, user);

    assert.notEqual(result.status, "CLOSED");
    assert.equal(result.status, "REOPENED");
    const stored = defectRepository.findById(defect.id);
    assert.equal(stored?.status, "REOPENED");
  });
}

test("tester attempting to reopen a CLOSED defect is rejected", () => {
  const { service, defectRepository } = makeService();
  const defect = makeDefect();
  defectRepository.save(defect);
  const tester: User = { id: "tester-1", role: "TESTER" };

  assert.throws(() => service.reopenDefect(defect.id, tester), ForbiddenReopenError);

  const stored = defectRepository.findById(defect.id);
  assert.equal(stored?.status, "CLOSED");
});
