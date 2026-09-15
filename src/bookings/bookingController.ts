import type { ControllerResponse } from "../auth/authController.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { BookingDeletionNotAllowedError } from "./bookingRepository.ts";
import type { BookingService, BookingHistoryEntry } from "./bookingService.ts";

function extractBearerPayload(authorizationHeader: string | undefined) {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  return token ? verifyAccessToken(token) : null;
}

function toJson(entry: BookingHistoryEntry, counterpartyKey: "provider" | "customer") {
  return {
    id: entry.id,
    status: entry.status,
    appointment_time: entry.appointmentTime,
    [counterpartyKey]: entry.counterparty,
  };
}

export function handleGetCustomerBookingHistory(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
  if (payload.role !== "customer") return { status: 403, body: { error: "customer role required" } };
  const bookings = bookingService.getCustomerHistory(payload.userId).map((e) => toJson(e, "provider"));
  return { status: 200, body: { bookings } };
}

export function handleGetProviderBookingHistory(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
  if (payload.role !== "provider") return { status: 403, body: { error: "provider role required" } };
  const bookings = bookingService.getProviderHistory(payload.userId).map((e) => toJson(e, "customer"));
  return { status: 200, body: { bookings } };
}

export function handleGetBooking(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
  bookingId: string,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
  const entry = bookingService.getBookingForRequester(payload.userId, bookingId);
  if (!entry) return { status: 404, body: { error: "booking not found" } };
  const counterpartyKey = payload.role === "provider" ? "customer" : "provider";
  return { status: 200, body: toJson(entry, counterpartyKey) };
}

export function handleDeleteBooking(
  bookingService: BookingService,
  authorizationHeader: string | undefined,
  bookingId: string,
): ControllerResponse {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) return { status: 401, body: { error: "missing or invalid authorization" } };
  try {
    bookingService.deleteBooking(bookingId);
  } catch (err) {
    if (err instanceof BookingDeletionNotAllowedError) {
      return { status: 405, body: { error: err.message } };
    }
    throw err;
  }
  return { status: 200 };
}
