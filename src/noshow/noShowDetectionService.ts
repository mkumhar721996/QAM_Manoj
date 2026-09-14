import type { Booking, FinancialOutcome } from "../bookings/bookingModel.ts";
import { BookingRepository } from "../bookings/bookingRepository.ts";
import { NoShowPolicyRepository } from "./noShowPolicyRepository.ts";
import type { PaymentsInvoicingClient } from "../payments/paymentsInvoicingClient.ts";
import type { NotificationsClient } from "../notifications/notificationsClient.ts";

export class BookingNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
  }
}

export class NoShowDetectionService {
  private bookingRepository: BookingRepository;
  private policyRepository: NoShowPolicyRepository;
  private paymentsClient: PaymentsInvoicingClient;
  private notificationsClient: NotificationsClient;

  constructor(
    bookingRepository: BookingRepository,
    policyRepository: NoShowPolicyRepository,
    paymentsClient: PaymentsInvoicingClient,
    notificationsClient: NotificationsClient,
  ) {
    this.bookingRepository = bookingRepository;
    this.policyRepository = policyRepository;
    this.paymentsClient = paymentsClient;
    this.notificationsClient = notificationsClient;
  }

  detect(bookingId: string, now: number = Date.now()): Booking {
    const booking = this.bookingRepository.findById(bookingId);
    if (!booking) {
      throw new BookingNotFoundError(bookingId);
    }
    if (booking.status !== "confirmed") {
      return booking;
    }
    if (now < booking.appointmentTime) {
      return booking;
    }

    const policyVersion = booking.policyId ? this.policyRepository.currentVersion(booking.policyId) : undefined;
    const graceMs = (policyVersion?.gracePeriodMinutes ?? 0) * 60_000;
    if (now - booking.appointmentTime < graceMs) {
      return booking;
    }

    const outcome: FinancialOutcome = policyVersion
      ? {
          type: policyVersion.outcomeType,
          amount: policyVersion.outcomeType === "fee" ? policyVersion.feeAmount : 0,
          policyId: booking.policyId,
          policyVersion: policyVersion.version,
        }
      : { type: "no_charge", amount: 0 };

    booking.status = "noshow";
    booking.noShowDetectedAt = now;
    booking.financialOutcome = outcome;
    this.bookingRepository.update(booking);

    this.paymentsClient.signalNoShowOutcome({ bookingId: booking.id, outcome, signalledAt: now });
    this.notificationsClient.notifyCustomerNoShow(booking, now);
    this.notificationsClient.notifyProviderNoShow(booking, now);

    return booking;
  }

  detectAll(now: number = Date.now()): Booking[] {
    return this.bookingRepository
      .list()
      .filter((b) => b.status === "confirmed")
      .map((b) => this.detect(b.id, now));
  }
}
