import type { PaymentAuthorization, PaymentGateway } from "./paymentGateway.ts";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY environment variable must be set");
}

export class StripeGatewayError extends Error {}

interface StripeErrorResponse {
  error?: { message?: string };
}

export class StripePaymentGateway implements PaymentGateway {
  async authorize(paymentToken: string, amount: number, currency: string): Promise<PaymentAuthorization> {
    const body = new URLSearchParams({
      amount: String(amount),
      currency,
      payment_method: paymentToken,
      capture_method: "manual",
      confirm: "true",
    });

    const response = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const payload = (await response.json()) as StripeErrorResponse & { id?: string };
    if (!response.ok || !payload.id) {
      throw new StripeGatewayError(payload.error?.message ?? "Stripe authorization failed");
    }
    return { paymentIntentId: payload.id };
  }

  async capture(paymentIntentId: string): Promise<void> {
    const response = await fetch(`${STRIPE_API_BASE}/payment_intents/${paymentIntentId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });

    if (!response.ok) {
      const payload = (await response.json()) as StripeErrorResponse;
      throw new StripeGatewayError(payload.error?.message ?? "Stripe capture failed");
    }
  }
}
