export type NoShowOutcomeType = "no_charge" | "charge_fee";

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export interface NoShowPolicy {
  outcome: NoShowOutcomeType;
  feeAmount?: number;
  currency?: SupportedCurrency;
  updatedAt: number;
}

export interface FinancialOutcome {
  configured: boolean;
  outcome: NoShowOutcomeType;
  feeAmount?: number;
  currency?: SupportedCurrency;
}
