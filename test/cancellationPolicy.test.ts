import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { issueAccessToken } from "../src/auth/tokenService.ts";
import { CancellationPolicyRepository } from "../src/cancellationPolicy/cancellationPolicyRepository.ts";
import { CancellationPolicyService } from "../src/cancellationPolicy/cancellationPolicyService.ts";

test("AC1: a saved threshold is applied to subsequent cancellation evaluations", async () => {
  const cancellationPolicyRepository = new CancellationPolicyRepository();
  const server = await startTestServer({ cancellationPolicyRepository });
  try {
    const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
    const res = await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        tiers: [{ label: "Free cancellation", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: null, outcome: "full_refund" }],
      }),
    });
    assert.equal(res.status, 201);

    const service = new CancellationPolicyService(cancellationPolicyRepository);
    const appointmentTime = Date.parse("2026-01-10T12:00:00Z");
    const cancellationTime = Date.parse("2026-01-09T10:00:00Z"); // 26h before
    const evaluation = service.evaluateCancellation(appointmentTime, cancellationTime);
    assert.equal(evaluation.outcome, "full_refund");
    assert.notEqual(evaluation.tierId, null);
  } finally {
    await server.close();
  }
});

test("AC5: an unconfigured policy is surfaced to the administrator viewing settings", async () => {
  const server = await startTestServer();
  try {
    const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
    const res = await fetch(`${server.baseUrl}/cancellation-policy`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { configured: boolean; tiers: unknown[] };
    assert.equal(body.configured, false);
    assert.deepEqual(body.tiers, []);
  } finally {
    await server.close();
  }
});

test("AC6: a removed tier no longer governs evaluation after removal", async () => {
  const repo = new CancellationPolicyRepository();
  const server = await startTestServer({ cancellationPolicyRepository: repo });
  try {
    const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
    await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tiers: [{ label: "None", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 24, outcome: "no_refund" }] }),
    });
    const tierId = repo.getAll()[0].id;
    const service = new CancellationPolicyService(repo);
    const appointmentTime = Date.parse("2026-01-10T12:00:00Z");
    const cancellationTime = Date.parse("2026-01-10T06:00:00Z"); // 6h before

    assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "no_refund");

    const deleteRes = await fetch(`${server.baseUrl}/cancellation-policy/tiers/${tierId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteRes.status, 204);
    assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "full_refund");
  } finally {
    await server.close();
  }
});

test("AC7: overlapping tier windows are rejected and not persisted", async () => {
  const repo = new CancellationPolicyRepository();
  const server = await startTestServer({ cancellationPolicyRepository: repo });
  try {
    const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
    await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tiers: [{ label: "Full", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: null, outcome: "full_refund" }] }),
    });

    const res = await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        tiers: [{ label: "Partial", minHoursBeforeAppointment: 12, maxHoursBeforeAppointment: 36, outcome: "partial_refund", refundPercentage: 50 }],
      }),
    });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /overlap/i);
    assert.equal(repo.getAll().length, 1);
  } finally {
    await server.close();
  }
});

test("AC8: non-overlapping tier windows are saved successfully", async () => {
  const repo = new CancellationPolicyRepository();
  const server = await startTestServer({ cancellationPolicyRepository: repo });
  try {
    const adminToken = issueAccessToken({ userId: "user-admin-1", role: "admin" });
    await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tiers: [{ label: "Full", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: null, outcome: "full_refund" }] }),
    });
    const res = await fetch(`${server.baseUrl}/cancellation-policy/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tiers: [{ label: "None", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 24, outcome: "no_refund" }] }),
    });
    assert.equal(res.status, 201);
    assert.equal(repo.getAll().length, 2);
  } finally {
    await server.close();
  }
});
