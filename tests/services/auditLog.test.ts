import { test } from "node:test";
import assert from "node:assert/strict";
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
    status: "CLOSED",
    ...overrides,
  };
}

function makeService() {
  const defectRepository = new DefectRepository();
  const auditLogRepository = new AuditLogRepository();
  const auditLogService = new AuditLogService(auditLogRepository);
  const service = new DefectService(defectRepository, auditLogService);
  return { service, defectRepository, auditLogService };
}

test("a rejected edit and a rejected delete on a CLOSED defect each record an audit entry with user, timestamp, action type, and defect id", () => {
  const { service, defectRepository, auditLogService } = makeService();
  const defect = makeDefect();
  defectRepository.save(defect);
  const user: User = { id: "user-1", role: "TESTER" };
  const before = new Date();

  assert.throws(() => service.updateDefect(defect.id, { title: "New" }, user));
  assert.throws(() => service.deleteDefect(defect.id, user));

  const entries = auditLogService.findByDefectId(defect.id);
  assert.equal(entries.length, 2);

  const editEntry = entries.find((entry) => entry.actionType === "EDIT_REJECTED");
  const deleteEntry = entries.find((entry) => entry.actionType === "DELETE_REJECTED");

  assert.ok(editEntry);
  assert.equal(editEntry?.userId, user.id);
  assert.equal(editEntry?.defectId, defect.id);
  assert.ok(editEntry!.timestamp instanceof Date);
  assert.ok(editEntry!.timestamp.getTime() >= before.getTime());

  assert.ok(deleteEntry);
  assert.equal(deleteEntry?.userId, user.id);
  assert.equal(deleteEntry?.defectId, defect.id);
  assert.ok(deleteEntry!.timestamp instanceof Date);
});
