import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card } from "../src/blackjack/cardModel.ts";
import { computeHandValue, type Hand } from "../src/blackjack/handModel.ts";
import { playDealerTurn } from "../src/blackjack/dealerService.ts";

test("AC1: dealer draws another card when total is 16 or less", () => {
  const hand: Hand = {
    cards: [
      { rank: "10", suit: "hearts", faceUp: true },
      { rank: "6", suit: "clubs", faceUp: true },
    ],
  };
  let drawCalls = 0;
  const drawCard = (): Card => {
    drawCalls += 1;
    return { rank: "4", suit: "spades", faceUp: false };
  };

  const result = playDealerTurn(hand, drawCard);

  assert.equal(drawCalls, 1);
  assert.equal(result.hand.cards.length, 3);
  assert.equal(result.hand.cards[2]?.rank, "4");
});

test("AC2: dealer stands and draws no further cards on hard 17 or higher", () => {
  const hand: Hand = {
    cards: [
      { rank: "10", suit: "hearts", faceUp: true },
      { rank: "7", suit: "clubs", faceUp: true },
    ],
  };
  const drawCard = (): Card => {
    throw new Error("dealer should not draw on hard 17");
  };

  const result = playDealerTurn(hand, drawCard);

  assert.equal(result.hand.cards.length, 2);
  assert.equal(computeHandValue(result.hand.cards).total, 17);
});

test("AC3: dealer stands on a soft 17 (Ace + 6)", () => {
  const hand: Hand = {
    cards: [
      { rank: "A", suit: "hearts", faceUp: true },
      { rank: "6", suit: "clubs", faceUp: true },
    ],
  };
  const drawCard = (): Card => {
    throw new Error("dealer should not draw on soft 17");
  };

  const result = playDealerTurn(hand, drawCard);

  const value = computeHandValue(result.hand.cards);
  assert.equal(value.total, 17);
  assert.equal(value.isSoft, true);
  assert.equal(result.hand.cards.length, 2);
});

test("AC4: dealer is marked bust when total exceeds 21", () => {
  const hand: Hand = {
    cards: [
      { rank: "10", suit: "hearts", faceUp: true },
      { rank: "6", suit: "clubs", faceUp: true },
    ],
  };
  const pending: Card[] = [{ rank: "9", suit: "spades", faceUp: false }];
  const drawCard = (): Card => pending.shift()!;

  const result = playDealerTurn(hand, drawCard);

  assert.equal(result.isBust, true);
  assert.equal(computeHandValue(result.hand.cards).total, 25);
});

test("AC5: the hole card is revealed before any additional cards are drawn", () => {
  const hand: Hand = {
    cards: [
      { rank: "10", suit: "hearts", faceUp: true },
      { rank: "7", suit: "clubs", faceUp: false },
    ],
  };
  const drawCard = (): Card => {
    throw new Error("dealer should not draw on hard 17");
  };

  const result = playDealerTurn(hand, drawCard);

  assert.ok(result.hand.cards.every((card) => card.faceUp === true));
});

test("AC5: hole card is revealed even when the dealer goes on to draw further cards", () => {
  const hand: Hand = {
    cards: [
      { rank: "9", suit: "hearts", faceUp: true },
      { rank: "6", suit: "clubs", faceUp: false },
    ],
  };
  const drawCard = (): Card => ({ rank: "K", suit: "diamonds", faceUp: false });

  const result = playDealerTurn(hand, drawCard);

  assert.equal(result.hand.cards[1]?.faceUp, true);
});
