export interface HandResult {
  total: number;
  isBust: boolean;
  isBlackjack: boolean;
}

export type OutcomeType = "win" | "loss" | "push" | "bust";

export interface SettlementEvent {
  outcome: OutcomeType;
  payoutMultiplier: number;
  betAmount: number;
}

export interface SettlementEmitter {
  emit(event: SettlementEvent): void;
}
