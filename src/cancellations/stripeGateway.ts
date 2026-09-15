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

const STRIPE_REQUEST_TIMEOUT_MS = 10_000;

interface StripeErrorBody {
  error?: { code?: string; message?: string; type?: string };
}

export class StripeApiGateway implements StripeGateway {
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  async refund(paymentIntentId: string, amountCents: number): Promise<RefundResult> {
    const body = await this.post(
      "https://api.stripe.com/v1/refunds",
      { payment_intent: paymentIntentId, amount: String(amountCents) },
      "refund",
      { paymentIntentId, amountCents },
    );
    return { id: body.id, amountCents };
  }

  async disburseToProvider(providerId: string, amountCents: number): Promise<DisbursementResult> {
    const body = await this.post(
      "https://api.stripe.com/v1/transfers",
      { destination: providerId, amount: String(amountCents), currency: "usd" },
      "transfer",
      { providerId, amountCents },
    );
    return { id: body.id, amountCents };
  }

  private async post(
    url: string,
    params: Record<string, string>,
    operation: string,
    context: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(STRIPE_REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as StripeErrorBody & { id?: string };
    if (!res.ok) {
      console.error(`Stripe ${operation} failed`, {
        ...context,
        status: res.status,
        stripeErrorCode: body.error?.code,
        stripeErrorType: body.error?.type,
        stripeErrorMessage: body.error?.message,
        timestamp: new Date().toISOString(),
      });
      throw new Error(`Stripe ${operation} failed: ${res.status}${body.error?.message ? ` - ${body.error.message}` : ""}`);
    }
    return body as { id: string };
  }
}
