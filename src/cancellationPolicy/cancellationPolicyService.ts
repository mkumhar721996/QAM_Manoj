import crypto from "node:crypto";
import type { CancellationPolicyRepository } from "./cancellationPolicyRepository.ts";
import type {
  CancellationOutcome,
  CancellationPolicyTier,
  CancellationPolicyTierInput,
} from "./cancellationPolicyModel.ts";
import { tiersOverlap } from "./cancellationPolicyModel.ts";

export class OverlappingTierWindowError extends Error {
  constructor() {
    super("cancellation policy tier windows overlap");
  }
}

export interface CancellationPolicy {
  tiers: CancellationPolicyTier[];
  configured: boolean;
}

export interface CancellationEvaluation {
  outcome: CancellationOutcome;
  tierId: string | null;
  refundPercentage?: number;
}

export class CancellationPolicyService {
  private repository: CancellationPolicyRepository;

  constructor(repository: CancellationPolicyRepository) {
    this.repository = repository;
  }

  getPolicy(): CancellationPolicy {
    const tiers = this.repository.getAll();
    return { tiers, configured: tiers.length > 0 };
  }

  addTiers(inputs: CancellationPolicyTierInput[]): CancellationPolicyTier[] {
    const existing = this.repository.getAll();
    const candidates: CancellationPolicyTier[] = inputs.map((input) => ({ id: crypto.randomUUID(), ...input }));
    const all = [...existing, ...candidates];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (tiersOverlap(all[i], all[j])) {
          throw new OverlappingTierWindowError();
        }
      }
    }
    this.repository.addTiers(candidates);
    return candidates;
  }

  removeTier(id: string): boolean {
    return this.repository.remove(id);
  }

  evaluateCancellation(appointmentTimeMs: number, cancellationTimeMs: number): CancellationEvaluation {
    const hoursBefore = Math.max(0, (appointmentTimeMs - cancellationTimeMs) / (60 * 60 * 1000));
    const tier = this.repository
      .getAll()
      .find(
        (t) =>
          hoursBefore >= t.minHoursBeforeAppointment && hoursBefore < (t.maxHoursBeforeAppointment ?? Infinity),
      );
    if (!tier) {
      return { outcome: "full_refund", tierId: null };
    }
    return { outcome: tier.outcome, tierId: tier.id, refundPercentage: tier.refundPercentage };
  }
}
