import crypto from "node:crypto";
import type { Payout } from "./paymentsModel.ts";

export class PayoutRepository {
  private payoutsById: Map<string, Payout> = new Map();
  private heldProviderIds: Set<string> = new Set();
  private heldAmountByProviderId: Map<string, number> = new Map();
  private directClawbackAmountByProviderId: Map<string, number> = new Map();

  findPendingByProviderId(providerId: string): Payout | undefined {
    for (const payout of this.payoutsById.values()) {
      if (payout.providerId === providerId && payout.status === "pending") {
        return payout;
      }
    }
    return undefined;
  }

  clawBack(payoutId: string, amount: number): void {
    const payout = this.payoutsById.get(payoutId);
    if (!payout) {
      return;
    }
    const remaining = payout.amount - amount;
    if (remaining <= 0) {
      this.payoutsById.set(payoutId, { ...payout, amount: 0, status: "clawed_back" });
      return;
    }
    this.payoutsById.set(payoutId, { ...payout, amount: remaining });
  }

  holdFuturePayouts(providerId: string, amount: number): void {
    this.heldProviderIds.add(providerId);
    const current = this.heldAmountByProviderId.get(providerId) ?? 0;
    this.heldAmountByProviderId.set(providerId, current + amount);
  }

  getHeldAmount(providerId: string): number {
    return this.heldAmountByProviderId.get(providerId) ?? 0;
  }

  isHeld(providerId: string): boolean {
    return this.heldProviderIds.has(providerId);
  }

  createPayout(providerId: string, amount: number, now: number = Date.now()): Payout {
    const payout: Payout = {
      id: crypto.randomUUID(),
      providerId,
      amount,
      status: this.isHeld(providerId) ? "held" : "pending",
      createdAt: now,
    };
    this.payoutsById.set(payout.id, payout);
    return payout;
  }

  recordDirectClawback(providerId: string, amount: number): void {
    const current = this.directClawbackAmountByProviderId.get(providerId) ?? 0;
    this.directClawbackAmountByProviderId.set(providerId, current + amount);
  }

  getDirectClawbackAmount(providerId: string): number {
    return this.directClawbackAmountByProviderId.get(providerId) ?? 0;
  }
}
