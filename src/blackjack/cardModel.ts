export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export function isAce(card: Card): boolean {
  return card.rank === "A";
}

export function isTenValueCard(card: Card): boolean {
  return card.rank === "10" || card.rank === "J" || card.rank === "Q" || card.rank === "K";
}

export function cardValue(card: Card): number {
  if (isAce(card)) return 11;
  if (isTenValueCard(card)) return 10;
  return Number(card.rank);
}
