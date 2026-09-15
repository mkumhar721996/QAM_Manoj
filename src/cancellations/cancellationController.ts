import type { ControllerResponse } from "../auth/authController.ts";
import { extractBearerPayload } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { CancellationPaymentService } from "./cancellationPaymentService.ts";
import { InvalidCancellationEventError } from "./cancellationPaymentService.ts";

export async function handleCancellationEvent(
  service: CancellationPaymentService,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): Promise<ControllerResponse> {
  const authPayload = extractBearerPayload(authorizationHeader);
  if (!authPayload) {
    return { status: 401, body: { error: "missing or invalid authorization" } };
  }
  if (authPayload.role !== "admin") {
    return { status: 403, body: { error: "caller is not authorized to execute cancellation payments" } };
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
    console.error(
      `cancellation payment failed for bookingId=${bookingId} outcome=${outcome} ` +
        `refundAmountCents=${refundAmountCents} nonRefundableAmountCents=${nonRefundableAmountCents}:`,
      err,
    );
    throw err;
  }
}
