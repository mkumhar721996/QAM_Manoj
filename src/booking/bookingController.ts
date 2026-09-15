import type { ControllerResponse } from "../auth/authController.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import { BookingNotFoundError, BookingOwnershipError } from "../payments/paymentService.ts";
import type { PaymentService } from "../payments/paymentService.ts";

const RAW_CARD_DATA_FIELDS = ["card_number", "cvc", "cvv", "expiry_month", "expiry_year"];

function extractBearerPayload(authorizationHeader: string | undefined) {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  return token ? verifyAccessToken(token) : null;
}

export async function handleConfirmBooking(
  paymentService: PaymentService,
  authorizationHeader: string | undefined,
  bookingId: string,
  requestBody: unknown,
): Promise<ControllerResponse> {
  const payload = extractBearerPayload(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const body = asRecord(requestBody);
  if (RAW_CARD_DATA_FIELDS.some((field) => field in body)) {
    return { status: 400, body: { error: "raw card data must never be sent to the platform" } };
  }

  const { payment_token: paymentToken } = body;
  if (typeof paymentToken !== "string") {
    return { status: 400, body: { error: "payment_token is required" } };
  }

  try {
    const booking = await paymentService.confirmBooking(bookingId, paymentToken, payload.userId);
    return { status: 200, body: { id: booking.id, status: booking.status } };
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    if (err instanceof BookingOwnershipError) {
      return { status: 403, body: { error: "you do not have permission to confirm this booking" } };
    }
    throw err;
  }
}
