import crypto from "node:crypto";
import type { Hold } from "./holdModel.ts";

export class HoldRepository {
  private holdsById: Map<string, Hold> = new Map();

  create(slotId: string, customerId: string, ttlMs: number, now: number = Date.now()): Hold {
    const hold: Hold = {
      id: crypto.randomUUID(),
      slotId,
      customerId,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.holdsById.set(hold.id, hold);
    return hold;
  }

  findById(id: string): Hold | undefined {
    return this.holdsById.get(id);
  }

  remove(id: string): void {
    this.holdsById.delete(id);
  }

  isValid(hold: Hold, now: number = Date.now()): boolean {
    return hold.expiresAt > now;
  }
}
