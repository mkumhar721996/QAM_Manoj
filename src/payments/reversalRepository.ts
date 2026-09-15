import type { ChargebackReversal } from "./paymentsModel.ts";

export class ReversalRepository {
  private reversals: ChargebackReversal[] = [];

  save(reversal: ChargebackReversal): void {
    this.reversals.push(reversal);
  }

  findAll(): ChargebackReversal[] {
    return this.reversals;
  }

  findByChargebackId(chargebackId: string): ChargebackReversal | undefined {
    return this.reversals.find((reversal) => reversal.chargebackId === chargebackId);
  }
}
