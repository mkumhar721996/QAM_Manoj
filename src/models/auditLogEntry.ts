export type AuditActionType = "EDIT_REJECTED" | "DELETE_REJECTED";

export interface AuditLogEntry {
  userId: string;
  timestamp: Date;
  actionType: AuditActionType;
  defectId: string;
}
