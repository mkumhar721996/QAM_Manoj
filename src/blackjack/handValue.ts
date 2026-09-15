import type { Card } from "./cardModel.ts";
import { cardValue, isAce } from "./cardModel.ts";

export function calculateHandTotal(cards: Card[]): number {
  let total = cards.reduce((sum, c) => sum + cardValue(c), 0);
  let aceCount = cards.filter(isAce).length;
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }
  return total;
}
