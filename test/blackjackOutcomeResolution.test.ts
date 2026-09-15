import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hand } from "../src/blackjack/handModel.ts";
import { resolveOutcome } from "../src/blackjack/outcomeResolver.ts";

test("AC3: both player and dealer natural blackjack resolves as a push", () => {
  const player: Hand = { cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }] };
  const dealer: Hand = { cards: [{ rank: "A", suit: "clubs" }, { rank: "Q", suit: "diamonds" }] };
  assert.deepEqual(resolveOutcome(player, dealer), { result: "push", payoutMultiplier: 0 });
});

test("AC4: player natural blackjack without dealer blackjack wins 3:2", () => {
  const player: Hand = { cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }] };
  const dealer: Hand = { cards: [{ rank: "9", suit: "clubs" }, { rank: "8", suit: "diamonds" }] };
  assert.deepEqual(resolveOutcome(player, dealer), { result: "player_win", payoutMultiplier: 1.5 });
});

test("AC5: a three-card 21 is not treated as natural and pays 1:1 when it wins", () => {
  const threeCardTwentyOne = [
    { rank: "7" as const, suit: "spades" as const },
    { rank: "6" as const, suit: "hearts" as const },
    { rank: "8" as const, suit: "clubs" as const },
  ];
  const dealer: Hand = { cards: [{ rank: "9", suit: "diamonds" }, { rank: "9", suit: "clubs" }] };
  assert.deepEqual(resolveOutcome({ cards: threeCardTwentyOne }, dealer), {
    result: "player_win",
    payoutMultiplier: 1,
  });
});

test("AC7: dealer natural blackjack without player blackjack loses the player's bet", () => {
  const player: Hand = { cards: [{ rank: "9", suit: "spades" }, { rank: "8", suit: "hearts" }] };
  const dealer: Hand = { cards: [{ rank: "A", suit: "clubs" }, { rank: "K", suit: "diamonds" }] };
  assert.deepEqual(resolveOutcome(player, dealer), { result: "dealer_win", payoutMultiplier: 0 });
});
