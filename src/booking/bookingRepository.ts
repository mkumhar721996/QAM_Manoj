import crypto from "node:crypto";
import type { Booking, BookingInput, BookingStatus } from "./bookingModel.ts";

export class BookingRepository {
  private bookingsById: Map<string, Booking> = new Map();

  create(input: BookingInput): Booking {
    const booking: Booking = { ...input, id: crypto.randomUUID(), status: "awaiting_confirmation" };
    this.bookingsById.set(booking.id, booking);
    return booking;
  }

  findById(bookingId: string): Booking | undefined {
    return this.bookingsById.get(bookingId);
  }

  updateStatus(bookingId: string, status: BookingStatus): Booking | undefined {
    const booking = this.bookingsById.get(bookingId);
    if (!booking) {
      return undefined;
    }
    const updated: Booking = { ...booking, status };
    this.bookingsById.set(bookingId, updated);
    return updated;
  }
}
