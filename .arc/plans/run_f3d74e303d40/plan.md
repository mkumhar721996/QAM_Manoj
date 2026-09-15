summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is a headless Node `http` API with
  no persistence layer, following a fixtures/model -> repository -> service -> (controller) layering,
  in-memory state, and `node:test` + `node:assert/strict` for tests (see `src/auth/`, `src/cart/`,
  `src/pizzas/`). There is currently NO game/blackjack/card/shoe code anywhere in the codebase - this
  is the first story of the "Core Game Engine" epic, so it introduces a brand-new, self-contained
  `src/game/` module: a card model, a crypto-backed Fisher-Yates shuffle utility, an environment-driven
  shoe configuration loader (mirroring how `tokenService.ts` reads `JWT_SECRET` from `process.env`),
  and a `Shoe` class that owns the multi-deck card list, penetration tracking, and reshuffle-on-next-hand
  behaviour. Nothing in the acceptance criteria requires an HTTP surface (no hand/dealer/state-machine
  story is in scope yet - that is explicitly future work per the parent epic), so this plan does not
  touch `src/app.ts` or add any route; it delivers `Shoe`/`loadShoeConfig` as a unit-testable engine
  building block that later stories (hand state machine, dealer logic) will consume directly.
scope:
  - description: |
      Write the failing test file first, covering all 5 ACs against the not-yet-existing
      `src/game/cardModel.ts`, `src/game/random.ts`, `src/game/shoeConfig.ts`, and `src/game/shoe.ts`
      modules. These must fail with import/module-not-found errors before any implementation exists.
    files:
      - "test/shoeManagement.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before writing any production code,
      matching the existing `test/cartCustomisation.test.ts` style (one test file per feature/story,
      `node:test` + `node:assert/strict`, no HTTP server needed here since these are plain unit tests
      of a domain module rather than a controller).
  - description: |
      Add the card domain model: suits, ranks, the `Card` shape, and a `buildDeck()` builder for a
      single standard 52-card deck.

      ```ts
      // src/game/cardModel.ts
      export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
      export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

      export interface Card {
        rank: Rank;
        suit: Suit;
      }

      export const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
      export const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

      export function buildDeck(): Card[] {
        const deck: Card[] = [];
        for (const suit of SUITS) {
          for (const rank of RANKS) {
            deck.push({ rank, suit });
          }
        }
        return deck;
      }
      ```
    files:
      - "src/game/cardModel.ts"
    rationale: |
      AC1 requires the shoe to contain "the correct card distribution" - `buildDeck()` is the single
      source of truth for what one deck looks like (13 ranks x 4 suits), reused N times by `Shoe` to
      build an N-deck shoe, and reused directly by the AC1 test to assert per-rank/per-suit counts.
  - description: |
      Add a crypto-backed, injectable Fisher-Yates shuffle utility. Uses `node:crypto`'s `randomInt`
      (already used elsewhere in this codebase via `crypto.randomBytes`/`crypto.randomUUID` in
      `tokenService.ts`/`cartService.ts`) rather than `Math.random`, since `Math.random` is not
      guaranteed uniform/unbiased and this story is explicitly about fair RNG.

      ```ts
      // src/game/random.ts
      import crypto from "node:crypto";

      export type RandomIntFn = (maxExclusive: number) => number;

      export const secureRandomInt: RandomIntFn = (maxExclusive) => crypto.randomInt(maxExclusive);

      export function fisherYatesShuffle<T>(items: T[], randomInt: RandomIntFn = secureRandomInt): T[] {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
      }
      ```
    files:
      - "src/game/random.ts"
    rationale: |
      AC2 requires "a uniformly random permutation." Isolating the shuffle as a pure, injectable-RNG
      function lets it be tested deterministically (inject a fixed sequence, assert the exact
      resulting order) without asserting anything statistical about `crypto.randomInt` itself, and
      lets `Shoe` reuse it for both initial shuffle and reshuffle.
  - description: |
      Add the shoe configuration loader, reading overrides from `process.env` with defaults, mirroring
      the `JWT_SECRET` env-var pattern in `src/auth/tokenService.ts`.

      ```ts
      // src/game/shoeConfig.ts
      export interface ShoeConfig {
        numberOfDecks: number;
        penetrationThreshold: number;
      }

      export const DEFAULT_NUMBER_OF_DECKS = 6;
      export const DEFAULT_PENETRATION_THRESHOLD = 260;

      export function loadShoeConfig(env: NodeJS.ProcessEnv = process.env): ShoeConfig {
        const numberOfDecks = env.SHOE_NUMBER_OF_DECKS ? Number(env.SHOE_NUMBER_OF_DECKS) : DEFAULT_NUMBER_OF_DECKS;
        const penetrationThreshold = env.SHOE_PENETRATION_THRESHOLD
          ? Number(env.SHOE_PENETRATION_THRESHOLD)
          : DEFAULT_PENETRATION_THRESHOLD;
        return { numberOfDecks, penetrationThreshold };
      }
      ```
    files:
      - "src/game/shoeConfig.ts"
    rationale: |
      AC4 requires shoe size and reshuffle threshold to be "supplied via external configuration" and
      override defaults when the engine initialises - `loadShoeConfig` is the single place that reads
      `SHOE_NUMBER_OF_DECKS`/`SHOE_PENETRATION_THRESHOLD` from the environment, exactly like
      `tokenService.ts` reads `JWT_SECRET`.
  - description: |
      Add the `Shoe` class: builds an N-deck shoe, shuffles it via `fisherYatesShuffle`, tracks how
      many cards have been dealt, and reshuffles when the next hand is about to begin if the
      penetration threshold has been reached.

      ```ts
      // src/game/shoe.ts
      import { buildDeck } from "./cardModel.ts";
      import type { Card } from "./cardModel.ts";
      import { fisherYatesShuffle, secureRandomInt } from "./random.ts";
      import type { RandomIntFn } from "./random.ts";
      import { loadShoeConfig } from "./shoeConfig.ts";
      import type { ShoeConfig } from "./shoeConfig.ts";

      export class Shoe {
        private config: ShoeConfig;
        private randomInt: RandomIntFn;
        private cards: Card[] = [];
        private dealtCount = 0;

        constructor(config: ShoeConfig = loadShoeConfig(), randomInt: RandomIntFn = secureRandomInt) {
          this.config = config;
          this.randomInt = randomInt;
          this.shuffleNewShoe();
        }

        private shuffleNewShoe(): void {
          const freshCards: Card[] = [];
          for (let i = 0; i < this.config.numberOfDecks; i++) {
            freshCards.push(...buildDeck());
          }
          this.cards = fisherYatesShuffle(freshCards, this.randomInt);
          this.dealtCount = 0;
        }

        remainingCards(): readonly Card[] {
          return this.cards;
        }

        size(): number {
          return this.cards.length;
        }

        needsReshuffle(): boolean {
          return this.dealtCount >= this.config.penetrationThreshold;
        }

        prepareForNextHand(): void {
          if (this.needsReshuffle()) {
            this.shuffleNewShoe();
          }
        }

        deal(): Card {
          const card = this.cards.pop();
          if (!card) {
            throw new Error("shoe is empty");
          }
          this.dealtCount++;
          return card;
        }
      }
      ```
    files:
      - "src/game/shoe.ts"
    rationale: |
      Centralises AC1 (correct size/distribution on init), AC2 (shuffled order via
      `fisherYatesShuffle`), AC3/AC5 (`needsReshuffle()`/`prepareForNextHand()` gate reshuffling on
      the configured penetration threshold, called before the next hand begins), and AC4 (accepts an
      already-loaded `ShoeConfig`, so overrides from `loadShoeConfig(process.env)` flow straight
      through) in one class, matching how `CartService`/`AuthService` centralise their story's rules.
tests:
  - |
    AC1 - GIVEN the shoe configuration is loaded WHEN the shoe is initialised THEN it contains
    exactly (number-of-decks x 52) cards with the correct card distribution.
    ```ts
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
    ```
  - |
    AC2 - GIVEN a shoe is initialised or reshuffled WHEN cards are dealt THEN the order of cards is
    a uniformly random permutation of the shoe's cards.
    ```ts
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
    ```
  - |
    AC3 - GIVEN the shoe has dealt cards equal to or exceeding the configured penetration threshold
    WHEN the next hand is about to begin THEN the shoe is reshuffled before dealing.
    ```ts
    test("AC3: shoe is reshuffled before the next hand once penetration threshold is reached", () => {
      const shoe = new Shoe({ numberOfDecks: 1, penetrationThreshold: 2 });
      shoe.deal();
      shoe.deal();
      assert.equal(shoe.needsReshuffle(), true);

      shoe.prepareForNextHand();
      assert.equal(shoe.size(), 52);
      assert.equal(shoe.needsReshuffle(), false);
    });
    ```
  - |
    AC4 - GIVEN shoe size and reshuffle threshold are supplied via external configuration WHEN the
    engine initialises THEN those values override the defaults.
    ```ts
    test("AC4: shoe size and penetration threshold are overridden by external configuration", () => {
      const env = { SHOE_NUMBER_OF_DECKS: "4", SHOE_PENETRATION_THRESHOLD: "150" } as NodeJS.ProcessEnv;
      const config = loadShoeConfig(env);
      assert.deepEqual(config, { numberOfDecks: 4, penetrationThreshold: 150 });

      const shoe = new Shoe(config);
      assert.equal(shoe.size(), 208);
    });
    ```
  - |
    AC5 - GIVEN the shoe has dealt cards fewer than the configured penetration threshold WHEN the
    next hand is about to begin THEN the shoe is not reshuffled.
    ```ts
    test("AC5: shoe is not reshuffled when dealt count is below the penetration threshold", () => {
      const shoe = new Shoe({ numberOfDecks: 1, penetrationThreshold: 2 });
      shoe.deal();
      assert.equal(shoe.needsReshuffle(), false);

      shoe.prepareForNextHand();
      assert.equal(shoe.size(), 51);
    });
    ```
assumptions_or_open_questions:
  - "No AC requires an HTTP endpoint, and no hand/dealer/state-machine module exists yet in this codebase (that is separate future work under the same 'Core Game Engine' epic), so this plan adds `src/game/` as a standalone, unit-tested module and does NOT wire it into `src/app.ts` or add any route. Please confirm that's the intended scope for this story, or point to where a game-engine composition root should already exist."
  - "The penetration threshold in the ACs ('dealt cards equal to or exceeding the configured penetration threshold') is modeled as an absolute count of cards dealt since the last shuffle (an integer), not a fraction/percentage of the shoe. Defaults chosen: 6 decks, penetration threshold of 260 cards (~83% of a 312-card shoe) - these defaults aren't specified anywhere in the story, so please confirm or adjust them."
  - "Configuration is read via `process.env.SHOE_NUMBER_OF_DECKS` / `process.env.SHOE_PENETRATION_THRESHOLD`, mirroring the existing `JWT_SECRET` pattern in `tokenService.ts`, since there is no other config-loading mechanism (no config file, no framework) anywhere in this codebase."
  - "Reshuffling is modeled as an explicit `prepareForNextHand()` call (rather than an automatic check inside `deal()`), since AC3/AC5 both frame the check as happening 'when the next hand is about to begin' - a later hand-state-machine story is expected to call this before dealing the first card of each new hand."
  - "The RNG is `crypto.randomInt` (via an injectable `RandomIntFn`) rather than `Math.random`, for better statistical fairness given this story is specifically about RNG fairness; the codebase already uses `node:crypto` elsewhere (`tokenService.ts`, `cartService.ts`) so this isn't a new dependency or an unfamiliar primitive for this codebase."
package_dependencies: []
notes: |
  This is a new, self-contained domain module with no existing callers yet (the hand state machine /
  dealer logic that will consume `Shoe` is out of scope for this story per the parent epic), so the
  diagram below only shows the new files and the new test file that exercises them - no existing
  module in this codebase currently references `src/game/`.

  ```mermaid
  flowchart TD
    testFile["test/shoeManagement.test.ts (new)"]
    shoe["src/game/shoe.ts (new) — Shoe class"]
    random["src/game/random.ts (new) — fisherYatesShuffle, secureRandomInt"]
    cardModel["src/game/cardModel.ts (new) — Card, buildDeck()"]
    shoeConfig["src/game/shoeConfig.ts (new) — loadShoeConfig()"]

    testFile -->|"asserts AC1/AC2/AC3/AC5 behaviour"| shoe
    testFile -->|"asserts exact permutation (AC2)"| random
    testFile -->|"asserts distribution (AC1)"| cardModel
    testFile -->|"asserts env overrides (AC4)"| shoeConfig
    shoe -->|"builds N decks"| cardModel
    shoe -->|"shuffles on init/reshuffle"| random
    shoe -->|"default config when none injected"| shoeConfig

    classDef touched fill:#f96,color:#000
    class testFile,shoe,random,cardModel,shoeConfig touched
  ```
