import { AuditLogRepository } from "../repositories/auditLogRepository.ts";
import type { AuditActionType, AuditLogEntry } from "../models/auditLogEntry.ts";

export class AuditLogService {
  private readonly repository: AuditLogRepository;

  constructor(repository: AuditLogRepository) {
    this.repository = repository;
  }

  record(userId: string, actionType: AuditActionType, defectId: string): void {
    const entry: AuditLogEntry = {
      userId,
      timestamp: new Date(),
      actionType,
      defectId,
    };
    this.repository.save(entry);
  }

  findByDefectId(defectId: string): AuditLogEntry[] {
    return this.repository.findByDefectId(defectId);
  }
}
