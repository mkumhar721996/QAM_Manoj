import type { RescheduleService } from "./rescheduleService.ts";
import { BookingNotFoundError, BookingNotReschedulableError, SlotUnavailableError } from "./rescheduleService.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { ControllerResponse } from "../auth/authController.ts";

export function handleReschedule(
  rescheduleService: RescheduleService,
  authorizationHeader: string | undefined,
  bookingId: string,
  requestBody: unknown,
  now: number = Date.now(),
): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  const payload = token ? verifyAccessToken(token, now) : null;

  if (!payload) {
    console.warn("reschedule failed: missing or invalid authorization header");
    return { status: 401, body: { error: "authentication required, please log in" } };
  }

  const { new_start_time: newStartTime, new_end_time: newEndTime } = asRecord(requestBody);
  if (typeof newStartTime !== "number" || typeof newEndTime !== "number") {
    return { status: 400, body: { error: "new_start_time and new_end_time are required" } };
  }
  if (newStartTime >= newEndTime) {
    return { status: 400, body: { error: "new_end_time must be after new_start_time" } };
  }

  try {
    const booking = rescheduleService.reschedule(bookingId, payload.userId, newStartTime, newEndTime, now);
    console.log(`reschedule succeeded for bookingId=${bookingId} by userId=${payload.userId}`);
    return {
      status: 200,
      body: {
        id: booking.id,
        start_time: booking.startTime,
        end_time: booking.endTime,
        status: booking.status,
        cancellation_policy_window_start: booking.cancellationPolicyWindowStart,
      },
    };
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      console.warn(`reschedule failed: bookingId=${bookingId} not found or not owned by userId=${payload.userId}`);
      return { status: 404, body: { error: "booking not found" } };
    }
    if (err instanceof BookingNotReschedulableError) {
      console.warn(`reschedule failed: bookingId=${bookingId} is not confirmed`);
      return { status: 409, body: { error: err.message } };
    }
    if (err instanceof SlotUnavailableError) {
      console.warn(`reschedule failed: bookingId=${bookingId} target slot unavailable`);
      return { status: 409, body: { error: err.message } };
    }
    throw err;
  }
}
