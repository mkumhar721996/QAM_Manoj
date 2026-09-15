export interface LineItem {
  description: string;
  amount: number;
}

export interface PaymentCaptureEvent {
  paymentCaptureId: string;
  customerId: string;
  providerId: string;
  lineItems: LineItem[];
  serviceFee: number;
}

export interface DisbursementEvent {
  disbursementId: string;
  providerId: string;
  grossAmount: number;
  serviceFee: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  paymentCaptureId: string;
  customerId: string;
  providerId: string;
  transactionDate: number;
  lineItems: LineItem[];
  serviceFee: number;
  taxRatePercent?: number;
  taxAmount?: number;
  total: number;
}

export interface DisbursementRecord {
  id: string;
  invoiceNumber: string;
  disbursementId: string;
  providerId: string;
  transactionDate: number;
  grossAmount: number;
  serviceFee: number;
  taxRatePercent?: number;
  taxAmount?: number;
  netAmount: number;
}
