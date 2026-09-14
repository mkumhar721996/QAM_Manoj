import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { BookingRepository } from "../src/bookings/bookingRepository.ts";
import { NotificationService } from "../src/notifications/notificationService.ts";
import { computeCancellationWindowStart } from "../src/bookings/cancellationPolicy.ts";

const CUSTOMER_1 = "user-customer-1";
const CUSTOMER_2 = "user-customer-2";
const PROVIDER_1 = "user-provider-1";

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function reschedule(
  baseUrl: string,
  bookingId: string,
  accessToken: string | undefined,
  newStartTime: number,
  newEndTime: number,
): Promise<Response> {
  return fetch(`${baseUrl}/bookings/${bookingId}/reschedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ new_start_time: newStartTime, new_end_time: newEndTime }),
  });
}

test("AC1: rescheduling updates the booking to the new time", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const newStart = Date.now() + 5 * 60 * 60 * 1000;
    const newEnd = Date.now() + 6 * 60 * 60 * 1000;
    const res = await reschedule(server.baseUrl, booking.id, accessToken, newStart, newEnd);

    assert.equal(res.status, 200);
    const updated = bookingRepository.findById(booking.id)!;
    assert.equal(updated.startTime, newStart);
    assert.equal(updated.endTime, newEnd);
  } finally {
    await server.close();
  }
});

test("AC2: the original slot is released back to availability", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const originalStart = Date.now() + 2 * 60 * 60 * 1000;
    const originalEnd = Date.now() + 3 * 60 * 60 * 1000;
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: originalStart,
      endTime: originalEnd,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(
      server.baseUrl,
      booking.id,
      accessToken,
      Date.now() + 5 * 60 * 60 * 1000,
      Date.now() + 6 * 60 * 60 * 1000,
    );
    assert.equal(res.status, 200);

    assert.equal(
      bookingRepository.findConfirmedByProviderAndTime(PROVIDER_1, originalStart, originalEnd),
      undefined,
    );
  } finally {
    await server.close();
  }
});

test("AC3: the cancellation policy window is recalculated relative to the new appointment time", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const originalStart = Date.now() + 2 * 60 * 60 * 1000;
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: originalStart,
      endTime: originalStart + 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const newStart = Date.now() + 5 * 60 * 60 * 1000;
    const res = await reschedule(server.baseUrl, booking.id, accessToken, newStart, newStart + 60 * 60 * 1000);
    assert.equal(res.status, 200);

    const updated = bookingRepository.findById(booking.id)!;
    assert.equal(updated.cancellationPolicyWindowStart, computeCancellationWindowStart(newStart));
    assert.notEqual(updated.cancellationPolicyWindowStart, computeCancellationWindowStart(originalStart));
  } finally {
    await server.close();
  }
});

test("AC4: a booking can be rescheduled an unlimited number of times", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    for (let i = 1; i <= 3; i += 1) {
      const newStart = Date.now() + (5 + i) * 60 * 60 * 1000;
      const res = await reschedule(server.baseUrl, booking.id, accessToken, newStart, newStart + 60 * 60 * 1000);
      assert.equal(res.status, 200);
    }

    assert.equal(bookingRepository.findById(booking.id)!.rescheduleHistory.length, 3);
  } finally {
    await server.close();
  }
});

test("AC5: an unauthenticated reschedule attempt is rejected and prompted to log in", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });

    const res = await reschedule(
      server.baseUrl,
      booking.id,
      undefined,
      Date.now() + 5 * 60 * 60 * 1000,
      Date.now() + 6 * 60 * 60 * 1000,
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "authentication required, please log in");
  } finally {
    await server.close();
  }
});

test("AC6: both the customer and provider are notified of the new appointment time", async () => {
  const bookingRepository = new BookingRepository();
  const notificationService = new NotificationService();
  const server = await startTestServer({ bookingRepository, notificationService });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(
      server.baseUrl,
      booking.id,
      accessToken,
      Date.now() + 5 * 60 * 60 * 1000,
      Date.now() + 6 * 60 * 60 * 1000,
    );
    assert.equal(res.status, 200);

    assert.equal(notificationService.getNotificationsForUser(CUSTOMER_1).length, 1);
    assert.equal(notificationService.getNotificationsForUser(PROVIDER_1).length, 1);
  } finally {
    await server.close();
  }
});

test("AC7: a timestamp and the acting user's ID are recorded against the reschedule event", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(
      server.baseUrl,
      booking.id,
      accessToken,
      Date.now() + 5 * 60 * 60 * 1000,
      Date.now() + 6 * 60 * 60 * 1000,
    );
    assert.equal(res.status, 200);

    const event = bookingRepository.findById(booking.id)!.rescheduleHistory.at(-1)!;
    assert.equal(event.actingUserId, CUSTOMER_1);
    assert.equal(typeof event.timestamp, "number");
  } finally {
    await server.close();
  }
});

test("AC8: a booking that is not confirmed cannot be rescheduled", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
      status: "cancelled",
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(
      server.baseUrl,
      booking.id,
      accessToken,
      Date.now() + 5 * 60 * 60 * 1000,
      Date.now() + 6 * 60 * 60 * 1000,
    );
    assert.equal(res.status, 409);
  } finally {
    await server.close();
  }
});

test("AC9 & AC11: a slot taken by another booking before confirm is rejected and the customer is asked to pick a different slot", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const bookingA = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });
    const contestedStart = Date.now() + 5 * 60 * 60 * 1000;
    const contestedEnd = Date.now() + 6 * 60 * 60 * 1000;
    bookingRepository.create({
      customerId: CUSTOMER_2,
      providerId: PROVIDER_1,
      startTime: contestedStart,
      endTime: contestedEnd,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(server.baseUrl, bookingA.id, accessToken, contestedStart, contestedEnd);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /no longer available/i);
    assert.match(body.error, /choose a different|select a different/i);
  } finally {
    await server.close();
  }
});

test("AC10: the original booking remains unchanged when the target slot conflicts", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const originalStart = Date.now() + 2 * 60 * 60 * 1000;
    const originalEnd = Date.now() + 3 * 60 * 60 * 1000;
    const bookingA = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: originalStart,
      endTime: originalEnd,
    });
    const contestedStart = Date.now() + 5 * 60 * 60 * 1000;
    const contestedEnd = Date.now() + 6 * 60 * 60 * 1000;
    bookingRepository.create({
      customerId: CUSTOMER_2,
      providerId: PROVIDER_1,
      startTime: contestedStart,
      endTime: contestedEnd,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(server.baseUrl, bookingA.id, accessToken, contestedStart, contestedEnd);
    assert.equal(res.status, 409);

    const unchanged = bookingRepository.findById(bookingA.id)!;
    assert.equal(unchanged.startTime, originalStart);
    assert.equal(unchanged.endTime, originalEnd);
  } finally {
    await server.close();
  }
});

test("AC12: rescheduling a booking owned by a different customer is rejected without revealing existence", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const otherCustomerBooking = bookingRepository.create({
      customerId: CUSTOMER_2,
      providerId: PROVIDER_1,
      startTime: Date.now() + 2 * 60 * 60 * 1000,
      endTime: Date.now() + 3 * 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const newStart = Date.now() + 5 * 60 * 60 * 1000;
    const newEnd = Date.now() + 6 * 60 * 60 * 1000;

    const otherOwnerRes = await reschedule(server.baseUrl, otherCustomerBooking.id, accessToken, newStart, newEnd);
    assert.equal(otherOwnerRes.status, 404);
    const otherOwnerBody = await otherOwnerRes.json();

    const missingRes = await reschedule(server.baseUrl, "does-not-exist", accessToken, newStart, newEnd);
    assert.equal(missingRes.status, 404);
    const missingBody = await missingRes.json();

    assert.deepEqual(otherOwnerBody, missingBody);
  } finally {
    await server.close();
  }
});

test("AC13: a confirmed booking starting within the next hour can still be rescheduled", async () => {
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ bookingRepository });
  try {
    const booking = bookingRepository.create({
      customerId: CUSTOMER_1,
      providerId: PROVIDER_1,
      startTime: Date.now() + 30 * 60 * 1000,
      endTime: Date.now() + 60 * 60 * 1000,
    });
    const accessToken = await loginAs(server.baseUrl, "customer1");

    const res = await reschedule(
      server.baseUrl,
      booking.id,
      accessToken,
      Date.now() + 5 * 60 * 60 * 1000,
      Date.now() + 6 * 60 * 60 * 1000,
    );
    assert.equal(res.status, 200);
  } finally {
    await server.close();
  }
});
