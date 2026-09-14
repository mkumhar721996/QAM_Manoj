import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { issueAccessToken } from "../src/auth/tokenService.ts";
import { SlotRepository } from "../src/scheduling/slotRepository.ts";
import { ProviderRepository } from "../src/providers/providerRepository.ts";
import { HoldConfigRepository } from "../src/scheduling/holdConfigRepository.ts";
import { SlotService } from "../src/scheduling/slotService.ts";

test("AC2: selecting a slot holds it for the default 10-minute window", async () => {
  const server = await startTestServer();
  try {
    const now = Date.now();
    const token = issueAccessToken({ userId: "user-customer-1", role: "customer" });
    const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { slot: { holdExpiresAt: number } };
    assert.ok(Math.abs(body.slot.holdExpiresAt - (now + 10 * 60 * 1000)) < 1000);
  } finally {
    await server.close();
  }
});

test("AC4: an expired hold automatically releases the slot", () => {
  const slotRepository = new SlotRepository();
  const slotService = new SlotService(slotRepository, new ProviderRepository(), new HoldConfigRepository());
  const now = Date.now();
  slotService.holdSlot("provider-approved-1", "slot-1", "user-customer-1", now);
  const elevenMinutesLater = now + 11 * 60 * 1000;
  const available = slotService.listAvailableSlots("provider-approved-1", elevenMinutesLater);
  assert.ok(available.some((s) => s.id === "slot-1"));
});

test("AC5: a second customer selecting a held slot is told it is unavailable", async () => {
  const server = await startTestServer();
  try {
    const tokenA = issueAccessToken({ userId: "user-customer-1", role: "customer" });
    const tokenB = issueAccessToken({ userId: "user-customer-2", role: "customer" });
    await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(res.status, 409);
  } finally {
    await server.close();
  }
});

test("AC6: the unavailable response prompts choosing a different time", async () => {
  const server = await startTestServer();
  try {
    const tokenA = issueAccessToken({ userId: "user-customer-1", role: "customer" });
    const tokenB = issueAccessToken({ userId: "user-customer-2", role: "customer" });
    await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "This slot is no longer available. Please choose a different time.");
  } finally {
    await server.close();
  }
});

test("AC7: a changed hold duration applies to new holds", async () => {
  const holdConfigRepository = new HoldConfigRepository();
  const server = await startTestServer({ holdConfigRepository });
  try {
    holdConfigRepository.setHoldDurationMs(5 * 60 * 1000);
    const now = Date.now();
    const token = issueAccessToken({ userId: "user-customer-1", role: "customer" });
    const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-2/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { slot: { holdExpiresAt: number } };
    assert.ok(Math.abs(body.slot.holdExpiresAt - (now + 5 * 60 * 1000)) < 1000);
  } finally {
    await server.close();
  }
});
