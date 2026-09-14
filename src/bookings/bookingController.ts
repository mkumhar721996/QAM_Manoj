import type { BookingService } from "./bookingService.ts";
import { BookingNotCancellableError, BookingNotFoundError } from "./bookingService.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import type { ControllerResponse } from "../auth/authController.ts";

export function handleCancelBooking(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
  bookingId: string,
  now: number = Date.now(),
): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  const payload = token ? verifyAccessToken(token, now) : null;

  if (!payload) {
    console.warn("cancel booking failed: missing or invalid authorization header");
    return { status: 401, body: { error: "Authentication required. Please log in to cancel this booking." } };
  }

  try {
    const result = bookingService.cancelBooking(bookingId, payload.userId, now);
    return {
      status: 200,
      body: {
        booking_id: result.booking.id,
        status: result.booking.status,
        cancelled_at: result.booking.cancelledAt,
        outcome: result.outcome,
      },
    };
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    if (err instanceof BookingNotCancellableError) {
      return { status: 409, body: { error: err.message } };
    }
    throw err;
  }
}
