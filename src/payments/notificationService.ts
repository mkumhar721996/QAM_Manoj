import type { NotificationRepository } from "./notificationRepository.ts";
import type { ChargebackReversal } from "./paymentsModel.ts";

const PLATFORM_ADMIN_ID = "admin";

export class NotificationService {
  private notificationRepository: NotificationRepository;

  constructor(notificationRepository: NotificationRepository) {
    this.notificationRepository = notificationRepository;
  }

  notifyAdmin(reversal: ChargebackReversal): void {
    this.notificationRepository.save({
      recipientRole: "admin",
      recipientId: PLATFORM_ADMIN_ID,
      chargebackId: reversal.chargebackId,
      amount: reversal.amount,
    });
  }

  notifyProvider(reversal: ChargebackReversal): void {
    this.notificationRepository.save({
      recipientRole: "provider",
      recipientId: reversal.providerId,
      chargebackId: reversal.chargebackId,
      amount: reversal.amount,
    });
  }
}
