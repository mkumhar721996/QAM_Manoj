import { testSlots } from "./fixtures/testSlots.ts";
import type { Slot } from "./slotModel.ts";

export class SlotRepository {
  private slotsById: Map<string, Slot>;
  private slotsByProviderId: Map<string, Slot[]>;

  constructor(slots: Slot[] = testSlots) {
    const clonedSlots = slots.map((s) => ({ ...s }));
    this.slotsById = new Map(clonedSlots.map((s) => [s.id, s]));
    this.slotsByProviderId = new Map();
    for (const slot of clonedSlots) {
      const existing = this.slotsByProviderId.get(slot.providerId) ?? [];
      existing.push(slot);
      this.slotsByProviderId.set(slot.providerId, existing);
    }
  }

  findById(slotId: string): Slot | undefined {
    return this.slotsById.get(slotId);
  }

  findByProviderId(providerId: string): Slot[] {
    return this.slotsByProviderId.get(providerId) ?? [];
  }
}
