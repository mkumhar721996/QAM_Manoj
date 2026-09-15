import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card } from "../src/blackjack/cardModel.ts";
import { isNaturalBlackjack } from "../src/blackjack/naturalBlackjack.ts";
import { calculateHandTotal } from "../src/blackjack/handValue.ts";

test("AC1: player Ace + ten-value card on the initial two-card deal is flagged as natural blackjack", () => {
  const playerHand: Card[] = [
    { rank: "A", suit: "spades" },
    { rank: "K", suit: "hearts" },
  ];
  assert.equal(isNaturalBlackjack(playerHand), true);
});

test("AC2: dealer Ace + ten-value card is flagged as natural blackjack once the hole card is revealed", () => {
  const dealerHand: Card[] = [
    { rank: "A", suit: "diamonds" },
    { rank: "10", suit: "clubs" },
  ];
  assert.equal(isNaturalBlackjack(dealerHand), true);
});

test("AC5: a three-card 21 is not flagged as natural blackjack", () => {
  const threeCardTwentyOne: Card[] = [
    { rank: "7", suit: "spades" },
    { rank: "6", suit: "hearts" },
    { rank: "8", suit: "clubs" },
  ];
  assert.equal(calculateHandTotal(threeCardTwentyOne), 21);
  assert.equal(isNaturalBlackjack(threeCardTwentyOne), false);
});

test("AC6: two ten-value cards totalling 20 are not flagged as a natural blackjack", () => {
  const hand: Card[] = [
    { rank: "K", suit: "spades" },
    { rank: "Q", suit: "hearts" },
  ];
  assert.equal(calculateHandTotal(hand), 20);
  assert.equal(isNaturalBlackjack(hand), false);
});
