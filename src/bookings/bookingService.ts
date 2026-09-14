import type { UserRepository } from "../users/userRepository.ts";
import type { SlotRepository } from "./slotRepository.ts";
import type { HoldRepository } from "./holdRepository.ts";
import type { BookingRepository } from "./bookingRepository.ts";
import type { Booking } from "./bookingModel.ts";

export class HoldNotFoundError extends Error {
  constructor() {
    super("Hold not found");
  }
}

export class HoldExpiredError extends Error {
  constructor() {
    super("Your hold has expired. Please select a new slot.");
  }
}

export class BookingService {
  private slotRepository: SlotRepository;
  private holdRepository: HoldRepository;
  private bookingRepository: BookingRepository;
  private userRepository: UserRepository;

  constructor(
    slotRepository: SlotRepository,
    holdRepository: HoldRepository,
    bookingRepository: BookingRepository,
    userRepository: UserRepository,
  ) {
    this.slotRepository = slotRepository;
    this.holdRepository = holdRepository;
    this.bookingRepository = bookingRepository;
    this.userRepository = userRepository;
  }

  confirmHold(holdId: string, requestingCustomerId: string, now: number = Date.now()): Booking {
    const hold = this.holdRepository.findById(holdId);
    const slot = hold ? this.slotRepository.findById(hold.slotId) : undefined;
    if (!hold || !slot || hold.customerId !== requestingCustomerId) {
      throw new HoldNotFoundError();
    }

    if (!this.holdRepository.isValid(hold, now)) {
      this.slotRepository.release(slot.id);
      this.holdRepository.remove(hold.id);
      throw new HoldExpiredError();
    }

    const customer = this.userRepository.findById(hold.customerId);
    const booking = this.bookingRepository.create({
      slotId: slot.id,
      customerId: hold.customerId,
      customerName: customer?.username ?? hold.customerId,
      providerId: slot.providerId,
      providerName: slot.providerName,
      date: slot.date,
      time: slot.time,
    });

    this.slotRepository.markBooked(slot.id);
    this.holdRepository.remove(hold.id);
    return booking;
  }

  getBookingsForCustomer(customerId: string): Booking[] {
    return this.bookingRepository.findByCustomerId(customerId);
  }

  getScheduleForProvider(providerId: string): Booking[] {
    return this.bookingRepository.findByProviderId(providerId);
  }
}
