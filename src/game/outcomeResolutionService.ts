import type { HandResult, SettlementEmitter, SettlementEvent } from "./outcomeModel.ts";

const BLACKJACK_MULTIPLIER = 1.5;
const STANDARD_WIN_MULTIPLIER = 1;
const NO_PAYOUT_MULTIPLIER = 0;
const PUSH_MULTIPLIER = 1;

export class OutcomeResolutionService {
  private settlementEmitter: SettlementEmitter;

  constructor(settlementEmitter: SettlementEmitter) {
    this.settlementEmitter = settlementEmitter;
  }

  resolve(player: HandResult, dealer: HandResult, betAmount: number): SettlementEvent {
    const event = this.determineSettlement(player, dealer, betAmount);
    this.settlementEmitter.emit(event);
    return event;
  }

  private determineSettlement(player: HandResult, dealer: HandResult, betAmount: number): SettlementEvent {
    if (player.isBust) {
      return { outcome: "bust", payoutMultiplier: NO_PAYOUT_MULTIPLIER, betAmount };
    }
    if (dealer.isBust) {
      return { outcome: "win", payoutMultiplier: this.winMultiplier(player), betAmount };
    }
    if (player.total > dealer.total) {
      return { outcome: "win", payoutMultiplier: this.winMultiplier(player), betAmount };
    }
    if (dealer.total > player.total) {
      return { outcome: "loss", payoutMultiplier: NO_PAYOUT_MULTIPLIER, betAmount };
    }
    return { outcome: "push", payoutMultiplier: PUSH_MULTIPLIER, betAmount };
  }

  private winMultiplier(player: HandResult): number {
    return player.isBlackjack ? BLACKJACK_MULTIPLIER : STANDARD_WIN_MULTIPLIER;
  }
}
