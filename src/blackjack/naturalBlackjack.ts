import type { Card } from "./cardModel.ts";
import { isAce, isTenValueCard } from "./cardModel.ts";

export function isNaturalBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && cards.some(isAce) && cards.some(isTenValueCard);
}
