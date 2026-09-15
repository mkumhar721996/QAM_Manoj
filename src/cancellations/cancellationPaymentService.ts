import type { CancellationEvent } from "./cancellationModel.ts";
import type { CancellationLogRepository } from "./cancellationLogRepository.ts";
import type { StripeGateway } from "./stripeGateway.ts";

export class InvalidCancellationEventError extends Error {}

export interface CancellationExecutionResult {
  refundId: string;
  refundAmountCents: number;
  disbursementId?: string;
  disbursementAmountCents?: number;
}

export class CancellationPaymentService {
  private stripeGateway: StripeGateway;
  private cancellationLogRepository: CancellationLogRepository;

  constructor(stripeGateway: StripeGateway, cancellationLogRepository: CancellationLogRepository) {
    this.stripeGateway = stripeGateway;
    this.cancellationLogRepository = cancellationLogRepository;
  }

  async processCancellation(
    event: CancellationEvent,
    now: number = Date.now(),
  ): Promise<CancellationExecutionResult> {
    if (event.outcome === "partial_refund" && !event.providerId) {
      throw new InvalidCancellationEventError("provider_id is required for a partial refund outcome");
    }
    if (event.outcome === "partial_refund" && event.serviceFeeCents > event.nonRefundableAmountCents) {
      throw new InvalidCancellationEventError("service_fee_cents cannot exceed non_refundable_amount_cents");
    }

    const refund = await this.stripeGateway.refund(event.paymentIntentId, event.refundAmountCents);

    let disbursement: { id: string; amountCents: number } | undefined;
    if (event.outcome === "partial_refund") {
      const disbursementAmountCents = event.nonRefundableAmountCents - event.serviceFeeCents;
      if (disbursementAmountCents > 0) {
        disbursement = await this.stripeGateway.disburseToProvider(event.providerId!, disbursementAmountCents);
      }
    }

    this.cancellationLogRepository.add({
      bookingId: event.bookingId,
      actorId: event.actorId,
      refundAmountCents: event.refundAmountCents,
      nonRefundableAmountCents: event.nonRefundableAmountCents,
      timestamp: now,
    });

    return {
      refundId: refund.id,
      refundAmountCents: refund.amountCents,
      disbursementId: disbursement?.id,
      disbursementAmountCents: disbursement?.amountCents,
    };
  }
}
