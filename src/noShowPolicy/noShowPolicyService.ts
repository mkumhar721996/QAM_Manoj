import { NoShowPolicyRepository } from "./noShowPolicyRepository.ts";
import { SUPPORTED_CURRENCIES } from "./noShowPolicyModel.ts";
import type { FinancialOutcome, NoShowPolicy, SupportedCurrency } from "./noShowPolicyModel.ts";

export class NoShowPolicyValidationError extends Error {}

export class NoShowPolicyService {
  private repository: NoShowPolicyRepository;

  constructor(repository: NoShowPolicyRepository) {
    this.repository = repository;
  }

  getPolicy(): NoShowPolicy | undefined {
    return this.repository.get();
  }

  updatePolicy(input: { outcome?: unknown; feeAmount?: unknown; currency?: unknown }, now: number = Date.now()): NoShowPolicy {
    if (input.outcome !== "no_charge" && input.outcome !== "charge_fee") {
      throw new NoShowPolicyValidationError("outcome must be 'no_charge' or 'charge_fee'");
    }

    if (input.outcome === "no_charge") {
      const policy: NoShowPolicy = { outcome: "no_charge", updatedAt: now };
      this.repository.save(policy);
      return policy;
    }

    if (typeof input.feeAmount !== "number" || !Number.isFinite(input.feeAmount) || input.feeAmount <= 0) {
      throw new NoShowPolicyValidationError("feeAmount must be a positive number");
    }
    if (typeof input.currency !== "string" || !(SUPPORTED_CURRENCIES as readonly string[]).includes(input.currency)) {
      throw new NoShowPolicyValidationError(`currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}`);
    }

    const policy: NoShowPolicy = {
      outcome: "charge_fee",
      feeAmount: input.feeAmount,
      currency: input.currency as SupportedCurrency,
      updatedAt: now,
    };
    this.repository.save(policy);
    return policy;
  }

  resolveFinancialOutcome(): FinancialOutcome {
    const policy = this.repository.get();
    if (!policy) {
      console.warn("no-show detected with no configured no-show policy; applying safe default (no charge)");
      return { configured: false, outcome: "no_charge" };
    }
    if (policy.outcome === "no_charge") {
      return { configured: true, outcome: "no_charge" };
    }
    return { configured: true, outcome: "charge_fee", feeAmount: policy.feeAmount, currency: policy.currency };
  }
}
