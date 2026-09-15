import { test } from "node:test";
import assert from "node:assert/strict";
import { StripeApiGateway } from "../src/cancellations/stripeGateway.ts";

function withMockedFetch<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => Promise.resolve(handler(url, init))) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("StripeApiGateway.refund posts the payment intent and amount to Stripe and returns the refund id", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const result = await withMockedFetch(
    (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    },
    () => new StripeApiGateway("sk_test_abc").refund("pi_123", 5000),
  );

  assert.equal(capturedUrl, "https://api.stripe.com/v1/refunds");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer sk_test_abc");
  assert.equal(String(capturedInit?.body), new URLSearchParams({ payment_intent: "pi_123", amount: "5000" }).toString());
  assert.deepEqual(result, { id: "re_123", amountCents: 5000 });
});

test("StripeApiGateway.disburseToProvider posts the destination account and amount to Stripe and returns the transfer id", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const result = await withMockedFetch(
    (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: "tr_456" }), { status: 200 });
    },
    () => new StripeApiGateway("sk_test_abc").disburseToProvider("acct_789", 1500),
  );

  assert.equal(capturedUrl, "https://api.stripe.com/v1/transfers");
  assert.equal(
    String(capturedInit?.body),
    new URLSearchParams({ destination: "acct_789", amount: "1500", currency: "usd" }).toString(),
  );
  assert.deepEqual(result, { id: "tr_456", amountCents: 1500 });
});

test("StripeApiGateway.refund surfaces Stripe's error message when the request fails", async () => {
  await withMockedFetch(
    () =>
      new Response(JSON.stringify({ error: { code: "card_declined", message: "The card was declined." } }), {
        status: 402,
      }),
    async () => {
      await assert.rejects(
        () => new StripeApiGateway("sk_test_abc").refund("pi_999", 1000),
        /Stripe refund failed: 402 - The card was declined\./,
      );
    },
  );
});
