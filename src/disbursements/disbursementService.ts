import type { DisbursementRepository } from "./disbursementRepository.ts";
import type { ConfigRepository } from "./configRepository.ts";
import type { PaymentGateway } from "./paymentGateway.ts";
import type { NotificationRepository } from "./notificationRepository.ts";

export const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RETRY_DELAYS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000];
export const MAX_RETRIES = 3;
const SYSTEM_ACTOR = "system:disbursement-scheduler";

export class DisbursementService {
  private disbursementRepository: DisbursementRepository;
  private configRepository: ConfigRepository;
  private paymentGateway: PaymentGateway;
  private notificationRepository: NotificationRepository;

  constructor(
    disbursementRepository: DisbursementRepository,
    configRepository: ConfigRepository,
    paymentGateway: PaymentGateway,
    notificationRepository: NotificationRepository,
  ) {
    this.disbursementRepository = disbursementRepository;
    this.configRepository = configRepository;
    this.paymentGateway = paymentGateway;
    this.notificationRepository = notificationRepository;
  }

  handleServiceCompleted(bookingId: string, providerId: string, totalAmount: number, now: number = Date.now()): void {
    this.disbursementRepository.create({
      bookingId,
      providerId,
      totalAmount,
      status: "dispute_window",
      disburseAt: now + DISPUTE_WINDOW_MS,
      disputeRaised: false,
      retryCount: 0,
    });
  }

  handleDisputeCreated(bookingId: string, now: number = Date.now()): void {
    const disbursement = this.disbursementRepository.findByBookingId(bookingId);
    if (!disbursement) return;

    if (disbursement.status === "disbursed") {
      this.notificationRepository.notifyAdmin(
        bookingId,
        `Chargeback raised for booking ${bookingId} after disbursement`,
        now,
      );
      this.notificationRepository.createRecoveryTask(
        bookingId,
        disbursement.providerId,
        "chargeback after disbursement",
        now,
      );
      return;
    }
    disbursement.disputeRaised = true;
  }

  async processDue(now: number = Date.now()): Promise<void> {
    for (const disbursement of this.disbursementRepository.listDue(now)) {
      const rate = this.configRepository.getServiceFeeRate();
      const serviceFeeAmount = disbursement.totalAmount * rate;
      const netAmount = disbursement.totalAmount - serviceFeeAmount;
      const attemptRetryCount = disbursement.retryCount;

      const result = await this.paymentGateway.disburse({
        bookingId: disbursement.bookingId,
        providerId: disbursement.providerId,
        amount: netAmount,
      });

      this.disbursementRepository.addAttempt({
        bookingId: disbursement.bookingId,
        timestamp: now,
        actor: SYSTEM_ACTOR,
        retryCount: attemptRetryCount,
        outcome: result.success ? "success" : "failure",
        reason: result.failureReason,
      });

      if (result.success) {
        disbursement.status = "disbursed";
        disbursement.disbursedAt = now;
        disbursement.serviceFeeAmount = serviceFeeAmount;
        disbursement.netAmount = netAmount;
        continue;
      }

      disbursement.retryCount = attemptRetryCount + 1;
      if (disbursement.retryCount > MAX_RETRIES) {
        disbursement.status = "failed_manual_intervention";
        this.notificationRepository.notifyAdmin(
          disbursement.bookingId,
          `Disbursement failed after ${MAX_RETRIES} retries for booking ${disbursement.bookingId}`,
          now,
        );
        this.notificationRepository.notifyProvider(
          disbursement.bookingId,
          `Please update your payout details for booking ${disbursement.bookingId}`,
          now,
        );
        continue;
      }
      disbursement.status = "retry_pending";
      disbursement.nextRetryAt = now + RETRY_DELAYS_MS[disbursement.retryCount - 1];
    }
  }
}
