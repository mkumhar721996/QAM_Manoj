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

  currentVersion(id: string, now: number): NoShowPolicyVersion | undefined {
    const policy = this.policiesById.get(id);
    if (!policy) {
      return undefined;
    }
    const applicable = policy.versions.filter((v) => v.effectiveFrom <= now);
    if (applicable.length === 0) {
      return undefined;
    }
    return applicable.reduce((latest, v) => (v.version > latest.version ? v : latest));
  }
}
