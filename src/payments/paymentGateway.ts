export interface PaymentAuthorization {
  paymentIntentId: string;
}

export interface PaymentGateway {
  authorize(paymentToken: string, amount: number, currency: string): Promise<PaymentAuthorization>;
  capture(paymentIntentId: string): Promise<void>;
}
