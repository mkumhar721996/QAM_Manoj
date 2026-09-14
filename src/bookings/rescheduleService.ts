import type { Booking } from "./bookingModel.ts";
import type { BookingRepository } from "./bookingRepository.ts";
import type { NotificationService } from "../notifications/notificationService.ts";
import { computeCancellationWindowStart } from "./cancellationPolicy.ts";

export class BookingNotFoundError extends Error {
  constructor() {
    super("Booking not found");
  }
}

export class BookingNotReschedulableError extends Error {
  constructor() {
    super("Booking is not in a reschedulable state");
  }
}

export class SlotUnavailableError extends Error {
  constructor() {
    super("That slot is no longer available, please choose a different slot");
  }
}

export class RescheduleService {
  private bookingRepository: BookingRepository;
  private notificationService: NotificationService;

  constructor(bookingRepository: BookingRepository, notificationService: NotificationService) {
    this.bookingRepository = bookingRepository;
    this.notificationService = notificationService;
  }

  reschedule(
    bookingId: string,
    actingUserId: string,
    newStartTime: number,
    newEndTime: number,
    now: number = Date.now(),
  ): Booking {
    const booking = this.bookingRepository.findById(bookingId);

    if (!booking || booking.customerId !== actingUserId) {
      // Same error for "does not exist" and "belongs to someone else" so the
      // response never reveals whether the booking exists (AC12).
      throw new BookingNotFoundError();
    }

    if (booking.status !== "confirmed") {
      throw new BookingNotReschedulableError();
    }

    const conflict = this.bookingRepository.findConfirmedByProviderAndTime(
      booking.providerId,
      newStartTime,
      newEndTime,
      booking.id,
    );
    if (conflict) {
      throw new SlotUnavailableError();
    }

    const previousStartTime = booking.startTime;
    booking.startTime = newStartTime;
    booking.endTime = newEndTime;
    booking.cancellationPolicyWindowStart = computeCancellationWindowStart(newStartTime);
    booking.rescheduleHistory.push({
      timestamp: now,
      actingUserId,
      previousStartTime,
      newStartTime,
    });

    this.notificationService.notify(
      booking.customerId,
      `Your appointment has been rescheduled to ${new Date(newStartTime).toISOString()}`,
      now,
    );
    this.notificationService.notify(
      booking.providerId,
      `Booking ${booking.id} has been rescheduled to ${new Date(newStartTime).toISOString()}`,
      now,
    );

    return booking;
  }
}
