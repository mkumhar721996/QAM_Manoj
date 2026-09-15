import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeck, RANKS, SUITS } from "../src/game/cardModel.ts";
import { fisherYatesShuffle } from "../src/game/random.ts";
import type { RandomIntFn } from "../src/game/random.ts";
import { loadShoeConfig } from "../src/game/shoeConfig.ts";
import { Shoe } from "../src/game/shoe.ts";

test("AC1: shoe initialises with exactly numberOfDecks x 52 cards and correct distribution", () => {
  const shoe = new Shoe({ numberOfDecks: 2, penetrationThreshold: 100 });
  assert.equal(shoe.size(), 104);

  const counts = new Map<string, number>();
  for (const card of shoe.remainingCards()) {
    const key = `${card.rank}-${card.suit}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      assert.equal(counts.get(`${rank}-${suit}`), 2);
    }
  }
});

test("AC2: fisherYatesShuffle produces the exact permutation dictated by the injected RNG", () => {
  const calls = [3, 1, 0];
  const mockRandomInt: RandomIntFn = () => calls.shift() as number;
  const result = fisherYatesShuffle(["a", "b", "c", "d"], mockRandomInt);
  assert.deepEqual(result, ["c", "a", "b", "d"]);
});

test("AC2: a freshly initialised shoe is not left in unshuffled build order", () => {
  const shoe = new Shoe({ numberOfDecks: 1, penetrationThreshold: 52 });
  assert.notDeepEqual(shoe.remainingCards(), buildDeck());
});

test("AC3: shoe is reshuffled before the next hand once penetration threshold is reached", () => {
  const shoe = new Shoe({ numberOfDecks: 1, penetrationThreshold: 2 });
  shoe.deal();
  shoe.deal();
  assert.equal(shoe.needsReshuffle(), true);

  shoe.prepareForNextHand();
  assert.equal(shoe.size(), 52);
  assert.equal(shoe.needsReshuffle(), false);
});

test("AC4: shoe size and penetration threshold are overridden by external configuration", () => {
  const env = { SHOE_NUMBER_OF_DECKS: "4", SHOE_PENETRATION_THRESHOLD: "150" } as NodeJS.ProcessEnv;
  const config = loadShoeConfig(env);
  assert.deepEqual(config, { numberOfDecks: 4, penetrationThreshold: 150 });

  const shoe = new Shoe(config);
  assert.equal(shoe.size(), 208);
});

test("AC5: shoe is not reshuffled when dealt count is below the penetration threshold", () => {
  const shoe = new Shoe({ numberOfDecks: 1, penetrationThreshold: 2 });
  shoe.deal();
  assert.equal(shoe.needsReshuffle(), false);

  shoe.prepareForNextHand();
  assert.equal(shoe.size(), 51);
});
