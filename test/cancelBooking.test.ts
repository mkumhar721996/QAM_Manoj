import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { BookingRepository } from "../src/bookings/bookingRepository.ts";
import { evaluateCancellationPolicy } from "../src/bookings/cancellationPolicy.ts";
import { InMemoryPaymentsGateway } from "../src/payments/paymentsGateway.ts";
import { InMemoryNotificationsGateway } from "../src/notifications/notificationsGateway.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

async function login(baseUrl: string): Promise<{ access_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "customer1", password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string };
}

function seedConfirmedBooking(bookingRepository: BookingRepository, appointmentAt: number): void {
  bookingRepository.create({
    id: "booking-1",
    customerId: "user-customer-1",
    providerId: "user-provider-1",
    appointmentAt,
    status: "confirmed",
  });
}

test("AC1: evaluates the cancellation policy based on time remaining until the appointment", () => {
  const now = Date.now();
  const farOut = evaluateCancellationPolicy(now + 2 * DAY_MS, now);
  assert.equal(farOut.withinFreeWindow, true);

  const soon = evaluateCancellationPolicy(now + 2 * 60 * 60 * 1000, now);
  assert.equal(soon.withinFreeWindow, false);
});

test("AC2: a confirmed cancellation marks the booking as cancelled", async () => {
  const bookingRepository = new BookingRepository();
  seedConfirmedBooking(bookingRepository, Date.now() + 2 * DAY_MS);
  const server = await startTestServer({ bookingRepository });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const res = await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(bookingRepository.findById("booking-1")!.status, "cancelled");
  } finally {
    await server.close();
  }
});

test("AC3: cancelling within the free-cancellation window signals a full refund", async () => {
  const bookingRepository = new BookingRepository();
  const paymentsGateway = new InMemoryPaymentsGateway();
  seedConfirmedBooking(bookingRepository, Date.now() + 2 * DAY_MS);
  const server = await startTestServer({ bookingRepository, paymentsGateway });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(paymentsGateway.signals.length, 1);
    assert.equal(paymentsGateway.signals[0].outcome, "full_refund");
  } finally {
    await server.close();
  }
});

test("AC4: cancelling outside the free-cancellation window signals a no-refund outcome", async () => {
  const bookingRepository = new BookingRepository();
  const paymentsGateway = new InMemoryPaymentsGateway();
  seedConfirmedBooking(bookingRepository, Date.now() + 2 * 60 * 60 * 1000);
  const server = await startTestServer({ bookingRepository, paymentsGateway });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(paymentsGateway.signals.length, 1);
    assert.equal(paymentsGateway.signals[0].outcome, "no_refund");
  } finally {
    await server.close();
  }
});

test("AC5: a confirmed cancellation notifies the provider via Notifications", async () => {
  const bookingRepository = new BookingRepository();
  const notificationsGateway = new InMemoryNotificationsGateway();
  seedConfirmedBooking(bookingRepository, Date.now() + 2 * DAY_MS);
  const server = await startTestServer({ bookingRepository, notificationsGateway });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(notificationsGateway.notifications.length, 1);
    assert.equal(notificationsGateway.notifications[0].providerId, "user-provider-1");
  } finally {
    await server.close();
  }
});

test("AC6: a processed cancellation records a timestamp and actor id", async () => {
  const bookingRepository = new BookingRepository();
  seedConfirmedBooking(bookingRepository, Date.now() + 2 * DAY_MS);
  const server = await startTestServer({ bookingRepository });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const before = Date.now();
    await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const booking = bookingRepository.findById("booking-1")!;
    assert.equal(booking.cancelledBy, "user-customer-1");
    assert.ok(booking.cancelledAt! >= before);
  } finally {
    await server.close();
  }
});

test("AC7: an unauthenticated cancellation request is rejected", async () => {
  const bookingRepository = new BookingRepository();
  seedConfirmedBooking(bookingRepository, Date.now() + 2 * DAY_MS);
  const server = await startTestServer({ bookingRepository });
  try {
    const res = await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, { method: "POST" });
    assert.equal(res.status, 401);
    assert.equal(bookingRepository.findById("booking-1")!.status, "confirmed");
  } finally {
    await server.close();
  }
});

test("AC8: an unauthenticated cancellation attempt is prompted to log in", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/bookings/booking-1/cancel`, { method: "POST" });
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /log in/i);
  } finally {
    await server.close();
  }
});
