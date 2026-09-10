import { test } from "node:test";
import assert from "node:assert/strict";
import { DefectService } from "../../src/services/defectService.ts";
import { DefectRepository } from "../../src/repositories/defectRepository.ts";
import { AuditLogRepository } from "../../src/repositories/auditLogRepository.ts";
import { AuditLogService } from "../../src/services/auditLogService.ts";
import { DefectClosedError } from "../../src/errors/defectErrors.ts";
import type { Defect, MutableDefectFields } from "../../src/models/defect.ts";
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
const fieldEdits: MutableDefectFields[] = [
  { title: "New title" },
  { description: "New description" },
  { severity: "HIGH" },
  { stepsToReproduce: "New steps" },
  { environment: "New environment" },
  { reporter: "reporter-2" },
];

for (const role of roles) {
  for (const edit of fieldEdits) {
    test(`rejects ${Object.keys(edit)[0]} edit on a CLOSED defect for role ${role}`, () => {
      const { service, defectRepository } = makeService();
      const defect = makeDefect();
      defectRepository.save(defect);
      const user: User = { id: "user-1", role };

      assert.throws(
        () => service.updateDefect(defect.id, edit, user),
        DefectClosedError
      );

      const stored = defectRepository.findById(defect.id);
      assert.deepEqual(stored, defect);
    });
  }
}

test("tester editing a CLOSED defect leaves all field values unchanged", () => {
  const { service, defectRepository } = makeService();
  const defect = makeDefect();
  defectRepository.save(defect);
  const snapshot = defectRepository.findById(defect.id);
  const tester: User = { id: "tester-1", role: "TESTER" };

  assert.throws(() =>
    service.updateDefect(
      defect.id,
      {
        title: "Hacked title",
        description: "Hacked description",
        severity: "CRITICAL",
        stepsToReproduce: "Hacked steps",
        environment: "Hacked environment",
        reporter: "hacker",
      },
      tester
    )
  );

  const stored = defectRepository.findById(defect.id);
  assert.deepEqual(stored, snapshot);
});

test("tester editing a non-CLOSED defect persists the new field value", () => {
  const { service, defectRepository } = makeService();
  const defect = makeDefect({ status: "OPEN" });
  defectRepository.save(defect);
  const tester: User = { id: "tester-1", role: "TESTER" };

  service.updateDefect(defect.id, { title: "Updated title" }, tester);

  const stored = defectRepository.findById(defect.id);
  assert.equal(stored?.title, "Updated title");
});
