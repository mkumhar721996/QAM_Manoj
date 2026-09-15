import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startTestServer } from "./testServer.ts";
import { TransactionRepository } from "../src/payments/transactionRepository.ts";
import { PayoutRepository } from "../src/payments/payoutRepository.ts";
import { ReversalRepository } from "../src/payments/reversalRepository.ts";
import { AuditLogRepository } from "../src/payments/auditLogRepository.ts";
import { NotificationRepository } from "../src/payments/notificationRepository.ts";
import type { Transaction } from "../src/payments/paymentsModel.ts";

const PROVIDER_ID = "user-provider-1";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

function disputeEvent(id: string, chargeId: string, amount: number): Record<string, unknown> {
  return {
    id,
    type: "charge.dispute.created",
    data: { object: { id: `dp_${id}`, amount, charge: chargeId } },
  };
}

function signPayload(payload: string, secret: string = STRIPE_WEBHOOK_SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function postWebhook(
  baseUrl: string,
  event: Record<string, unknown>,
  signatureHeader?: string,
): Promise<Response> {
  const payload = JSON.stringify(event);
  return fetch(`${baseUrl}/webhooks/stripe/chargebacks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signatureHeader ?? signPayload(payload),
    },
    body: payload,
  });
}

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: "txn-1",
    stripeChargeId: "ch_1",
    providerId: PROVIDER_ID,
    amount: 40,
    disbursementStatus: "pending_payout",
    ...overrides,
  };
}

test("AC1: a chargeback webhook triggers a disbursement reversal for the affected provider", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const payoutRepository = new PayoutRepository();
  payoutRepository.createPayout(PROVIDER_ID, 100);
  const server = await startTestServer({ transactionRepository, payoutRepository });
  try {
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_1", "ch_1", 40));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { provider_id: string; action: string };
    assert.equal(body.provider_id, PROVIDER_ID);
    assert.equal(body.action, "clawback_from_pending_payout");
  } finally {
    await server.close();
  }
});

test("AC2: a sufficient pending payout is clawed back by exactly the chargeback amount", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const payoutRepository = new PayoutRepository();
  payoutRepository.createPayout(PROVIDER_ID, 100);
  const server = await startTestServer({ transactionRepository, payoutRepository });
  try {
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_2", "ch_1", 40));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { action: string };
    assert.equal(body.action, "clawback_from_pending_payout");
    const payout = payoutRepository.findPendingByProviderId(PROVIDER_ID);
    assert.equal(payout?.amount, 60);
  } finally {
    await server.close();
  }
});

test("AC3: an insufficient pending payout causes future payouts to be held until recovered", async () => {
  const transactionRepository = new TransactionRepository([
    transaction({ stripeChargeId: "ch_2", disbursementStatus: "pending_payout" }),
  ]);
  const payoutRepository = new PayoutRepository();
  payoutRepository.createPayout(PROVIDER_ID, 20);
  const server = await startTestServer({ transactionRepository, payoutRepository });
  try {
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_3", "ch_2", 100));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { action: string };
    assert.equal(body.action, "hold_future_payouts");
    const nextPayout = payoutRepository.createPayout(PROVIDER_ID, 50);
    assert.equal(nextPayout.status, "held");
  } finally {
    await server.close();
  }
});

test("AC4: fully disbursed funds with no pending payout trigger a direct clawback", async () => {
  const transactionRepository = new TransactionRepository([
    transaction({ stripeChargeId: "ch_3", disbursementStatus: "disbursed" }),
  ]);
  const payoutRepository = new PayoutRepository();
  const server = await startTestServer({ transactionRepository, payoutRepository });
  try {
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_4", "ch_3", 100));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { action: string };
    assert.equal(body.action, "direct_clawback");
    assert.equal(payoutRepository.getDirectClawbackAmount(PROVIDER_ID), 100);
  } finally {
    await server.close();
  }
});

test("AC5: the admin is notified with the chargeback details", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const payoutRepository = new PayoutRepository();
  payoutRepository.createPayout(PROVIDER_ID, 100);
  const notificationRepository = new NotificationRepository();
  const server = await startTestServer({ transactionRepository, payoutRepository, notificationRepository });
  try {
    await postWebhook(server.baseUrl, disputeEvent("evt_5", "ch_1", 40));
    const adminNotifications = notificationRepository.findByRecipientRole("admin");
    assert.equal(adminNotifications.length, 1);
    assert.equal(adminNotifications[0].amount, 40);
    assert.equal(adminNotifications[0].chargebackId, "evt_5");
  } finally {
    await server.close();
  }
});

test("AC6: the provider is notified that a chargeback has been received against their transaction", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const payoutRepository = new PayoutRepository();
  payoutRepository.createPayout(PROVIDER_ID, 100);
  const notificationRepository = new NotificationRepository();
  const server = await startTestServer({ transactionRepository, payoutRepository, notificationRepository });
  try {
    await postWebhook(server.baseUrl, disputeEvent("evt_6", "ch_1", 40));
    const providerNotifications = notificationRepository.findByRecipientRole("provider");
    assert.equal(providerNotifications.length, 1);
    assert.equal(providerNotifications[0].recipientId, PROVIDER_ID);
  } finally {
    await server.close();
  }
});

test("AC7: the chargeback event is logged with timestamp, actor id, amount, and reversal action", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const payoutRepository = new PayoutRepository();
  payoutRepository.createPayout(PROVIDER_ID, 100);
  const auditLogRepository = new AuditLogRepository();
  const server = await startTestServer({ transactionRepository, payoutRepository, auditLogRepository });
  try {
    await postWebhook(server.baseUrl, disputeEvent("evt_7", "ch_1", 40));
    const entries = auditLogRepository.findAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actorId, "evt_7");
    assert.equal(entries[0].chargebackAmount, 40);
    assert.equal(entries[0].action, "clawback_from_pending_payout");
    assert.equal(typeof entries[0].timestamp, "number");
  } finally {
    await server.close();
  }
});

test("chargeback webhook for an unknown charge id returns 404", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const server = await startTestServer({ transactionRepository });
  try {
    const res = await postWebhook(server.baseUrl, disputeEvent("evt_8", "ch_unknown", 40));
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("malformed chargeback webhook payload returns 400", async () => {
  const server = await startTestServer();
  try {
    const res = await postWebhook(server.baseUrl, { id: "evt_9", type: "charge.dispute.created" });
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("a chargeback webhook with a missing or invalid Stripe signature is rejected", async () => {
  const transactionRepository = new TransactionRepository([transaction({})]);
  const server = await startTestServer({ transactionRepository });
  try {
    const event = disputeEvent("evt_10", "ch_1", 40);

    const missingSignature = await fetch(`${server.baseUrl}/webhooks/stripe/chargebacks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    assert.equal(missingSignature.status, 401);

    const invalidSignature = await postWebhook(server.baseUrl, event, "t=1,v1=deadbeef");
    assert.equal(invalidSignature.status, 401);

    const wrongSecret = await postWebhook(server.baseUrl, event, signPayload(JSON.stringify(event), "wrong-secret"));
    assert.equal(wrongSecret.status, 401);
  } finally {
    await server.close();
  }
});
