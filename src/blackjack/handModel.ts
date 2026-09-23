import type { Card } from "./cardModel.ts";

export interface Hand {
  cards: Card[];
}

export interface HandValue {
  total: number;
  isSoft: boolean;
}

export function computeHandValue(cards: Card[]): HandValue {
  let total = 0;
  let acesCountedAsEleven = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      acesCountedAsEleven += 1;
      total += 11;
    } else if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && acesCountedAsEleven > 0) {
    total -= 10;
    acesCountedAsEleven -= 1;
  }
  return { total, isSoft: acesCountedAsEleven > 0 };
}
