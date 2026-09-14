export interface NoShowPolicyVersion {
  version: number;
  gracePeriodMinutes: number;
  outcomeType: "fee" | "no_charge";
  feeAmount: number;
  effectiveFrom: number;
}

export interface NoShowPolicy {
  id: string;
  versions: NoShowPolicyVersion[];
}
