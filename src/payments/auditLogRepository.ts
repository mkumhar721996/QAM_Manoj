import type { ReversalAction } from "./paymentsModel.ts";

export interface AuditLogEntry {
  timestamp: number;
  actorId: string;
  chargebackAmount: number;
  action: ReversalAction;
}

export class AuditLogRepository {
  private entries: AuditLogEntry[] = [];

  record(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }

  findAll(): AuditLogEntry[] {
    return this.entries;
  }
}
