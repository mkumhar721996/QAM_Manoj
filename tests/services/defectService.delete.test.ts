import { test } from "node:test";
import assert from "node:assert/strict";
import { DefectService } from "../../src/services/defectService.ts";
import { DefectRepository } from "../../src/repositories/defectRepository.ts";
import { AuditLogRepository } from "../../src/repositories/auditLogRepository.ts";
import { AuditLogService } from "../../src/services/auditLogService.ts";
import { DefectClosedError } from "../../src/errors/defectErrors.ts";
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

const roles: Role[] = ["TESTER", "QA_LEAD", "ADMIN"];

for (const role of roles) {
  test(`rejects delete of a CLOSED defect for role ${role}`, () => {
    const { service, defectRepository } = makeService();
    const defect = makeDefect();
    defectRepository.save(defect);
    const user: User = { id: "user-1", role };

    assert.throws(() => service.deleteDefect(defect.id, user), DefectClosedError);
  });
}

test("CLOSED defect remains retrievable after a rejected delete attempt", () => {
  const { service, defectRepository } = makeService();
  const defect = makeDefect();
  defectRepository.save(defect);
  const user: User = { id: "user-1", role: "ADMIN" };

  assert.throws(() => service.deleteDefect(defect.id, user));

  const stored = defectRepository.findById(defect.id);
  assert.deepEqual(stored, defect);
});
