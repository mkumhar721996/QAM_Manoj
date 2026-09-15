import type { Booking } from "../booking/bookingModel.ts";
import type { BookingRepository } from "../booking/bookingRepository.ts";
import type { NotificationService } from "../notifications/notificationService.ts";
import type { PaymentAuditLogRepository } from "./paymentAuditLogRepository.ts";
import type { PaymentGateway } from "./paymentGateway.ts";

export const CAPTURE_RETRY_DELAY_MS = 30_000;

export class BookingNotFoundError extends Error {}

export class PaymentService {
  private gateway: PaymentGateway;
  private bookingRepository: BookingRepository;
  private auditLog: PaymentAuditLogRepository;
  private notificationService: NotificationService;

  constructor(
    gateway: PaymentGateway,
    bookingRepository: BookingRepository,
    auditLog: PaymentAuditLogRepository,
    notificationService: NotificationService,
  ) {
    this.gateway = gateway;
    this.bookingRepository = bookingRepository;
    this.auditLog = auditLog;
    this.notificationService = notificationService;
  }

  async confirmBooking(bookingId: string, paymentToken: string, actorId: string): Promise<Booking> {
    const booking = this.bookingRepository.findById(bookingId);
    if (!booking) {
      throw new BookingNotFoundError(`No booking found with id ${bookingId}`);
    }

    const authorization = await this.gateway.authorize(paymentToken, booking.amount, booking.currency);

    const firstAttemptSucceeded = await this.attemptCapture(booking, authorization.paymentIntentId, actorId, 1);
    if (firstAttemptSucceeded) {
      return this.confirm(booking);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, CAPTURE_RETRY_DELAY_MS));

    const secondAttemptSucceeded = await this.attemptCapture(booking, authorization.paymentIntentId, actorId, 2);
    if (secondAttemptSucceeded) {
      return this.confirm(booking);
    }

    return this.bookingRepository.updateStatus(booking.id, "pending_payment") ?? booking;
  }

  private async attemptCapture(
    booking: Booking,
    paymentIntentId: string,
    actorId: string,
    attempt: number,
  ): Promise<boolean> {
    try {
      await this.gateway.capture(paymentIntentId);
      this.auditLog.record({ bookingId: booking.id, actorId, attempt, outcome: "success", timestamp: Date.now() });
      return true;
    } catch {
      this.auditLog.record({ bookingId: booking.id, actorId, attempt, outcome: "failure", timestamp: Date.now() });
      return false;
    }
  }

  private async confirm(booking: Booking): Promise<Booking> {
    const updated = this.bookingRepository.updateStatus(booking.id, "confirmed") ?? booking;
    await Promise.all([
      this.notificationService.sendBookingConfirmationEmail(booking.customerId, booking.id),
      this.notificationService.sendBookingConfirmationSms(booking.customerId, booking.id),
    ]);
    return updated;
  }
}
