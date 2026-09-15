export interface RefundResult {
  id: string;
  amountCents: number;
}

export interface DisbursementResult {
  id: string;
  amountCents: number;
}

export interface StripeGateway {
  refund(paymentIntentId: string, amountCents: number): Promise<RefundResult>;
  disburseToProvider(providerId: string, amountCents: number): Promise<DisbursementResult>;
}

export class StripeApiGateway implements StripeGateway {
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  async refund(paymentIntentId: string, amountCents: number): Promise<RefundResult> {
    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ payment_intent: paymentIntentId, amount: String(amountCents) }),
    });
    if (!res.ok) {
      throw new Error(`Stripe refund failed: ${res.status}`);
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id, amountCents };
  }

  async disburseToProvider(providerId: string, amountCents: number): Promise<DisbursementResult> {
    const res = await fetch("https://api.stripe.com/v1/transfers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ destination: providerId, amount: String(amountCents), currency: "usd" }),
    });
    if (!res.ok) {
      throw new Error(`Stripe transfer failed: ${res.status}`);
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id, amountCents };
  }
}
