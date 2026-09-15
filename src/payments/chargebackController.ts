import type { ControllerResponse } from "../auth/authController.ts";
import { asRecord } from "../httpUtils.ts";
import { ChargebackService, TransactionNotFoundError } from "./chargebackService.ts";
import type { ChargebackWebhookEvent } from "./paymentsModel.ts";

export function handleChargebackWebhook(
  chargebackService: ChargebackService,
  requestBody: unknown,
): ControllerResponse {
  const body = asRecord(requestBody);
  const data = asRecord(body.data);
  const object = asRecord(data.object);

  if (
    typeof body.id !== "string" ||
    body.type !== "charge.dispute.created" ||
    typeof object.charge !== "string" ||
    typeof object.amount !== "number"
  ) {
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
      return { status: 404, body: { error: err.message } };
    }
    throw err;
  }
}
