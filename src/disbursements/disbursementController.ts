import type { ControllerResponse } from "../auth/authController.ts";
import { verifyAccessToken } from "../auth/tokenService.ts";
import { asRecord } from "../httpUtils.ts";
import type { ConfigRepository } from "./configRepository.ts";
import type { DisbursementService } from "./disbursementService.ts";

export function handleServiceCompletedWebhook(
  disbursementService: DisbursementService,
  requestBody: unknown,
): ControllerResponse {
  const { booking_id: bookingId, provider_id: providerId, total_amount: totalAmount } = asRecord(requestBody);
  if (typeof bookingId !== "string" || typeof providerId !== "string" || typeof totalAmount !== "number") {
    return { status: 400, body: { error: "booking_id, provider_id, and total_amount are required" } };
  }
  disbursementService.handleServiceCompleted(bookingId, providerId, totalAmount);
  return { status: 202 };
}

export function handleStripeDisputeWebhook(
  disbursementService: DisbursementService,
  requestBody: unknown,
): ControllerResponse {
  const { type, booking_id: bookingId } = asRecord(requestBody);
  if (type !== "charge.dispute.created" || typeof bookingId !== "string") {
    return { status: 400, body: { error: "type must be charge.dispute.created and booking_id is required" } };
  }
  disbursementService.handleDisputeCreated(bookingId);
  return { status: 200 };
}

export function handleUpdateServiceFeeRate(
  configRepository: ConfigRepository,
  authorizationHeader: string | undefined,
  requestBody: unknown,
): ControllerResponse {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : undefined;
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload || payload.role !== "admin") {
    return { status: 403, body: { error: "admin role required" } };
  }
  const { rate } = asRecord(requestBody);
  if (typeof rate !== "number" || rate < 0 || rate > 1) {
    return { status: 400, body: { error: "rate must be a number between 0 and 1" } };
  }
  configRepository.setServiceFeeRate(rate);
  return { status: 200, body: { rate } };
}
