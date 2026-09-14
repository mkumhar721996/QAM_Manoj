import type { BookingRepository } from "./bookingRepository.ts";
import { evaluateCancellationPolicy } from "./cancellationPolicy.ts";
import type { CancellationOutcome } from "./cancellationPolicy.ts";
import type { Booking } from "./bookingModel.ts";
import type { PaymentsGateway } from "../payments/paymentsGateway.ts";
import type { NotificationsGateway } from "../notifications/notificationsGateway.ts";

export class BookingNotFoundError extends Error {
  constructor() {
    super("Booking not found");
  }
}

export class BookingNotCancellableError extends Error {
  constructor() {
    super("Only confirmed bookings can be cancelled");
  }
}

export interface CancelBookingResult {
  booking: Booking;
  outcome: CancellationOutcome;
}

export class BookingService {
  private bookingRepository: BookingRepository;
  private paymentsGateway: PaymentsGateway;
  private notificationsGateway: NotificationsGateway;

  constructor(bookingRepository: BookingRepository, paymentsGateway: PaymentsGateway, notificationsGateway: NotificationsGateway) {
    this.bookingRepository = bookingRepository;
    this.paymentsGateway = paymentsGateway;
    this.notificationsGateway = notificationsGateway;
  }

  cancelBooking(bookingId: string, customerId: string, now: number = Date.now()): CancelBookingResult {
    const booking = this.bookingRepository.findById(bookingId);
    if (!booking || booking.customerId !== customerId) {
      throw new BookingNotFoundError();
    }
    if (booking.status !== "confirmed") {
      throw new BookingNotCancellableError();
    }

    const policy = evaluateCancellationPolicy(booking.appointmentAt, now);
    const cancelled = this.bookingRepository.markCancelled(bookingId, customerId, now);
    console.log(`booking cancelled: bookingId=${bookingId} actorId=${customerId} at=${new Date(now).toISOString()}`);

    this.paymentsGateway.signalCancellationOutcome({
      bookingId,
      customerId,
      outcome: policy.outcome,
      signalledAt: now,
    });
    this.notificationsGateway.notifyProviderOfCancellation({
      bookingId,
      providerId: booking.providerId,
      notifiedAt: now,
    });

    return { booking: cancelled, outcome: policy.outcome };
  }
}
