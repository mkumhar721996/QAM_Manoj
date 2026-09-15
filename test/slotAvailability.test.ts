import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { issueAccessToken } from "../src/auth/tokenService.ts";

test("AC1: only slots that are not confirmed or held are shown", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { slots: Array<{ id: string }> };
    assert.deepEqual(
      body.slots.map((s) => s.id).sort(),
      ["slot-1", "slot-2"],
    );
  } finally {
    await server.close();
  }
});

test("AC3: a held slot is no longer shown as available", async () => {
  const server = await startTestServer();
  try {
    const token = issueAccessToken({ userId: "user-customer-1", role: "customer" });
    await fetch(`${server.baseUrl}/providers/provider-approved-1/slots/slot-1/hold`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await fetch(`${server.baseUrl}/providers/provider-approved-1/slots`);
    const body = (await res.json()) as { slots: Array<{ id: string }> };
    assert.equal(
      body.slots.some((s) => s.id === "slot-1"),
      false,
    );
  } finally {
    await server.close();
  }
});

test("AC8: an unapproved provider's schedule shows no slots", async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/providers/provider-pending-1/slots`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { slots: unknown[] };
    assert.deepEqual(body.slots, []);
  } finally {
    await server.close();
  }
});
