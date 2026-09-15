export type DisbursementStatus = "dispute_window" | "retry_pending" | "disbursed" | "failed_manual_intervention";

export interface Disbursement {
  bookingId: string;
  providerId: string;
  totalAmount: number;
  status: DisbursementStatus;
  disburseAt: number;
  disputeRaised: boolean;
  retryCount: number;
  nextRetryAt?: number;
  disbursedAt?: number;
  serviceFeeAmount?: number;
  netAmount?: number;
}

export interface DisbursementAttempt {
  bookingId: string;
  timestamp: number;
  actor: string;
  retryCount: number;
  outcome: "success" | "failure";
  reason?: string;
}

export interface Notification {
  timestamp: number;
  recipient: "admin" | "provider";
  bookingId: string;
  message: string;
}

export interface RecoveryTask {
  bookingId: string;
  providerId: string;
  createdAt: number;
  reason: string;
}
