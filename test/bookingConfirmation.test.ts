import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { BookingRepository } from "../src/booking/bookingRepository.ts";
import type { PaymentAuthorization, PaymentGateway } from "../src/payments/paymentGateway.ts";

class FakeGateway implements PaymentGateway {
  authorizeCalls: Array<{ paymentToken: string; amount: number; currency: string }> = [];
  captureCalls: string[] = [];

  async authorize(paymentToken: string, amount: number, currency: string): Promise<PaymentAuthorization> {
    this.authorizeCalls.push({ paymentToken, amount, currency });
    return { paymentIntentId: "pi_test_123" };
  }

  async capture(paymentIntentId: string): Promise<void> {
    this.captureCalls.push(paymentIntentId);
  }
}

async function login(baseUrl: string, username: string = "customer1"): Promise<{ access_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string };
}

function confirmBooking(
  baseUrl: string,
  accessToken: string,
  bookingId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/bookings/${bookingId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

test("AC1: a confirmation request containing raw card data is rejected before any gateway call", async () => {
  const bookingRepository = new BookingRepository();
  const fakeGateway = new FakeGateway();
  const server = await startTestServer({ bookingRepository, paymentGateway: fakeGateway });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const booking = bookingRepository.create({ customerId: "user-customer-1", amount: 2500, currency: "usd" });

    const res = await confirmBooking(server.baseUrl, accessToken, booking.id, {
      card_number: "4242424242424242",
      cvv: "123",
    });

    assert.equal(res.status, 400);
    assert.equal(fakeGateway.authorizeCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("AC1: a confirmation request with only a payment token is accepted and forwarded to the gateway verbatim", async () => {
  const bookingRepository = new BookingRepository();
  const fakeGateway = new FakeGateway();
  const server = await startTestServer({ bookingRepository, paymentGateway: fakeGateway });
  try {
    const { access_token: accessToken } = await login(server.baseUrl);
    const booking = bookingRepository.create({ customerId: "user-customer-1", amount: 2500, currency: "usd" });

    const res = await confirmBooking(server.baseUrl, accessToken, booking.id, { payment_token: "tok_visa" });

    assert.equal(res.status, 200);
    assert.equal(fakeGateway.authorizeCalls[0].paymentToken, "tok_visa");
  } finally {
    await server.close();
  }
});

test("a caller who does not own the booking is forbidden from confirming it, and no charge is attempted", async () => {
  const bookingRepository = new BookingRepository();
  const fakeGateway = new FakeGateway();
  const server = await startTestServer({ bookingRepository, paymentGateway: fakeGateway });
  try {
    const { access_token: otherUsersAccessToken } = await login(server.baseUrl, "provider1");
    const booking = bookingRepository.create({ customerId: "user-customer-1", amount: 2500, currency: "usd" });

    const res = await confirmBooking(server.baseUrl, otherUsersAccessToken, booking.id, { payment_token: "tok_visa" });

    assert.equal(res.status, 403);
    assert.equal(fakeGateway.authorizeCalls.length, 0);
    assert.equal(bookingRepository.findById(booking.id)?.status, "awaiting_confirmation");
  } finally {
    await server.close();
  }
});
