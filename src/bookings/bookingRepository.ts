import type { Booking } from "./bookingModel.ts";
import { testBookings } from "./fixtures/testBookings.ts";

export class BookingDeletionNotAllowedError extends Error {}

export class BookingRepository {
  private bookingsById: Map<string, Booking>;

  constructor(bookings: Booking[] = testBookings) {
    this.bookingsById = new Map(bookings.map((b) => [b.id, b]));
  }

  findById(bookingId: string): Booking | undefined {
    return this.bookingsById.get(bookingId);
  }

  listByCustomerId(customerId: string): Booking[] {
    return [...this.bookingsById.values()].filter((b) => b.customerId === customerId);
  }

  listByProviderId(providerId: string): Booking[] {
    return [...this.bookingsById.values()].filter((b) => b.providerId === providerId);
  }

  delete(_bookingId: string): never {
    throw new BookingDeletionNotAllowedError("Cancelled or completed bookings cannot be deleted or purged");
  }
}
