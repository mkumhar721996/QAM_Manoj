import type { Booking } from "./bookingModel.ts";

export class BookingRepository {
  private bookingsById: Map<string, Booking> = new Map();

  create(booking: Booking): Booking {
    this.bookingsById.set(booking.id, booking);
    return booking;
  }

  findById(bookingId: string): Booking | undefined {
    return this.bookingsById.get(bookingId);
  }

  markCancelled(bookingId: string, cancelledBy: string, now: number): Booking {
    const booking = this.bookingsById.get(bookingId);
    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`);
    }
    booking.status = "cancelled";
    booking.cancelledAt = now;
    booking.cancelledBy = cancelledBy;
    return booking;
  }
}
