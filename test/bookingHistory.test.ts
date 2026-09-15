import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { BookingRepository, BookingDeletionNotAllowedError } from "../src/bookings/bookingRepository.ts";

async function login(baseUrl: string, username: string): Promise<{ access_token: string }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  return (await res.json()) as { access_token: string };
}

test("BookingRepository.delete always throws and never removes a record", () => {
  const repo = new BookingRepository();
  assert.throws(() => repo.delete("booking-1"), BookingDeletionNotAllowedError);
  assert.ok(repo.findById("booking-1"), "booking-1 must still exist after the rejected delete");
});

test("AC1: customer sees final status, appointment time, and provider details", async () => {
  const server = await startTestServer();
  try {
    const { access_token } = await login(server.baseUrl, "customer1");
    const res = await fetch(`${server.baseUrl}/bookings/customer/history`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { bookings: Array<Record<string, unknown>> };
    const completed = body.bookings.find((b) => b.id === "booking-1");
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.appointment_time, Date.parse("2024-03-10T14:00:00Z"));
    assert.deepEqual(completed?.provider, { id: "user-provider-1", username: "provider1" });
  } finally {
    await server.close();
  }
});

test("AC2: provider sees final status, appointment time, and customer details", async () => {
  const server = await startTestServer();
  try {
    const { access_token } = await login(server.baseUrl, "provider1");
    const res = await fetch(`${server.baseUrl}/bookings/provider/history`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { bookings: Array<Record<string, unknown>> };
    const completed = body.bookings.find((b) => b.id === "booking-1");
    assert.equal(completed?.status, "completed");
    assert.deepEqual(completed?.customer, { id: "user-customer-1", username: "customer1" });
  } finally {
    await server.close();
  }
});

test("AC3: bookings remain in history regardless of how long ago they occurred", async () => {
  const server = await startTestServer();
  try {
    const { access_token } = await login(server.baseUrl, "customer1");
    const res = await fetch(`${server.baseUrl}/bookings/customer/history`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const body = (await res.json()) as { bookings: Array<{ id: string }> };
    assert.ok(
      body.bookings.some((b) => b.id === "booking-old"),
      "expected a multi-year-old booking to still appear in history",
    );
  } finally {
    await server.close();
  }
});

test("AC4: deleting or purging a booking is rejected and the record is retained", async () => {
  const server = await startTestServer();
  try {
    const { access_token } = await login(server.baseUrl, "customer1");
    const delRes = await fetch(`${server.baseUrl}/bookings/booking-1`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access_token}` },
    });
    assert.equal(delRes.status, 405);

    const getRes = await fetch(`${server.baseUrl}/bookings/booking-1`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    assert.equal(getRes.status, 200);
  } finally {
    await server.close();
  }
});

test("AC5: a booking belonging to a different customer/provider is not visible", async () => {
  const server = await startTestServer();
  try {
    const { access_token } = await login(server.baseUrl, "customer1");
    const directRes = await fetch(`${server.baseUrl}/bookings/booking-3`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    assert.equal(directRes.status, 404);

    const historyRes = await fetch(`${server.baseUrl}/bookings/customer/history`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const historyBody = (await historyRes.json()) as { bookings: Array<{ id: string }> };
    assert.ok(!historyBody.bookings.some((b) => b.id === "booking-3"));
  } finally {
    await server.close();
  }
});
