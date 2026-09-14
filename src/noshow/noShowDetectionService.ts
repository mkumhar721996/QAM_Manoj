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

    if (booking.status === "confirmed") {
      if (now < booking.appointmentTime) {
        return booking;
      }

      const policyVersion = booking.policyId ? this.policyRepository.currentVersion(booking.policyId, now) : undefined;
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

      try {
        this.paymentsClient.signalNoShowOutcome({ bookingId: booking.id, outcome, signalledAt: now });
      } catch (error) {
        console.error("no-show detection: payments signal failed", {
          bookingId: booking.id,
          callType: "payments",
          error,
        });
        throw error;
      }

      // Payments has now been signalled and must never be signalled again for this
      // booking, so persist the no-show outcome immediately. Notifications are
      // tracked and retried independently below so a later notification failure
      // can never cause a duplicate payments signal.
      booking.status = "noshow";
      booking.noShowDetectedAt = now;
      booking.financialOutcome = outcome;
      this.bookingRepository.update(booking);
      console.info("no-show detection: booking marked no-show", {
        bookingId: booking.id,
        appointmentTime: booking.appointmentTime,
        gracePeriodMinutes: policyVersion?.gracePeriodMinutes ?? 0,
        financialOutcome: outcome,
      });
    }

    if (booking.status !== "noshow") {
      return booking;
    }

    if (!booking.customerNotifiedAt) {
      try {
        this.notificationsClient.notifyCustomerNoShow(booking, now);
      } catch (error) {
        console.error("no-show detection: customer notification failed", {
          bookingId: booking.id,
          callType: "notification",
          error,
        });
        throw error;
      }
      booking.customerNotifiedAt = now;
      this.bookingRepository.update(booking);
    }

    if (!booking.providerNotifiedAt) {
      try {
        this.notificationsClient.notifyProviderNoShow(booking, now);
      } catch (error) {
        console.error("no-show detection: provider notification failed", {
          bookingId: booking.id,
          callType: "notification",
          error,
        });
        throw error;
      }
      booking.providerNotifiedAt = now;
      this.bookingRepository.update(booking);
    }

    return booking;
  }

  detectAll(now: number = Date.now()): Booking[] {
    return this.bookingRepository
      .list()
      .filter((b) => b.status === "confirmed" || (b.status === "noshow" && (!b.customerNotifiedAt || !b.providerNotifiedAt)))
      .map((b) => this.detect(b.id, now));
  }
}
