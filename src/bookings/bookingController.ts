import type { BookingService } from "./bookingService.ts";
import { HoldExpiredError, HoldNotFoundError } from "./bookingService.ts";
import type { Booking } from "./bookingModel.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord, extractBearerToken } from "../httpUtils.ts";
import type { ControllerResponse } from "../httpUtils.ts";

export async function handleConfirmBooking(
  bookingService: BookingService,
  requestBody: unknown,
  authorizationHeader: string | undefined,
  now: number = Date.now(),
): Promise<ControllerResponse> {
  const payload = verifyAccessToken(extractBearerToken(authorizationHeader) ?? "", now);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid access token" } };
  }

  const { hold_id: holdId } = asRecord(requestBody);
  if (typeof holdId !== "string") {
    return { status: 400, body: { error: "hold_id is required" } };
  }

  console.log(`booking confirmation requested for holdId=${holdId} customerId=${payload.userId}`);

  try {
    const booking = bookingService.confirmHold(holdId, payload.userId, now);
    console.log(`booking confirmation succeeded: bookingId=${booking.id} holdId=${holdId} customerId=${payload.userId}`);
    return { status: 201, body: { booking: toBookingResponse(booking) } };
  } catch (err) {
    if (err instanceof HoldExpiredError) {
      console.warn(`booking confirmation failed for holdId=${holdId}: ${err.message}`);
      return { status: 409, body: { error: err.message } };
    }
    if (err instanceof HoldNotFoundError) {
      console.warn(`booking confirmation failed for holdId=${holdId}: ${err.message}`);
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
  console.log(`fetched ${bookings.length} bookings for customerId=${payload.userId}`);
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
  console.log(`fetched ${bookings.length} scheduled bookings for providerId=${payload.userId}`);
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
