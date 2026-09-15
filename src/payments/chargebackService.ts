import type { AuditLogRepository } from "./auditLogRepository.ts";
import type { NotificationService } from "./notificationService.ts";
import type {
  ChargebackReversal,
  ChargebackWebhookEvent,
  DisbursementStatus,
  ReversalAction,
} from "./paymentsModel.ts";
import type { PayoutRepository } from "./payoutRepository.ts";
import type { ReversalRepository } from "./reversalRepository.ts";
import type { TransactionRepository } from "./transactionRepository.ts";

export class TransactionNotFoundError extends Error {}

export class ChargebackService {
  private transactionRepository: TransactionRepository;
  private payoutRepository: PayoutRepository;
  private reversalRepository: ReversalRepository;
  private auditLogRepository: AuditLogRepository;
  private notificationService: NotificationService;

  constructor(
    transactionRepository: TransactionRepository,
    payoutRepository: PayoutRepository,
    reversalRepository: ReversalRepository,
    auditLogRepository: AuditLogRepository,
    notificationService: NotificationService,
  ) {
    this.transactionRepository = transactionRepository;
    this.payoutRepository = payoutRepository;
    this.reversalRepository = reversalRepository;
    this.auditLogRepository = auditLogRepository;
    this.notificationService = notificationService;
  }

  processChargeback(event: ChargebackWebhookEvent, now: number = Date.now()): ChargebackReversal {
    const existingReversal = this.reversalRepository.findByChargebackId(event.id);
    if (existingReversal) {
      console.warn({
        level: "warn",
        event: "stripe_chargeback_duplicate_event",
        chargebackId: event.id,
        timestamp: now,
      });
      return existingReversal;
    }

    const transaction = this.transactionRepository.findByStripeChargeId(event.stripeChargeId);
    if (!transaction) {
      throw new TransactionNotFoundError(`No transaction found for stripe charge id ${event.stripeChargeId}`);
    }

    const action = this.reverseDisbursement(transaction.providerId, event.amount, transaction.disbursementStatus);

    const reversal: ChargebackReversal = {
      chargebackId: event.id,
      transactionId: transaction.id,
      providerId: transaction.providerId,
      amount: event.amount,
      action,
      createdAt: now,
    };
    this.reversalRepository.save(reversal);

    this.auditLogRepository.record({
      timestamp: now,
      actorId: event.id,
      chargebackAmount: event.amount,
      action,
    });

    this.sendNotification("admin", () => this.notificationService.notifyAdmin(reversal), reversal, now);
    this.sendNotification("provider", () => this.notificationService.notifyProvider(reversal), reversal, now);

    return reversal;
  }

  private sendNotification(
    recipientRole: "admin" | "provider",
    send: () => void,
    reversal: ChargebackReversal,
    now: number,
  ): void {
    try {
      send();
    } catch (err) {
      console.error({
        level: "error",
        event: "notification_send_failed",
        recipientRole,
        chargebackId: reversal.chargebackId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: now,
      });
    }
  }

  private reverseDisbursement(
    providerId: string,
    chargebackAmount: number,
    disbursementStatus: DisbursementStatus,
  ): ReversalAction {
    const pendingPayout = this.payoutRepository.findPendingByProviderId(providerId);
    if (pendingPayout && pendingPayout.amount >= chargebackAmount) {
      this.payoutRepository.clawBack(pendingPayout.id, chargebackAmount);
      return "clawback_from_pending_payout";
    }
    if (disbursementStatus === "disbursed" && !pendingPayout) {
      this.payoutRepository.recordDirectClawback(providerId, chargebackAmount);
      return "direct_clawback";
    }
    this.payoutRepository.holdFuturePayouts(providerId, chargebackAmount);
    return "hold_future_payouts";
  }
}
