import type { Booking } from "./bookingModel.ts";

export class BookingRepository {
  private bookingsById: Map<string, Booking> = new Map();

  create(input: {
    id: string;
    customerId: string;
    providerId: string;
    service: string;
    appointmentTime: number;
    policyId?: string;
  }): Booking {
    if (this.bookingsById.has(input.id)) {
      throw new Error(`Booking already exists: ${input.id}`);
    }
    const booking: Booking = {
      id: input.id,
      customerId: input.customerId,
      providerId: input.providerId,
      service: input.service,
      appointmentTime: input.appointmentTime,
      policyId: input.policyId,
      status: "confirmed",
    };
    this.bookingsById.set(booking.id, booking);
    return booking;
  }

  findById(id: string): Booking | undefined {
    return this.bookingsById.get(id);
  }

  update(booking: Booking): void {
    this.bookingsById.set(booking.id, booking);
  }

  recordCancellation(id: string, now: number): Booking {
    const booking = this.bookingsById.get(id);
    if (!booking) {
      throw new Error(`Booking not found: ${id}`);
    }
    if (booking.status !== "confirmed") {
      return booking;
    }
    booking.status = "cancelled";
    booking.cancellationConfirmedAt = now;
    return booking;
  }

  list(): Booking[] {
    return Array.from(this.bookingsById.values());
  }
}
