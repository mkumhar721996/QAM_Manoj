import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card, Rank } from "../src/game/card.ts";
import { HandStateMachine, IllegalActionError, type CardSource } from "../src/game/handStateMachine.ts";

function fixedCardSource(ranks: Rank[]): CardSource {
  let index = 0;
  return {
    draw(): Card {
      const rank = ranks[index];
      index++;
      return { rank, suit: "spades" };
    },
  };
}

test("AC1: deal transitions to player-turn with 2 player cards and 2 dealer cards, one dealer card face-down", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
  hand.deal();
  assert.equal(hand.getState(), "player-turn");
  assert.equal(hand.getPlayerCards().length, 2);
  assert.equal(hand.getDealerCards().length, 2);
  assert.equal(hand.getDealerCards()[0].faceUp, true);
  assert.equal(hand.getDealerCards()[1].faceUp, false);
});

test("AC2: hit that keeps total at 21 or under stays in player-turn", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10", "8"]));
  hand.deal();
  hand.hit();
  assert.equal(hand.getState(), "player-turn");
});

test("AC3: hit that brings total over 21 transitions to bust", () => {
  const hand = new HandStateMachine(fixedCardSource(["10", "9", "2", "3", "5"]));
  hand.deal();
  hand.hit();
  assert.equal(hand.getState(), "bust");
});

test("AC4: stand transitions player-turn to dealer-turn", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
  hand.deal();
  hand.stand();
  assert.equal(hand.getState(), "dealer-turn");
});

test("AC5: double-down deals one additional card to the player", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10", "7"]));
  hand.deal();
  hand.doubleDown();
  assert.equal(hand.getPlayerCards().length, 3);
});

test("AC6: double-down transitions player-turn to dealer-turn", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10", "7"]));
  hand.deal();
  hand.doubleDown();
  assert.equal(hand.getState(), "dealer-turn");
});

test("AC7: player actions are rejected outside player-turn", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
  assert.throws(() => hand.hit(), IllegalActionError);

  hand.deal();
  hand.stand();
  assert.throws(() => hand.hit(), IllegalActionError);
  assert.throws(() => hand.stand(), IllegalActionError);
  assert.throws(() => hand.doubleDown(), IllegalActionError);
});

test("AC8: state does not change when a player action is rejected", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
  hand.deal();
  hand.stand();
  assert.equal(hand.getState(), "dealer-turn");
  assert.throws(() => hand.hit(), IllegalActionError);
  assert.equal(hand.getState(), "dealer-turn");
});

test("AC9: completing dealer play moves dealer-turn to outcome", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
  hand.deal();
  hand.stand();
  hand.completeDealerTurn();
  assert.equal(hand.getState(), "outcome");
});

test("AC10: resolving the outcome moves outcome to complete", () => {
  const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
  hand.deal();
  hand.stand();
  hand.completeDealerTurn();
  hand.resolveOutcome();
  assert.equal(hand.getState(), "complete");
});
