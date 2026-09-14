import type { Slot } from "./slotModel.ts";

export class SlotRepository {
  private slotsById: Map<string, Slot> = new Map();

  create(slot: Slot): Slot {
    this.slotsById.set(slot.id, slot);
    return slot;
  }

  findById(id: string): Slot | undefined {
    return this.slotsById.get(id);
  }

  markBooked(id: string): void {
    const slot = this.slotsById.get(id);
    if (slot) {
      slot.status = "booked";
    }
  }

  release(id: string): void {
    const slot = this.slotsById.get(id);
    if (slot) {
      slot.status = "available";
    }
  }
}
