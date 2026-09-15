import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { BookingRepository } from "../src/booking/bookingRepository.ts";
import { PaymentAuditLogRepository } from "../src/payments/paymentAuditLogRepository.ts";
import { BookingOwnershipError, PaymentService } from "../src/payments/paymentService.ts";
import type { PaymentAuthorization, PaymentGateway } from "../src/payments/paymentGateway.ts";
import type { NotificationService } from "../src/notifications/notificationService.ts";

type CaptureBehavior = "always-succeed" | "always-fail" | "fail-then-succeed";

class FakeGateway implements PaymentGateway {
  authorizeCalls: Array<{ paymentToken: string; amount: number; currency: string }> = [];
  captureCalls: string[] = [];
  private readonly authorizeResult: PaymentAuthorization;
  private readonly captureBehavior: CaptureBehavior;

  constructor(
    options: { authorizeResult?: PaymentAuthorization; captureBehavior?: CaptureBehavior } = {},
  ) {
    this.authorizeResult = options.authorizeResult ?? { paymentIntentId: "pi_test_123" };
    this.captureBehavior = options.captureBehavior ?? "always-succeed";
  }

  async authorize(paymentToken: string, amount: number, currency: string): Promise<PaymentAuthorization> {
    this.authorizeCalls.push({ paymentToken, amount, currency });
    return this.authorizeResult;
  }

  async capture(paymentIntentId: string): Promise<void> {
    this.captureCalls.push(paymentIntentId);
    if (this.captureBehavior === "always-fail") {
      throw new Error("capture declined");
    }
    if (this.captureBehavior === "fail-then-succeed" && this.captureCalls.length === 1) {
      throw new Error("capture declined");
    }
  }
}

class FakeNotificationService implements NotificationService {
  emailsSent: Array<{ customerId: string; bookingId: string }> = [];
  smsSent: Array<{ customerId: string; bookingId: string }> = [];

  async sendBookingConfirmationEmail(customerId: string, bookingId: string): Promise<void> {
    this.emailsSent.push({ customerId, bookingId });
  }

  async sendBookingConfirmationSms(customerId: string, bookingId: string): Promise<void> {
    this.smsSent.push({ customerId, bookingId });
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function setUp(gateway: FakeGateway, customerId: string = "user-1") {
  const bookingRepository = new BookingRepository();
  const auditLog = new PaymentAuditLogRepository();
  const notificationService = new FakeNotificationService();
  const paymentService = new PaymentService(gateway, bookingRepository, auditLog, notificationService);
  const booking = bookingRepository.create({ customerId, amount: 2500, currency: "usd" });
  return { bookingRepository, auditLog, notificationService, paymentService, booking };
}

test("AC2: authorize is called once against the booking's payment token, amount and currency", async () => {
  const gateway = new FakeGateway();
  const { paymentService, booking } = setUp(gateway);

  await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");

  assert.deepEqual(gateway.authorizeCalls, [
    { paymentToken: "tok_visa", amount: booking.amount, currency: booking.currency },
  ]);
});

test("AC3: capture is called against the payment intent id returned by authorize", async () => {
  const gateway = new FakeGateway({ authorizeResult: { paymentIntentId: "pi_test_123" } });
  const { paymentService, booking } = setUp(gateway);

  await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");

  assert.equal(gateway.captureCalls[0], "pi_test_123");
});

test("AC4: a successful capture transitions the booking to confirmed", async () => {
  const gateway = new FakeGateway();
  const { paymentService, bookingRepository, booking } = setUp(gateway);

  const result = await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");

  assert.equal(result.status, "confirmed");
  assert.equal(bookingRepository.findById(booking.id)?.status, "confirmed");
});

test("AC5: the booking is not confirmed before a failed capture has finished retrying", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const gateway = new FakeGateway({ captureBehavior: "always-fail" });
    const { paymentService, bookingRepository, booking } = setUp(gateway);

    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await flushMicrotasks();
    assert.notEqual(bookingRepository.findById(booking.id)?.status, "confirmed");

    mock.timers.tick(30_000);
    await confirmPromise;
  } finally {
    mock.timers.reset();
  }
});

test("AC6: a capture that fails once is retried exactly once after a 30s delay", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const gateway = new FakeGateway({ captureBehavior: "fail-then-succeed" });
    const { paymentService, booking } = setUp(gateway);

    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await flushMicrotasks();
    assert.equal(gateway.captureCalls.length, 1);

    mock.timers.tick(29_999);
    assert.equal(gateway.captureCalls.length, 1);

    mock.timers.tick(1);
    const result = await confirmPromise;
    assert.equal(gateway.captureCalls.length, 2);
    assert.equal(result.status, "confirmed");
  } finally {
    mock.timers.reset();
  }
});

test("AC7: a second failed capture attempt moves the booking to pending_payment, not cancelled", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const gateway = new FakeGateway({ captureBehavior: "always-fail" });
    const { paymentService, booking } = setUp(gateway);

    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await flushMicrotasks();
    mock.timers.tick(30_000);
    const result = await confirmPromise;

    assert.equal(result.status, "pending_payment");
    assert.equal(gateway.captureCalls.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test("AC8: every capture attempt is logged with a timestamp and actor id", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const gateway = new FakeGateway({ captureBehavior: "fail-then-succeed" });
    const { paymentService, auditLog, booking } = setUp(gateway, "actor-42");

    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "actor-42");
    await flushMicrotasks();
    mock.timers.tick(30_000);
    await confirmPromise;

    const entries = auditLog.findByBookingId(booking.id);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].outcome, "failure");
    assert.equal(entries[1].outcome, "success");
    assert.ok(entries.every((e) => e.actorId === "actor-42" && typeof e.timestamp === "number"));
    assert.equal(entries[1].timestamp - entries[0].timestamp, 30_000);
  } finally {
    mock.timers.reset();
  }
});

test("AC9: on a successful capture, both an email and an SMS confirmation are sent", async () => {
  const gateway = new FakeGateway();
  const { paymentService, notificationService, booking } = setUp(gateway);

  await paymentService.confirmBooking(booking.id, "tok_visa", "user-1");

  assert.deepEqual(notificationService.emailsSent, [{ customerId: booking.customerId, bookingId: booking.id }]);
  assert.deepEqual(notificationService.smsSent, [{ customerId: booking.customerId, bookingId: booking.id }]);
});

test("a caller who does not own the booking cannot confirm it or trigger a charge", async () => {
  const gateway = new FakeGateway();
  const { paymentService, bookingRepository, booking } = setUp(gateway);

  await assert.rejects(
    () => paymentService.confirmBooking(booking.id, "tok_visa", "someone-else"),
    BookingOwnershipError,
  );

  assert.equal(gateway.authorizeCalls.length, 0);
  assert.equal(bookingRepository.findById(booking.id)?.status, "awaiting_confirmation");
});

test("AC9: on total capture failure, no email or SMS confirmation is sent", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const gateway = new FakeGateway({ captureBehavior: "always-fail" });
    const { paymentService, notificationService, booking } = setUp(gateway);

    const confirmPromise = paymentService.confirmBooking(booking.id, "tok_visa", "user-1");
    await flushMicrotasks();
    mock.timers.tick(30_000);
    await confirmPromise;

    assert.equal(notificationService.emailsSent.length, 0);
    assert.equal(notificationService.smsSent.length, 0);
  } finally {
    mock.timers.reset();
  }
});
