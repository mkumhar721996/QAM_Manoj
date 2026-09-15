import type { Hand } from "./handModel.ts";
import { isNaturalBlackjack } from "./naturalBlackjack.ts";
import { calculateHandTotal } from "./handValue.ts";

export type OutcomeResult = "push" | "player_win" | "dealer_win";

export interface Outcome {
  result: OutcomeResult;
  payoutMultiplier: number;
}

export function resolveOutcome(player: Hand, dealer: Hand): Outcome {
  const playerBlackjack = isNaturalBlackjack(player.cards);
  const dealerBlackjack = isNaturalBlackjack(dealer.cards);

  if (playerBlackjack && dealerBlackjack) {
    return { result: "push", payoutMultiplier: 0 };
  }
  if (playerBlackjack) {
    return { result: "player_win", payoutMultiplier: 1.5 };
  }
  if (dealerBlackjack) {
    return { result: "dealer_win", payoutMultiplier: 0 };
  }

  const playerTotal = calculateHandTotal(player.cards);
  const dealerTotal = calculateHandTotal(dealer.cards);
  if (playerTotal === dealerTotal) {
    return { result: "push", payoutMultiplier: 0 };
  }
  return playerTotal > dealerTotal
    ? { result: "player_win", payoutMultiplier: 1 }
    : { result: "dealer_win", payoutMultiplier: 0 };
}
