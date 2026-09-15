import type { UserRepository } from "../users/userRepository.ts";
import type { DeliveryLogRepository } from "./deliveryLogRepository.ts";
import type { EmailSender } from "./emailSender.ts";
import type { CaptureFailureAttemptEvent, NotificationType, RefundIssuedEvent } from "./notificationModel.ts";

export class NotificationService {
  private userRepository: UserRepository;
  private deliveryLogRepository: DeliveryLogRepository;
  private emailSender: EmailSender;
  private maxDeliveryAttempts: number;

  constructor(
    userRepository: UserRepository,
    deliveryLogRepository: DeliveryLogRepository,
    emailSender: EmailSender,
    maxDeliveryAttempts: number = 3,
  ) {
    this.userRepository = userRepository;
    this.deliveryLogRepository = deliveryLogRepository;
    this.emailSender = emailSender;
    this.maxDeliveryAttempts = maxDeliveryAttempts;
  }

  async notifyRefundIssued(event: RefundIssuedEvent): Promise<void> {
    const subject = "Your refund has been issued";
    const body = `A refund of ${event.refundAmount} ${event.currency} has been issued to your original payment method: ${event.originalPaymentMethod}.`;
    await this.sendIfNotDuplicate("refund_issued", event.transactionId, event.customerId, subject, body);
  }

  async notifyCaptureFailureAttempt(event: CaptureFailureAttemptEvent): Promise<void> {
    if (event.attemptNumber < event.maxAttempts) {
      return;
    }
    const subject = "Your booking was cancelled due to a payment issue";
    const body =
      "We were unable to capture payment for your booking after multiple attempts, so it has been cancelled. Please update your payment method and try again.";
    await this.sendIfNotDuplicate("capture_failed", event.transactionId, event.customerId, subject, body);
  }

  private async sendIfNotDuplicate(
    type: NotificationType,
    transactionId: string,
    customerId: string,
    subject: string,
    body: string,
  ): Promise<void> {
    if (this.deliveryLogRepository.hasSucceeded(type, transactionId)) {
      return;
    }

    const customer = this.userRepository.findById(customerId);
    if (!customer) {
      return;
    }

    for (let attempt = 1; attempt <= this.maxDeliveryAttempts; attempt++) {
      try {
        await this.emailSender.send({ to: customer.email, subject, body });
        this.deliveryLogRepository.recordSent(type, transactionId, customer.email);
        return;
      } catch {
        if (attempt === this.maxDeliveryAttempts) {
          this.deliveryLogRepository.recordPermanentlyFailed(type, transactionId, customer.email);
        }
      }
    }
  }
}
