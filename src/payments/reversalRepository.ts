import type { ChargebackReversal } from "./paymentsModel.ts";

export class ReversalRepository {
  private reversals: ChargebackReversal[] = [];

  save(reversal: ChargebackReversal): void {
    this.reversals.push(reversal);
  }

  findAll(): ChargebackReversal[] {
    return this.reversals;
  }
}
