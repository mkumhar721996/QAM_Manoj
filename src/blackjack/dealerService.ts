import type { Card } from "./cardModel.ts";
import { computeHandValue, type Hand } from "./handModel.ts";

export interface DealerTurnResult {
  hand: Hand;
  isBust: boolean;
}

export function playDealerTurn(hand: Hand, drawCard: () => Card): DealerTurnResult {
  for (const card of hand.cards) {
    card.faceUp = true;
  }

  let value = computeHandValue(hand.cards);
  while (value.total <= 16) {
    const card = drawCard();
    card.faceUp = true;
    hand.cards.push(card);
    value = computeHandValue(hand.cards);
  }

  return { hand, isBust: value.total > 21 };
}
