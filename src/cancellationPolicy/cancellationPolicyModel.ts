export type CancellationOutcome = "full_refund" | "partial_refund" | "no_refund";

export interface CancellationPolicyTier {
  id: string;
  label: string;
  minHoursBeforeAppointment: number;
  maxHoursBeforeAppointment: number | null;
  outcome: CancellationOutcome;
  refundPercentage?: number;
}

export type CancellationPolicyTierInput = Omit<CancellationPolicyTier, "id">;

export function tiersOverlap(
  a: Pick<CancellationPolicyTier, "minHoursBeforeAppointment" | "maxHoursBeforeAppointment">,
  b: Pick<CancellationPolicyTier, "minHoursBeforeAppointment" | "maxHoursBeforeAppointment">,
): boolean {
  const aMax = a.maxHoursBeforeAppointment ?? Infinity;
  const bMax = b.maxHoursBeforeAppointment ?? Infinity;
  return a.minHoursBeforeAppointment < bMax && b.minHoursBeforeAppointment < aMax;
}
