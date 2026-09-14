import type { SlotRepository } from "./slotRepository.ts";
import type { Slot } from "./slotModel.ts";
import type { ProviderRepository } from "../providers/providerRepository.ts";
import type { HoldConfigRepository } from "./holdConfigRepository.ts";

export const SLOT_UNAVAILABLE_MESSAGE = "This slot is no longer available. Please choose a different time.";

export class SlotUnavailableError extends Error {
  constructor() {
    super(SLOT_UNAVAILABLE_MESSAGE);
  }
}

export class SlotService {
  private slotRepository: SlotRepository;
  private providerRepository: ProviderRepository;
  private holdConfigRepository: HoldConfigRepository;

  constructor(
    slotRepository: SlotRepository,
    providerRepository: ProviderRepository,
    holdConfigRepository: HoldConfigRepository,
  ) {
    this.slotRepository = slotRepository;
    this.providerRepository = providerRepository;
    this.holdConfigRepository = holdConfigRepository;
  }

  listAvailableSlots(providerId: string, now: number = Date.now()): Slot[] {
    const provider = this.providerRepository.findById(providerId);
    if (!provider || !provider.approved) {
      return [];
    }
    return this.slotRepository.findByProviderId(providerId).filter((slot) => this.isAvailable(slot, now));
  }

  holdSlot(providerId: string, slotId: string, customerId: string, now: number = Date.now()): Slot {
    const provider = this.providerRepository.findById(providerId);
    const slot = this.slotRepository.findById(slotId);
    if (
      !provider ||
      !provider.approved ||
      !slot ||
      slot.providerId !== providerId ||
      !this.isAvailable(slot, now)
    ) {
      throw new SlotUnavailableError();
    }

    slot.status = "held";
    slot.heldByCustomerId = customerId;
    slot.holdExpiresAt = now + this.holdConfigRepository.getHoldDurationMs();
    return slot;
  }

  private isAvailable(slot: Slot, now: number): boolean {
    if (slot.status === "confirmed") {
      return false;
    }
    if (slot.status === "held" && slot.holdExpiresAt !== undefined && slot.holdExpiresAt > now) {
      return false;
    }
    return true;
  }
}
