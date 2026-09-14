import { test } from "node:test";
import assert from "node:assert/strict";
import { BookingRepository } from "../src/bookings/bookingRepository.ts";
import { NoShowPolicyRepository } from "../src/noshow/noShowPolicyRepository.ts";
import { InMemoryPaymentsInvoicingClient } from "../src/payments/paymentsInvoicingClient.ts";
import { InMemoryNotificationsClient } from "../src/notifications/notificationsClient.ts";
import { NoShowDetectionService } from "../src/noshow/noShowDetectionService.ts";

function createHarness() {
  const bookingRepository = new BookingRepository();
  const policyRepository = new NoShowPolicyRepository();
  const payments = new InMemoryPaymentsInvoicingClient();
  const notifications = new InMemoryNotificationsClient();
  const service = new NoShowDetectionService(bookingRepository, policyRepository, payments, notifications);
  return { bookingRepository, policyRepository, payments, notifications, service };
}

test("AC1: booking is marked no-show once the 15-minute grace period elapses with no confirmed cancellation", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  const result = service.detect(booking.id, apptTime + 15 * 60_000);

  assert.equal(result.status, "noshow");
});

test("AC2: a confirmed cancellation recorded before the appointment time passes prevents a no-show", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
  bookingRepository.recordCancellation(booking.id, apptTime - 5 * 60_000);

  const result = service.detect(booking.id, apptTime + 20 * 60_000);

  assert.equal(result.status, "cancelled");
});

test("AC3: marking a booking no-show signals the configured financial outcome to Payments & Invoicing", () => {
  const { bookingRepository, policyRepository, payments, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  service.detect(booking.id, apptTime + 15 * 60_000);

  assert.equal(payments.signals.length, 1);
  assert.deepEqual(payments.signals[0].outcome, { type: "fee", amount: 22.5, policyId: "standard-grace", policyVersion: 1 });
});

test("AC4: marking a booking no-show notifies both the customer and the provider", () => {
  const { bookingRepository, policyRepository, notifications, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  service.detect(booking.id, apptTime + 15 * 60_000);

  const recipients = notifications.sent.map((n) => n.recipient).sort();
  assert.deepEqual(recipients, ["customer", "provider"]);
});

test("AC5: a no-show status update logs the detection timestamp on the booking", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
  const detectedAt = apptTime + 15 * 60_000;

  const result = service.detect(booking.id, detectedAt);

  assert.equal(result.noShowDetectedAt, detectedAt);
});

test("AC6: an updated no-show policy governs the outcome of subsequently detected no-shows only", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 45 }, apptTime - 1000);
  const bookingA = bookingRepository.create({ id: "BKG-A", customerId: "cust-a", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
  service.detect(bookingA.id, apptTime + 15 * 60_000);

  policyRepository.addVersion("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime + 20 * 60_000);
  const laterApptTime = apptTime + 60 * 60_000;
  const bookingB = bookingRepository.create({ id: "BKG-B", customerId: "cust-b", providerId: "prov-1", service: "Haircut", appointmentTime: laterApptTime, policyId: "standard-grace" });
  const resultB = service.detect(bookingB.id, laterApptTime + 15 * 60_000);

  assert.equal(resultB.financialOutcome?.amount, 22.5);
  assert.equal(resultB.financialOutcome?.policyVersion, 2);
  assert.equal(bookingRepository.findById(bookingA.id)?.financialOutcome?.amount, 45);
});

test("AC7: booking is not yet marked no-show when only 10 of 15 grace-period minutes have elapsed", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  const result = service.detect(booking.id, apptTime + 10 * 60_000);

  assert.equal(result.status, "confirmed");
});

test("AC8: a booking with no applicable no-show policy is marked no-show once the appointment time passes", () => {
  const { bookingRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T08:30:00Z");
  const booking = bookingRepository.create({ id: "BKG-2", customerId: "cust-2", providerId: "prov-2", service: "Initial Consultation", appointmentTime: apptTime });

  const result = service.detect(booking.id, apptTime + 1000);

  assert.equal(result.status, "noshow");
});

test("AC9: a booking with no applicable no-show policy signals a 'no charge' outcome to Payments & Invoicing", () => {
  const { bookingRepository, payments, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T08:30:00Z");
  const booking = bookingRepository.create({ id: "BKG-2", customerId: "cust-2", providerId: "prov-2", service: "Initial Consultation", appointmentTime: apptTime });

  service.detect(booking.id, apptTime + 1000);

  assert.deepEqual(payments.signals[0].outcome, { type: "no_charge", amount: 0 });
});

test("AC10: re-evaluating an already no-show booking sends no additional signal or notification", () => {
  const { bookingRepository, policyRepository, payments, notifications, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  service.detect(booking.id, apptTime + 15 * 60_000);
  service.detect(booking.id, apptTime + 20 * 60_000);

  assert.equal(payments.signals.length, 1);
  assert.equal(notifications.sent.length, 2);
});

test("AC11: a confirmed cancellation recorded immediately before detection prevents a no-show even after the appointment time has passed", () => {
  const { bookingRepository, policyRepository, payments, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
  const detectionTime = apptTime + 20 * 60_000;
  bookingRepository.recordCancellation(booking.id, detectionTime - 1);

  const result = service.detect(booking.id, detectionTime);

  assert.equal(result.status, "cancelled");
  assert.equal(payments.signals.length, 0);
});

test("AC12: the customer no-show notification includes the financial outcome", () => {
  const { bookingRepository, policyRepository, notifications, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  service.detect(booking.id, apptTime + 15 * 60_000);

  const customerNotification = notifications.sent.find((n) => n.recipient === "customer");
  assert.deepEqual(customerNotification?.payload.financialOutcome, { type: "fee", amount: 22.5, policyId: "standard-grace", policyVersion: 1 });
});

test("AC13: the provider no-show notification includes the booking and customer details", () => {
  const { bookingRepository, policyRepository, notifications, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  service.detect(booking.id, apptTime + 15 * 60_000);

  const providerNotification = notifications.sent.find((n) => n.recipient === "provider");
  assert.equal(providerNotification?.payload.bookingId, "BKG-1");
  assert.equal(providerNotification?.payload.customerId, "cust-1");
  assert.equal(providerNotification?.payload.service, "Haircut");
});

test("a future-dated policy version does not govern detections before its effective date", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  policyRepository.addVersion("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 99 }, apptTime + 60 * 60_000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });

  const result = service.detect(booking.id, apptTime + 15 * 60_000);

  assert.equal(result.financialOutcome?.amount, 22.5);
  assert.equal(result.financialOutcome?.policyVersion, 1);
});

test("creating a booking with an id that already exists is rejected instead of silently overwriting it", () => {
  const { bookingRepository } = createHarness();
  bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: Date.now() });

  assert.throws(
    () => bookingRepository.create({ id: "BKG-1", customerId: "cust-2", providerId: "prov-2", service: "Massage", appointmentTime: Date.now() }),
    /Booking already exists/,
  );
});

test("a failed payments signal leaves the booking confirmed so detection can be retried", () => {
  const { bookingRepository, policyRepository, service } = createHarness();
  const apptTime = Date.parse("2026-09-14T09:00:00Z");
  policyRepository.create("standard-grace", { gracePeriodMinutes: 15, outcomeType: "fee", feeAmount: 22.5 }, apptTime - 1000);
  const booking = bookingRepository.create({ id: "BKG-1", customerId: "cust-1", providerId: "prov-1", service: "Haircut", appointmentTime: apptTime, policyId: "standard-grace" });
  const failingPayments = { signalNoShowOutcome: () => { throw new Error("payments unavailable"); } };
  const service2 = new NoShowDetectionService(bookingRepository, policyRepository, failingPayments, new InMemoryNotificationsClient());

  assert.throws(() => service2.detect(booking.id, apptTime + 15 * 60_000), /payments unavailable/);

  const stored = bookingRepository.findById(booking.id);
  assert.equal(stored?.status, "confirmed");
  assert.equal(stored?.financialOutcome, undefined);
});
