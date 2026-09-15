import type { ControllerResponse } from "../auth/authController.ts";
import { asRecord } from "../httpUtils.ts";
import { ChargebackService, TransactionNotFoundError } from "./chargebackService.ts";
import type { ChargebackWebhookEvent } from "./paymentsModel.ts";
import { verifyStripeSignature } from "./stripeSignatureVerifier.ts";

export function handleChargebackWebhook(
  chargebackService: ChargebackService,
  rawRequestBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string,
): ControllerResponse {
  if (!verifyStripeSignature(rawRequestBody, signatureHeader, webhookSecret)) {
    console.warn({ level: "warn", event: "stripe_webhook_signature_invalid", timestamp: Date.now() });
    return { status: 401, body: { error: "invalid stripe signature" } };
  }

  let requestBody: unknown;
  try {
    requestBody = rawRequestBody.length === 0 ? {} : JSON.parse(rawRequestBody);
  } catch (err) {
    console.error({
      level: "error",
      event: "stripe_webhook_parse_error",
      error: err instanceof Error ? err.message : String(err),
      bodyLength: rawRequestBody.length,
      timestamp: Date.now(),
    });
    return { status: 400, body: { error: "invalid JSON body" } };
  }

  const body = asRecord(requestBody);
  const data = asRecord(body.data);
  const object = asRecord(data.object);

  if (
    typeof body.id !== "string" ||
    body.type !== "charge.dispute.created" ||
    typeof object.charge !== "string" ||
    typeof object.amount !== "number"
  ) {
    console.warn({
      level: "warn",
      event: "stripe_webhook_validation_error",
      receivedFields: Object.keys(object),
      expectedFields: ["id", "charge", "amount"],
      timestamp: Date.now(),
    });
    return { status: 400, body: { error: "invalid chargeback webhook payload" } };
  }

  const event: ChargebackWebhookEvent = {
    id: body.id,
    stripeChargeId: object.charge,
    amount: object.amount,
  };

  try {
    const reversal = chargebackService.processChargeback(event);
    return {
      status: 200,
      body: {
        chargeback_id: reversal.chargebackId,
        transaction_id: reversal.transactionId,
        provider_id: reversal.providerId,
        amount: reversal.amount,
        action: reversal.action,
      },
    };
  } catch (err) {
    if (err instanceof TransactionNotFoundError) {
      console.error({
        level: "error",
        event: "stripe_chargeback_transaction_not_found",
        stripeChargeId: event.stripeChargeId,
        stripeEventId: event.id,
        amount: event.amount,
        timestamp: Date.now(),
      });
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}
