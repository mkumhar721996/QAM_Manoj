import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import type { TestServer } from "./testServer.ts";
import { TEST_PASSWORD } from "../src/users/fixtures/testUsers.ts";
import { SlotRepository } from "../src/bookings/slotRepository.ts";
import { HoldRepository } from "../src/bookings/holdRepository.ts";
import { BookingRepository } from "../src/bookings/bookingRepository.ts";

const HOLD_TTL_MS = 10 * 60 * 1000;

async function loginAs(server: TestServer, username: string): Promise<string> {
  const res = await fetch(`${server.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function setupConfirmedBooking(server: TestServer, holdRepository: HoldRepository, slotRepository: SlotRepository) {
  const slot = slotRepository.create({
    id: "slot-1",
    providerId: "user-provider-1",
    providerName: "provider1",
    date: "2026-09-21",
    time: "09:00",
    status: "held",
  });
  const hold = holdRepository.create(slot.id, "user-customer-1", HOLD_TTL_MS);

  await fetch(`${server.baseUrl}/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hold_id: hold.id }),
  });
}

test("AC3: the customer sees their confirmed booking with provider name, date, time, and status", async () => {
  const slotRepository = new SlotRepository();
  const holdRepository = new HoldRepository();
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ slotRepository, holdRepository, bookingRepository });
  try {
    await setupConfirmedBooking(server, holdRepository, slotRepository);
    const accessToken = await loginAs(server, "customer1");

    const res = await fetch(`${server.baseUrl}/bookings/mine`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      bookings: Array<{ provider_name: string; date: string; time: string; status: string }>;
    };
    const [booking] = body.bookings;
    assert.equal(booking.provider_name, "provider1");
    assert.equal(booking.date, "2026-09-21");
    assert.equal(booking.time, "09:00");
    assert.equal(booking.status, "confirmed");
  } finally {
    await server.close();
  }
});

test("AC4: the provider sees the confirmed booking with customer name, date, time, and status", async () => {
  const slotRepository = new SlotRepository();
  const holdRepository = new HoldRepository();
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ slotRepository, holdRepository, bookingRepository });
  try {
    await setupConfirmedBooking(server, holdRepository, slotRepository);
    const accessToken = await loginAs(server, "provider1");

    const res = await fetch(`${server.baseUrl}/schedule/mine`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      bookings: Array<{ customer_name: string; date: string; time: string; status: string }>;
    };
    const [booking] = body.bookings;
    assert.equal(booking.customer_name, "customer1");
    assert.equal(booking.date, "2026-09-21");
    assert.equal(booking.time, "09:00");
    assert.equal(booking.status, "confirmed");
  } finally {
    await server.close();
  }
});
