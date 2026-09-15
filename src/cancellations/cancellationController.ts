import type { ControllerResponse } from "../auth/authController.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { CancellationPaymentService } from "./cancellationPaymentService.ts";
import { InvalidCancellationEventError } from "./cancellationPaymentService.ts";

function extractBearerPayload(authorizationHeader: string | undefined) {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  return token ? verifyAccessToken(token) : null;
}

export async function handleCancellationEvent(
  service: CancellationPaymentService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): Promise<ControllerResponse> {
  if (!extractBearerPayload(authorizationHeader)) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }

  const {
    booking_id: bookingId,
    actor_id: actorId,
    outcome,
    payment_intent_id: paymentIntentId,
    provider_id: providerId,
    refund_amount_cents: refundAmountCents,
    non_refundable_amount_cents: nonRefundableAmountCents,
    service_fee_cents: serviceFeeCents,
  } = asRecord(requestBody);

  if (
    typeof bookingId !== "string" ||
    typeof actorId !== "string" ||
    (outcome !== "full_refund" && outcome !== "partial_refund") ||
    typeof paymentIntentId !== "string" ||
    typeof refundAmountCents !== "number" ||
    typeof nonRefundableAmountCents !== "number" ||
    typeof serviceFeeCents !== "number" ||
    (providerId !== undefined && typeof providerId !== "string") ||
    refundAmountCents < 0 ||
    nonRefundableAmountCents < 0 ||
    serviceFeeCents < 0
  ) {
    return { status: 400, body: { error: "invalid cancellation event payload" } };
  }

  try {
    const result = await service.processCancellation({
      bookingId,
      actorId,
      outcome,
      paymentIntentId,
      providerId,
      refundAmountCents,
      nonRefundableAmountCents,
      serviceFeeCents,
    });
    console.log(`cancellation processed for bookingId=${bookingId} outcome=${outcome}`);
    return {
      status: 200,
      body: {
        refund_id: result.refundId,
        refund_amount_cents: result.refundAmountCents,
        disbursement_id: result.disbursementId,
        disbursement_amount_cents: result.disbursementAmountCents,
      },
    };
  } catch (err) {
    if (err instanceof InvalidCancellationEventError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}
