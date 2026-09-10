import type { AuditLogEntry } from "../models/auditLogEntry.ts";

export class AuditLogRepository {
  private readonly entries: AuditLogEntry[] = [];

  save(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }

  findByDefectId(defectId: string): AuditLogEntry[] {
    return this.entries.filter((entry) => entry.defectId === defectId);
  }
}
