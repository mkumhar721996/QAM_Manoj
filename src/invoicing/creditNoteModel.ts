export interface RefundEventInput {
  invoiceNumber: string;
  transactionId: string;
  refundAmount: number;
  transactionDate: string;
}

export interface CreditNote extends RefundEventInput {
  id: string;
  createdAt: number;
}

export interface CancellationDisbursementInput {
  cancellationEventId: string;
  invoiceNumber: string;
  providerId: string;
  amount: number;
}

export interface DisbursementRecord extends CancellationDisbursementInput {
  id: string;
  createdAt: number;
}
