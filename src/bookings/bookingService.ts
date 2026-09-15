import type { UserRepository } from "../users/userRepository.ts";
import type { BookingRepository } from "./bookingRepository.ts";
import type { Booking, BookingStatus } from "./bookingModel.ts";

export interface BookingHistoryEntry {
  id: string;
  status: BookingStatus;
  appointmentTime: number;
  counterparty: { id: string; username: string };
}

export class BookingService {
  private bookingRepository: BookingRepository;
  private userRepository: UserRepository;

  constructor(bookingRepository: BookingRepository, userRepository: UserRepository) {
    this.bookingRepository = bookingRepository;
    this.userRepository = userRepository;
  }

  getCustomerHistory(customerId: string): BookingHistoryEntry[] {
    return this.bookingRepository.listByCustomerId(customerId).map((b) => this.toEntry(b, b.providerId));
  }

  getProviderHistory(providerId: string): BookingHistoryEntry[] {
    return this.bookingRepository.listByProviderId(providerId).map((b) => this.toEntry(b, b.customerId));
  }

  getBookingForRequester(requesterId: string, bookingId: string): BookingHistoryEntry | undefined {
    const booking = this.bookingRepository.findById(bookingId);
    if (!booking) return undefined;
    if (booking.customerId !== requesterId && booking.providerId !== requesterId) return undefined;
    const counterpartyId = booking.customerId === requesterId ? booking.providerId : booking.customerId;
    return this.toEntry(booking, counterpartyId);
  }

  deleteBooking(bookingId: string): never {
    return this.bookingRepository.delete(bookingId);
  }

  private toEntry(booking: Booking, counterpartyId: string): BookingHistoryEntry {
    const counterparty = this.userRepository.findById(counterpartyId);
    return {
      id: booking.id,
      status: booking.status,
      appointmentTime: booking.appointmentTime,
      counterparty: { id: counterpartyId, username: counterparty?.username ?? "" },
    };
  }
}
