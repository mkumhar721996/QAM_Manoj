import crypto from "node:crypto";
import type { Booking, BookingStatus } from "./bookingModel.ts";
import { computeCancellationWindowStart } from "./cancellationPolicy.ts";

export interface CreateBookingInput {
  id?: string;
  customerId: string;
  providerId: string;
  startTime: number;
  endTime: number;
  status?: BookingStatus;
}

export class BookingRepository {
  private bookingsById: Map<string, Booking> = new Map();

  create(input: CreateBookingInput): Booking {
    const booking: Booking = {
      id: input.id ?? crypto.randomUUID(),
      customerId: input.customerId,
      providerId: input.providerId,
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status ?? "confirmed",
      cancellationPolicyWindowStart: computeCancellationWindowStart(input.startTime),
      rescheduleHistory: [],
    };
    this.bookingsById.set(booking.id, booking);
    return booking;
  }

  findById(id: string): Booking | undefined {
    return this.bookingsById.get(id);
  }

  findConfirmedByProviderAndTime(
    providerId: string,
    startTime: number,
    endTime: number,
    excludeBookingId?: string,
  ): Booking | undefined {
    for (const booking of this.bookingsById.values()) {
      if (booking.providerId !== providerId) {
        continue;
      }
      if (booking.status !== "confirmed") {
        continue;
      }
      if (excludeBookingId && booking.id === excludeBookingId) {
        continue;
      }
      if (startTime < booking.endTime && endTime > booking.startTime) {
        return booking;
      }
    }
    return undefined;
  }
}
