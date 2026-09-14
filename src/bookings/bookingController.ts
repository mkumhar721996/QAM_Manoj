import type { BookingService } from "./bookingService.ts";
import { HoldExpiredError, HoldNotFoundError } from "./bookingService.ts";
import type { Booking } from "./bookingModel.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord, extractBearerToken } from "../httpUtils.ts";
import type { ControllerResponse } from "../auth/authController.ts";

export async function handleConfirmBooking(
  bookingService: BookingService,
  requestBody: unknown,
): Promise<ControllerResponse> {
  const { hold_id: holdId } = asRecord(requestBody);
  if (typeof holdId !== "string") {
    return { status: 400, body: { error: "hold_id is required" } };
  }

  try {
    const booking = bookingService.confirmHold(holdId);
    return { status: 201, body: { booking: toBookingResponse(booking) } };
  } catch (err) {
    if (err instanceof HoldExpiredError) {
      return { status: 409, body: { error: err.message } };
    }
    if (err instanceof HoldNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleGetCustomerBookings(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): ControllerResponse {
  const payload = verifyAccessToken(extractBearerToken(authorizationHeader) ?? "", now);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid access token" } };
  }
  const bookings = bookingService.getBookingsForCustomer(payload.userId);
  return { status: 200, body: { bookings: bookings.map(toBookingResponse) } };
}

export function handleGetProviderSchedule(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): ControllerResponse {
  const payload = verifyAccessToken(extractBearerToken(authorizationHeader) ?? "", now);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid access token" } };
  }
  const bookings = bookingService.getScheduleForProvider(payload.userId);
  return { status: 200, body: { bookings: bookings.map(toBookingResponse) } };
}

function toBookingResponse(booking: Booking): Record<string, unknown> {
  return {
    id: booking.id,
    provider_name: booking.providerName,
    customer_name: booking.customerName,
    date: booking.date,
    time: booking.time,
    status: booking.status,
  };
}
