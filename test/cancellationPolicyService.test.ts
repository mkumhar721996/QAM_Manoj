import { test } from "node:test";
import assert from "node:assert/strict";
import { CancellationPolicyRepository } from "../src/cancellationPolicy/cancellationPolicyRepository.ts";
import { CancellationPolicyService } from "../src/cancellationPolicy/cancellationPolicyService.ts";

test("AC2: an updated threshold governs evaluation, not the threshold at booking time", () => {
  const service = new CancellationPolicyService(new CancellationPolicyRepository());
  service.addTiers([
    { label: "Free", minHoursBeforeAppointment: 48, maxHoursBeforeAppointment: null, outcome: "full_refund" },
    { label: "Late", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 48, outcome: "no_refund" },
  ]);
  const appointmentTime = Date.parse("2026-01-10T12:00:00Z");
  const cancellationTime = Date.parse("2026-01-09T12:00:00Z"); // 24h before

  assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "no_refund");

  for (const tier of service.getPolicy().tiers) service.removeTier(tier.id);
  service.addTiers([
    { label: "Free", minHoursBeforeAppointment: 12, maxHoursBeforeAppointment: null, outcome: "full_refund" },
    { label: "Late", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 12, outcome: "no_refund" },
  ]);

  assert.equal(service.evaluateCancellation(appointmentTime, cancellationTime).outcome, "full_refund");
});

test("AC3: the tier whose window matches the cancellation timing is applied", () => {
  const service = new CancellationPolicyService(new CancellationPolicyRepository());
  service.addTiers([
    { label: "Full", minHoursBeforeAppointment: 72, maxHoursBeforeAppointment: null, outcome: "full_refund" },
    { label: "Partial", minHoursBeforeAppointment: 24, maxHoursBeforeAppointment: 72, outcome: "partial_refund", refundPercentage: 50 },
    { label: "None", minHoursBeforeAppointment: 0, maxHoursBeforeAppointment: 24, outcome: "no_refund" },
  ]);
  const appointmentTime = Date.parse("2026-01-10T12:00:00Z");

  assert.equal(service.evaluateCancellation(appointmentTime, Date.parse("2026-01-06T12:00:00Z")).outcome, "full_refund");
  const partial = service.evaluateCancellation(appointmentTime, Date.parse("2026-01-09T00:00:00Z"));
  assert.equal(partial.outcome, "partial_refund");
  assert.equal(partial.refundPercentage, 50);
  assert.equal(service.evaluateCancellation(appointmentTime, Date.parse("2026-01-10T06:00:00Z")).outcome, "no_refund");
});

test("AC4: an unconfigured policy defaults to a full refund on evaluation", () => {
  const service = new CancellationPolicyService(new CancellationPolicyRepository());
  const result = service.evaluateCancellation(Date.parse("2026-01-10T12:00:00Z"), Date.parse("2026-01-10T06:00:00Z"));
  assert.equal(result.outcome, "full_refund");
  assert.equal(result.tierId, null);
});
