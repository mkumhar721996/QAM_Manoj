import type { CancellationPolicyTier } from "./cancellationPolicyModel.ts";

export class CancellationPolicyRepository {
  private tiersById: Map<string, CancellationPolicyTier> = new Map();

  getAll(): CancellationPolicyTier[] {
    return [...this.tiersById.values()];
  }

  addTiers(tiers: CancellationPolicyTier[]): void {
    for (const tier of tiers) {
      this.tiersById.set(tier.id, tier);
    }
  }

  remove(id: string): boolean {
    return this.tiersById.delete(id);
  }
}
