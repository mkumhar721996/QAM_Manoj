export type PaymentAuditOutcome = "success" | "failure";

export interface PaymentAuditLogEntry {
  bookingId: string;
  actorId: string;
  attempt: number;
  outcome: PaymentAuditOutcome;
  timestamp: number;
}

export class PaymentAuditLogRepository {
  private entriesByBookingId: Map<string, PaymentAuditLogEntry[]> = new Map();

  record(entry: PaymentAuditLogEntry): void {
    const entries = this.entriesByBookingId.get(entry.bookingId) ?? [];
    entries.push(entry);
    this.entriesByBookingId.set(entry.bookingId, entries);
  }

  findByBookingId(bookingId: string): PaymentAuditLogEntry[] {
    return this.entriesByBookingId.get(bookingId) ?? [];
  }
}
