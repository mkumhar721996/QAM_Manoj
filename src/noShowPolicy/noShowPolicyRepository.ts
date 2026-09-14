import type { NoShowPolicy } from "./noShowPolicyModel.ts";

export class NoShowPolicyRepository {
  private current: NoShowPolicy | undefined;

  get(): NoShowPolicy | undefined {
    return this.current;
  }

  save(policy: NoShowPolicy): void {
    this.current = policy;
  }
}
