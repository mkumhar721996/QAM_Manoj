export const CANCELLATION_POLICY_WINDOW_HOURS = 24;

export function computeCancellationWindowStart(
  appointmentStartTime: number,
  windowHours: number = CANCELLATION_POLICY_WINDOW_HOURS,
): number {
  return appointmentStartTime - windowHours * 60 * 60 * 1000;
}
