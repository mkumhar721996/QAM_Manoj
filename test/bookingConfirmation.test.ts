import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { SlotRepository } from "../src/bookings/slotRepository.ts";
import { HoldRepository } from "../src/bookings/holdRepository.ts";
import { BookingRepository } from "../src/bookings/bookingRepository.ts";
import type { Slot } from "../src/bookings/slotModel.ts";

const HOLD_TTL_MS = 10 * 60 * 1000;

function seedHeldSlot(slotRepository: SlotRepository): Slot {
  return slotRepository.create({
    id: "slot-1",
    providerId: "user-provider-1",
    providerName: "provider1",
    date: "2026-09-21",
    time: "09:00",
    status: "held",
  });
}

test("AC1 & AC2: confirming a valid hold creates a confirmed booking and marks the slot as booked", async () => {
  const slotRepository = new SlotRepository();
  const holdRepository = new HoldRepository();
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ slotRepository, holdRepository, bookingRepository });
  try {
    const slot = seedHeldSlot(slotRepository);
    const hold = holdRepository.create(slot.id, "user-customer-1", HOLD_TTL_MS);

    const res = await fetch(`${server.baseUrl}/bookings/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hold_id: hold.id }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { booking: { status: string } };
    assert.equal(body.booking.status, "confirmed");
    assert.equal(bookingRepository.findByCustomerId("user-customer-1").length, 1);
    assert.equal(slotRepository.findById(slot.id)!.status, "booked");
  } finally {
    await server.close();
  }
});

test("AC5, AC6 & AC7: confirming an expired hold is rejected, the slot is released, and the customer is told to select a new slot", async () => {
  const slotRepository = new SlotRepository();
  const holdRepository = new HoldRepository();
  const bookingRepository = new BookingRepository();
  const server = await startTestServer({ slotRepository, holdRepository, bookingRepository });
  try {
    const slot = seedHeldSlot(slotRepository);
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const hold = holdRepository.create(slot.id, "user-customer-1", HOLD_TTL_MS, elevenMinutesAgo);

    const res = await fetch(`${server.baseUrl}/bookings/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hold_id: hold.id }),
    });

    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /select a new slot/i);
    assert.equal(bookingRepository.findByCustomerId("user-customer-1").length, 0);
    assert.equal(slotRepository.findById(slot.id)!.status, "available");
  } finally {
    await server.close();
  }
});
