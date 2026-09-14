import type { NoShowPolicy, NoShowPolicyVersion } from "./noShowPolicyModel.ts";

export class NoShowPolicyRepository {
  private policiesById: Map<string, NoShowPolicy> = new Map();

  create(
    id: string,
    initial: { gracePeriodMinutes: number; outcomeType: "fee" | "no_charge"; feeAmount: number },
    effectiveFrom: number,
  ): NoShowPolicy {
    const policy: NoShowPolicy = {
      id,
      versions: [{ version: 1, effectiveFrom, ...initial }],
    };
    this.policiesById.set(id, policy);
    return policy;
  }

  addVersion(
    id: string,
    next: { gracePeriodMinutes: number; outcomeType: "fee" | "no_charge"; feeAmount: number },
    effectiveFrom: number,
  ): NoShowPolicy {
    const policy = this.policiesById.get(id);
    if (!policy) {
      throw new Error(`No-show policy not found: ${id}`);
    }
    const version = policy.versions.length + 1;
    policy.versions.push({ version, effectiveFrom, ...next });
    return policy;
  }

  currentVersion(id: string): NoShowPolicyVersion | undefined {
    const policy = this.policiesById.get(id);
    if (!policy || policy.versions.length === 0) {
      return undefined;
    }
    return policy.versions[policy.versions.length - 1];
  }
}
