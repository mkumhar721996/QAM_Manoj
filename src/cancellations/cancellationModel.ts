export type CancellationOutcome = "full_refund" | "partial_refund";

export interface CancellationEvent {
  bookingId: string;
  actorId: string;
  outcome: CancellationOutcome;
  paymentIntentId: string;
  providerId?: string;
  refundAmountCents: number;
  nonRefundableAmountCents: number;
  serviceFeeCents: number;
}

export interface CancellationLogEntry {
  id: string;
  bookingId: string;
  actorId: string;
  refundAmountCents: number;
  nonRefundableAmountCents: number;
  timestamp: number;
}
