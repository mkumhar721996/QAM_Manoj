export const FREE_CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CancellationOutcome = "full_refund" | "no_refund";

export interface CancellationPolicyResult {
  withinFreeWindow: boolean;
  outcome: CancellationOutcome;
}

export function evaluateCancellationPolicy(
  appointmentAt: number,
  now: number = Date.now(),
  freeCancellationWindowMs: number = FREE_CANCELLATION_WINDOW_MS,
): CancellationPolicyResult {
  const withinFreeWindow = appointmentAt - now >= freeCancellationWindowMs;
  return { withinFreeWindow, outcome: withinFreeWindow ? "full_refund" : "no_refund" };
}
