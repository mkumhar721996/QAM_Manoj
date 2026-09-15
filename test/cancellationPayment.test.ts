import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { CancellationLogRepository } from "../src/cancellations/cancellationLogRepository.ts";
import type { DisbursementResult, RefundResult, StripeGateway } from "../src/cancellations/stripeGateway.ts";
import { issueAccessToken } from "../src/auth/tokenService.ts";

const authHeader = `Bearer ${issueAccessToken({ userId: "internal-service", role: "admin" })}`;

class FakeStripeGateway implements StripeGateway {
  refundCalls: { paymentIntentId: string; amountCents: number }[] = [];
  disburseCalls: { providerId: string; amountCents: number }[] = [];

  async refund(paymentIntentId: string, amountCents: number): Promise<RefundResult> {
    this.refundCalls.push({ paymentIntentId, amountCents });
    return { id: `re_${this.refundCalls.length}`, amountCents };
  }

  async disburseToProvider(providerId: string, amountCents: number): Promise<DisbursementResult> {
    this.disburseCalls.push({ providerId, amountCents });
    return { id: `tr_${this.disburseCalls.length}`, amountCents };
  }
}

test("AC1: a fully refundable outcome issues a full refund via Stripe", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-1",
        actor_id: "customer-1",
        outcome: "full_refund",
        payment_intent_id: "pi_123",
        refund_amount_cents: 5000,
        non_refundable_amount_cents: 0,
        service_fee_cents: 0,
      }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(stripeGateway.refundCalls, [{ paymentIntentId: "pi_123", amountCents: 5000 }]);
  } finally {
    await server.close();
  }
});

test("AC2: a partial refund outcome refunds only the refundable portion", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-2",
        actor_id: "customer-1",
        outcome: "partial_refund",
        payment_intent_id: "pi_456",
        provider_id: "acct_789",
        refund_amount_cents: 3000,
        non_refundable_amount_cents: 2000,
        service_fee_cents: 500,
      }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(stripeGateway.refundCalls, [{ paymentIntentId: "pi_456", amountCents: 3000 }]);
  } finally {
    await server.close();
  }
});

test("AC3: the non-refundable portion minus service fee is disbursed to the provider", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-3",
        actor_id: "customer-1",
        outcome: "partial_refund",
        payment_intent_id: "pi_789",
        provider_id: "acct_111",
        refund_amount_cents: 3000,
        non_refundable_amount_cents: 2000,
        service_fee_cents: 500,
      }),
    });
    assert.deepEqual(stripeGateway.disburseCalls, [{ providerId: "acct_111", amountCents: 1500 }]);
  } finally {
    await server.close();
  }
});

test("AC4: the service fee is never waived from the non-refundable portion", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-4",
        actor_id: "customer-1",
        outcome: "partial_refund",
        payment_intent_id: "pi_999",
        provider_id: "acct_222",
        refund_amount_cents: 1000,
        non_refundable_amount_cents: 4000,
        service_fee_cents: 700,
      }),
    });
    const [disbursed] = stripeGateway.disburseCalls;
    assert.equal(disbursed.amountCents, 4000 - 700);
  } finally {
    await server.close();
  }
});

test("AC5: the processed event is logged with timestamp, actor, refund amount, non-refundable amount", async () => {
  const stripeGateway = new FakeStripeGateway();
  const cancellationLogRepository = new CancellationLogRepository();
  const server = await startTestServer({ stripeGateway, cancellationLogRepository });
  try {
    const before = Date.now();
    const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-5",
        actor_id: "customer-42",
        outcome: "partial_refund",
        payment_intent_id: "pi_555",
        provider_id: "acct_333",
        refund_amount_cents: 1200,
        non_refundable_amount_cents: 800,
        service_fee_cents: 100,
      }),
    });
    assert.equal(res.status, 200);

    const [entry] = cancellationLogRepository.findByBookingId("booking-5");
    assert.equal(entry.actorId, "customer-42");
    assert.equal(entry.refundAmountCents, 1200);
    assert.equal(entry.nonRefundableAmountCents, 800);
    assert.ok(entry.timestamp >= before && entry.timestamp <= Date.now());
  } finally {
    await server.close();
  }
});

test("AC6: no service fee is deducted from a full refund", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-6",
        actor_id: "customer-1",
        outcome: "full_refund",
        payment_intent_id: "pi_777",
        refund_amount_cents: 6000,
        non_refundable_amount_cents: 0,
        service_fee_cents: 0,
      }),
    });
    const [refunded] = stripeGateway.refundCalls;
    assert.equal(refunded.amountCents, 6000);
    assert.equal(stripeGateway.disburseCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("unauthenticated requests are rejected and no money movement occurs", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_id: "booking-7",
        actor_id: "customer-1",
        outcome: "full_refund",
        payment_intent_id: "pi_888",
        refund_amount_cents: 1000,
        non_refundable_amount_cents: 0,
        service_fee_cents: 0,
      }),
    });
    assert.equal(res.status, 401);
    assert.equal(stripeGateway.refundCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("negative amounts are rejected as invalid payload", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-8",
        actor_id: "customer-1",
        outcome: "full_refund",
        payment_intent_id: "pi_000",
        refund_amount_cents: -500000,
        non_refundable_amount_cents: 0,
        service_fee_cents: 0,
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(stripeGateway.refundCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("no disbursement is attempted when the service fee equals the non-refundable amount", async () => {
  const stripeGateway = new FakeStripeGateway();
  const server = await startTestServer({ stripeGateway });
  try {
    const res = await fetch(`${server.baseUrl}/payments/cancellations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        booking_id: "booking-9",
        actor_id: "customer-1",
        outcome: "partial_refund",
        payment_intent_id: "pi_111",
        provider_id: "acct_444",
        refund_amount_cents: 1000,
        non_refundable_amount_cents: 500,
        service_fee_cents: 500,
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(stripeGateway.disburseCalls.length, 0);
  } finally {
    await server.close();
  }
});
