export type NotificationType = "refund_issued" | "capture_failed";
export type DeliveryStatus = "sent" | "permanently_failed";

export interface RefundIssuedEvent {
  transactionId: string;
  customerId: string;
  refundAmount: number;
  currency: string;
  originalPaymentMethod: string;
}

export interface CaptureFailureAttemptEvent {
  transactionId: string;
  customerId: string;
  attemptNumber: number;
  maxAttempts: number;
}

export interface DeliveryLogEntry {
  id: string;
  notificationType: NotificationType;
  transactionId: string;
  recipientEmail: string;
  status: DeliveryStatus;
  timestamp: number;
}
