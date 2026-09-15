import type { Disbursement, DisbursementAttempt } from "./disbursementModel.ts";

export class DisbursementRepository {
  private disbursementsByBookingId: Map<string, Disbursement> = new Map();
  private attempts: DisbursementAttempt[] = [];

  create(disbursement: Disbursement): void {
    this.disbursementsByBookingId.set(disbursement.bookingId, disbursement);
  }

  findByBookingId(bookingId: string): Disbursement | undefined {
    return this.disbursementsByBookingId.get(bookingId);
  }

  listDue(now: number): Disbursement[] {
    return [...this.disbursementsByBookingId.values()].filter((d) => {
      if (d.disputeRaised) return false;
      if (d.status === "dispute_window") return d.disburseAt <= now;
      if (d.status === "retry_pending") return d.nextRetryAt !== undefined && d.nextRetryAt <= now;
      return false;
    });
  }

  addAttempt(attempt: DisbursementAttempt): void {
    this.attempts.push(attempt);
  }

  getAttempts(bookingId: string): DisbursementAttempt[] {
    return this.attempts.filter((a) => a.bookingId === bookingId);
  }
}
