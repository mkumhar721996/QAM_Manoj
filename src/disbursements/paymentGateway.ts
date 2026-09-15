export interface DisbursementPaymentInput {
  bookingId: string;
  providerId: string;
  amount: number;
}

export interface DisbursementPaymentResult {
  success: boolean;
  failureReason?: string;
}

export interface PaymentGateway {
  disburse(input: DisbursementPaymentInput): Promise<DisbursementPaymentResult>;
}

export class InMemoryPaymentGateway implements PaymentGateway {
  async disburse(_input: DisbursementPaymentInput): Promise<DisbursementPaymentResult> {
    return { success: true };
  }
}
