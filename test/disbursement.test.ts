import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { DisbursementRepository } from "../src/disbursements/disbursementRepository.ts";
import { ConfigRepository } from "../src/disbursements/configRepository.ts";
import { NotificationRepository } from "../src/disbursements/notificationRepository.ts";
import { InMemoryPaymentGateway } from "../src/disbursements/paymentGateway.ts";
import type { DisbursementPaymentInput, DisbursementPaymentResult, PaymentGateway } from "../src/disbursements/paymentGateway.ts";
import { DisbursementService } from "../src/disbursements/disbursementService.ts";
import { computeWebhookSignature } from "../src/disbursements/webhookAuth.ts";

const BOOKING_SERVICE_WEBHOOK_SECRET = process.env.BOOKING_SERVICE_WEBHOOK_SECRET!;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

function signedHeaders(headerName: string, secret: string, rawBody: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [headerName]: computeWebhookSignature(secret, rawBody),
  };
}

class ScriptedPaymentGateway implements PaymentGateway {
  calls: DisbursementPaymentInput[] = [];
  private results: DisbursementPaymentResult[];
  constructor(results: DisbursementPaymentResult[]) {
    this.results = results;
  }
  async disburse(input: DisbursementPaymentInput): Promise<DisbursementPaymentResult> {
    this.calls.push(input);
    const result = this.results[this.calls.length - 1] ?? this.results[this.results.length - 1];
    return result;
  }
}

async function loginAsAdmin(baseUrl: string): Promise<{ access_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin1", password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string };
}

test("AC1: a service-completed signal starts a 24-hour dispute window", () => {
  const disbursementRepository = new DisbursementRepository();
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    new InMemoryPaymentGateway(),
    new NotificationRepository(),
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-1", "user-provider-1", 100, now);
  const disbursement = disbursementRepository.findByBookingId("booking-1")!;
  assert.equal(disbursement.status, "dispute_window");
  assert.equal(disbursement.disburseAt - now, 24 * 60 * 60 * 1000);
});

test("AC2: funds are not disbursed while the dispute window is open", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    new NotificationRepository(),
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-2", "user-provider-1", 100, now);
  await service.processDue(now + 23 * 60 * 60 * 1000);
  assert.equal(gateway.calls.length, 0);
  assert.equal(disbursementRepository.findByBookingId("booking-2")!.status, "dispute_window");
});

test("AC3: disbursement pays total minus the service fee once the window elapses", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(0.1),
    gateway,
    new NotificationRepository(),
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-3", "user-provider-1", 200, now);
  await service.processDue(now + 24 * 60 * 60 * 1000);
  assert.equal(gateway.calls[0].amount, 180);
  assert.equal(disbursementRepository.findByBookingId("booking-3")!.status, "disbursed");
});

test("AC4: a dispute during the window prevents automatic disbursement", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    new NotificationRepository(),
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-4", "user-provider-1", 100, now);
  service.handleDisputeCreated("booking-4", now + 1000);
  await service.processDue(now + 24 * 60 * 60 * 1000);
  assert.equal(gateway.calls.length, 0);
  assert.equal(disbursementRepository.findByBookingId("booking-4")!.status, "dispute_window");
});

test("AC5: a failing disbursement is retried up to 3 times", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([
    { success: false },
    { success: false },
    { success: false },
    { success: false },
  ]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    new NotificationRepository(),
  );
  let now = Date.now();
  service.handleServiceCompleted("booking-5", "user-provider-1", 100, now);
  now += 24 * 60 * 60 * 1000;
  for (let i = 0; i < 4; i += 1) {
    await service.processDue(now);
    const d = disbursementRepository.findByBookingId("booking-5")!;
    now = d.nextRetryAt ?? now;
  }
  assert.equal(gateway.calls.length, 4);
  assert.equal(disbursementRepository.findByBookingId("booking-5")!.status, "failed_manual_intervention");
});

test("AC6: retries are scheduled at 15m, 1h, then 4h after the preceding attempt", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([
    { success: false },
    { success: false },
    { success: false },
    { success: false },
  ]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    new NotificationRepository(),
  );
  let now = Date.now();
  service.handleServiceCompleted("booking-6", "user-provider-1", 100, now);
  now += 24 * 60 * 60 * 1000;

  await service.processDue(now);
  assert.equal(disbursementRepository.findByBookingId("booking-6")!.nextRetryAt! - now, 15 * 60 * 1000);

  now = disbursementRepository.findByBookingId("booking-6")!.nextRetryAt!;
  await service.processDue(now);
  assert.equal(disbursementRepository.findByBookingId("booking-6")!.nextRetryAt! - now, 60 * 60 * 1000);

  now = disbursementRepository.findByBookingId("booking-6")!.nextRetryAt!;
  await service.processDue(now);
  assert.equal(disbursementRepository.findByBookingId("booking-6")!.nextRetryAt! - now, 4 * 60 * 60 * 1000);
});

test("AC7: funds remain held pending manual intervention after all 3 retries fail", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([
    { success: false },
    { success: false },
    { success: false },
    { success: false },
  ]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    new NotificationRepository(),
  );
  let now = Date.now();
  service.handleServiceCompleted("booking-7", "user-provider-1", 100, now);
  now += 24 * 60 * 60 * 1000;
  for (let i = 0; i < 4; i += 1) {
    await service.processDue(now);
    const d = disbursementRepository.findByBookingId("booking-7")!;
    now = d.nextRetryAt ?? now;
  }
  const disbursement = disbursementRepository.findByBookingId("booking-7")!;
  assert.equal(disbursement.status, "failed_manual_intervention");
  assert.equal(disbursement.disbursedAt, undefined);
});

test("AC8: admin is notified after the final retry fails", async () => {
  const disbursementRepository = new DisbursementRepository();
  const notificationRepository = new NotificationRepository();
  const gateway = new ScriptedPaymentGateway([
    { success: false },
    { success: false },
    { success: false },
    { success: false },
  ]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    notificationRepository,
  );
  let now = Date.now();
  service.handleServiceCompleted("booking-8", "user-provider-1", 100, now);
  now += 24 * 60 * 60 * 1000;
  for (let i = 0; i < 4; i += 1) {
    await service.processDue(now);
    const d = disbursementRepository.findByBookingId("booking-8")!;
    now = d.nextRetryAt ?? now;
  }
  assert.ok(
    notificationRepository.getNotifications().some((n) => n.recipient === "admin" && n.bookingId === "booking-8"),
  );
});

test("AC9: provider is notified to update payout details after the final retry fails", async () => {
  const disbursementRepository = new DisbursementRepository();
  const notificationRepository = new NotificationRepository();
  const gateway = new ScriptedPaymentGateway([
    { success: false },
    { success: false },
    { success: false },
    { success: false },
  ]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    notificationRepository,
  );
  let now = Date.now();
  service.handleServiceCompleted("booking-9", "user-provider-1", 100, now);
  now += 24 * 60 * 60 * 1000;
  for (let i = 0; i < 4; i += 1) {
    await service.processDue(now);
    const d = disbursementRepository.findByBookingId("booking-9")!;
    now = d.nextRetryAt ?? now;
  }
  assert.ok(
    notificationRepository.getNotifications().some((n) => n.recipient === "provider" && n.bookingId === "booking-9"),
  );
});

test("AC10: each attempt is logged with a timestamp, actor, and retry count", async () => {
  const disbursementRepository = new DisbursementRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    new NotificationRepository(),
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-10", "user-provider-1", 100, now);
  await service.processDue(now + 24 * 60 * 60 * 1000);
  const [attempt] = disbursementRepository.getAttempts("booking-10");
  assert.equal(attempt.timestamp, now + 24 * 60 * 60 * 1000);
  assert.equal(attempt.actor, "system:disbursement-scheduler");
  assert.equal(attempt.retryCount, 0);
});

test("AC11: a runtime service-fee-rate change is applied without a code deployment", async () => {
  const disbursementRepository = new DisbursementRepository();
  const configRepository = new ConfigRepository();
  const server = await startTestServer({ disbursementRepository, configRepository });
  try {
    const { access_token: adminToken } = await loginAsAdmin(server.baseUrl);
    const putRes = await fetch(`${server.baseUrl}/config/service-fee-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ rate: 0.25 }),
    });
    assert.equal(putRes.status, 200);

    const service = new DisbursementService(
      disbursementRepository,
      configRepository,
      new InMemoryPaymentGateway(),
      new NotificationRepository(),
    );
    const now = Date.now();
    service.handleServiceCompleted("booking-11", "user-provider-1", 100, now);
    await service.processDue(now + 24 * 60 * 60 * 1000);
    assert.equal(disbursementRepository.findByBookingId("booking-11")!.netAmount, 75);
  } finally {
    await server.close();
  }
});

test("AC11b: a non-admin cannot change the service fee rate", async () => {
  const server = await startTestServer();
  try {
    const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
    });
    const { access_token: customerToken } = (await loginRes.json()) as { access_token: string };

    const putRes = await fetch(`${server.baseUrl}/config/service-fee-rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ rate: 0.25 }),
    });
    assert.equal(putRes.status, 403);
  } finally {
    await server.close();
  }
});

test("AC12: admin is alerted on a chargeback raised after disbursement", async () => {
  const disbursementRepository = new DisbursementRepository();
  const notificationRepository = new NotificationRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    notificationRepository,
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-12", "user-provider-1", 100, now);
  await service.processDue(now + 24 * 60 * 60 * 1000);
  service.handleDisputeCreated("booking-12", now + 25 * 60 * 60 * 1000);
  assert.ok(
    notificationRepository.getNotifications().some((n) => n.recipient === "admin" && n.bookingId === "booking-12"),
  );
});

test("AC13: a recovery task is created against the provider on a post-disbursement chargeback", async () => {
  const disbursementRepository = new DisbursementRepository();
  const notificationRepository = new NotificationRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    notificationRepository,
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-13", "user-provider-1", 100, now);
  await service.processDue(now + 24 * 60 * 60 * 1000);
  service.handleDisputeCreated("booking-13", now + 25 * 60 * 60 * 1000);
  const [task] = notificationRepository.getRecoveryTasks();
  assert.equal(task.bookingId, "booking-13");
  assert.equal(task.providerId, "user-provider-1");
});

test("AC14: no automatic reversal is attempted on a post-disbursement chargeback", async () => {
  const disbursementRepository = new DisbursementRepository();
  const notificationRepository = new NotificationRepository();
  const gateway = new ScriptedPaymentGateway([{ success: true }]);
  const service = new DisbursementService(
    disbursementRepository,
    new ConfigRepository(),
    gateway,
    notificationRepository,
  );
  const now = Date.now();
  service.handleServiceCompleted("booking-14", "user-provider-1", 100, now);
  await service.processDue(now + 24 * 60 * 60 * 1000);
  const before = { ...disbursementRepository.findByBookingId("booking-14")! };
  service.handleDisputeCreated("booking-14", now + 25 * 60 * 60 * 1000);
  const after = disbursementRepository.findByBookingId("booking-14")!;
  assert.deepEqual(after, before);
  assert.equal(gateway.calls.length, 1);
});

test("webhook: booking-service-completed starts a dispute window via HTTP", async () => {
  const disbursementRepository = new DisbursementRepository();
  const server = await startTestServer({ disbursementRepository });
  try {
    const rawBody = JSON.stringify({
      booking_id: "booking-webhook-1",
      provider_id: "user-provider-1",
      total_amount: 100,
    });
    const res = await fetch(`${server.baseUrl}/webhooks/booking-service-completed`, {
      method: "POST",
      headers: signedHeaders("X-Webhook-Signature", BOOKING_SERVICE_WEBHOOK_SECRET, rawBody),
      body: rawBody,
    });
    assert.equal(res.status, 202);
    const disbursement = disbursementRepository.findByBookingId("booking-webhook-1")!;
    assert.equal(disbursement.status, "dispute_window");
  } finally {
    await server.close();
  }
});

test("webhook: booking-service-completed rejects a request without a valid signature", async () => {
  const disbursementRepository = new DisbursementRepository();
  const server = await startTestServer({ disbursementRepository });
  try {
    const rawBody = JSON.stringify({
      booking_id: "booking-webhook-unsigned",
      provider_id: "user-provider-1",
      total_amount: 100,
    });

    const noSignatureRes = await fetch(`${server.baseUrl}/webhooks/booking-service-completed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
    assert.equal(noSignatureRes.status, 401);

    const wrongSignatureRes = await fetch(`${server.baseUrl}/webhooks/booking-service-completed`, {
      method: "POST",
      headers: signedHeaders("X-Webhook-Signature", "not-the-real-secret", rawBody),
      body: rawBody,
    });
    assert.equal(wrongSignatureRes.status, 401);

    assert.equal(disbursementRepository.findByBookingId("booking-webhook-unsigned"), undefined);
  } finally {
    await server.close();
  }
});

test("webhook: stripe dispute marks the disbursement as disputed via HTTP", async () => {
  const disbursementRepository = new DisbursementRepository();
  const server = await startTestServer({ disbursementRepository });
  try {
    const completedRawBody = JSON.stringify({
      booking_id: "booking-webhook-2",
      provider_id: "user-provider-1",
      total_amount: 100,
    });
    await fetch(`${server.baseUrl}/webhooks/booking-service-completed`, {
      method: "POST",
      headers: signedHeaders("X-Webhook-Signature", BOOKING_SERVICE_WEBHOOK_SECRET, completedRawBody),
      body: completedRawBody,
    });

    const disputeRawBody = JSON.stringify({ type: "charge.dispute.created", booking_id: "booking-webhook-2" });
    const res = await fetch(`${server.baseUrl}/webhooks/stripe/dispute`, {
      method: "POST",
      headers: signedHeaders("Stripe-Signature", STRIPE_WEBHOOK_SECRET, disputeRawBody),
      body: disputeRawBody,
    });
    assert.equal(res.status, 200);
    assert.equal(disbursementRepository.findByBookingId("booking-webhook-2")!.disputeRaised, true);
  } finally {
    await server.close();
  }
});

test("webhook: stripe dispute rejects a request without a valid signature", async () => {
  const disbursementRepository = new DisbursementRepository();
  const server = await startTestServer({ disbursementRepository });
  try {
    const completedRawBody = JSON.stringify({
      booking_id: "booking-webhook-3",
      provider_id: "user-provider-1",
      total_amount: 100,
    });
    await fetch(`${server.baseUrl}/webhooks/booking-service-completed`, {
      method: "POST",
      headers: signedHeaders("X-Webhook-Signature", BOOKING_SERVICE_WEBHOOK_SECRET, completedRawBody),
      body: completedRawBody,
    });

    const disputeRawBody = JSON.stringify({ type: "charge.dispute.created", booking_id: "booking-webhook-3" });
    const res = await fetch(`${server.baseUrl}/webhooks/stripe/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: disputeRawBody,
    });
    assert.equal(res.status, 401);
    assert.equal(disbursementRepository.findByBookingId("booking-webhook-3")!.disputeRaised, false);
  } finally {
    await server.close();
  }
});
