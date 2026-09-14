import crypto from "node:crypto";
import type { Booking } from "./bookingModel.ts";

export class BookingRepository {
  private bookingsById: Map<string, Booking> = new Map();

  create(booking: Omit<Booking, "id" | "status">): Booking {
    const created: Booking = { ...booking, id: crypto.randomUUID(), status: "confirmed" };
    this.bookingsById.set(created.id, created);
    return created;
  }

  findByCustomerId(customerId: string): Booking[] {
    return [...this.bookingsById.values()].filter((booking) => booking.customerId === customerId);
  }

  findByProviderId(providerId: string): Booking[] {
    return [...this.bookingsById.values()].filter((booking) => booking.providerId === providerId);
  }
}
