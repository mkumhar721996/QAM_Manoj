summary: |
  This repo (`qam-manoj-story-007-login-session-management`) currently has NO Blackjack game code
  at all — no card, hand, deck, or dealer concept exists anywhere (confirmed via a full-repo grep);
  it only implements login/session (`src/auth/`, `src/sessions/`, `src/users/`) and pizza
  cart/customisation (`src/pizzas/`, `src/cart/`) over a plain Node `http` server, all following a
  repository -> service -> controller layering with `node:test` + `node:assert/strict`. This story
  is the first slice of the "Core Game Engine" epic to land, and unlike the earlier Pizza
  Customisation story its ACs are phrased purely in engine terms ("the engine flags...", "outcome
  is resolved") with no screen or API endpoint mentioned, so this plan adds a new, framework-agnostic
  `src/blackjack/` module (card/hand types, natural-blackjack detection, and blackjack-specific
  outcome/payout resolution) that is unit-tested directly with `node:test`, with no HTTP route
  wired in `src/app.ts` since no AC calls for one. Deck/shuffle/dealing, the broader hand state
  machine, and general (non-blackjack) bust/stand resolution belong to sibling stories in the same
  epic and are out of scope here; hands are constructed directly in tests.
scope:
  - description: |
      Write the failing tests first for all 7 ACs, importing modules that do not exist yet
      (`src/blackjack/cardModel.ts`, `naturalBlackjack.ts`, `handValue.ts`, `handModel.ts`,
      `outcomeResolver.ts`). These must fail with module-not-found/type errors before any
      implementation exists.
    files:
      - "test/naturalBlackjackDetection.test.ts"
      - "test/blackjackOutcomeResolution.test.ts"
    rationale: |
      Establishes the test-first contract before any production code, matching the existing
      `test/login.test.ts` / `test/cartCustomisation.test.ts` style (`node:test` + `node:assert/strict`),
      adapted to direct unit tests since this feature has no HTTP surface.
  - description: |
      Add the card model: rank/suit types and helpers to identify aces and ten-value cards.

      ```ts
      // src/blackjack/cardModel.ts
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
      ```
    files:
      - "src/blackjack/cardModel.ts"
    rationale: |
      AC1/AC2/AC6 all hinge on distinguishing "is this card an Ace" and "is this card a ten-value
      card (10/J/Q/K)" — centralising that here keeps the rank-comparison logic in one place instead
      of duplicated string checks in the detection function.
  - description: |
      Add hand total calculation (needed to tell a two-card natural from a 21 reached in 3+ cards
      for AC5/AC6, using standard soft-ace reduction).

      ```ts
      // src/blackjack/handValue.ts
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
      ```
    files:
      - "src/blackjack/handValue.ts"
    rationale: |
      AC5 requires recognising "a player hand totals 21 in three or more cards" as distinct from a
      natural — this is the minimal piece of hand-total math needed to check that condition and to
      compare totals in outcome resolution (AC5's "pays at 1:1 if it wins").
  - description: |
      Add natural-blackjack detection.

      ```ts
      // src/blackjack/naturalBlackjack.ts
      import type { Card } from "./cardModel.ts";
      import { isAce, isTenValueCard } from "./cardModel.ts";

      export function isNaturalBlackjack(cards: Card[]): boolean {
        return cards.length === 2 && cards.some(isAce) && cards.some(isTenValueCard);
      }
      ```
    files:
      - "src/blackjack/naturalBlackjack.ts"
    rationale: |
      Single source of truth for "is this a natural" used identically for player (AC1) and dealer
      (AC2) hands. The two-card-length check alone rules out AC5 (3+ card 21), and requiring both
      `some(isAce)` and `some(isTenValueCard)` naturally rules out AC6 (two ten-value cards, no ace)
      without a separate branch.
  - description: |
      Add the `Hand` type and the blackjack-specific outcome/payout resolver.

      ```ts
      // src/blackjack/handModel.ts
      import type { Card } from "./cardModel.ts";
      export interface Hand {
        cards: Card[];
      }
      ```

      ```ts
      // src/blackjack/outcomeResolver.ts
      import type { Hand } from "./handModel.ts";
      import { isNaturalBlackjack } from "./naturalBlackjack.ts";
      import { calculateHandTotal } from "./handValue.ts";

      export type OutcomeResult = "push" | "player_win" | "dealer_win";

      export interface Outcome {
        result: OutcomeResult;
        payoutMultiplier: number;
      }

      export function resolveOutcome(player: Hand, dealer: Hand): Outcome {
        const playerBlackjack = isNaturalBlackjack(player.cards);
        const dealerBlackjack = isNaturalBlackjack(dealer.cards);

        if (playerBlackjack && dealerBlackjack) {
          return { result: "push", payoutMultiplier: 0 };
        }
        if (playerBlackjack) {
          return { result: "player_win", payoutMultiplier: 1.5 };
        }
        if (dealerBlackjack) {
          return { result: "dealer_win", payoutMultiplier: 0 };
        }

        const playerTotal = calculateHandTotal(player.cards);
        const dealerTotal = calculateHandTotal(dealer.cards);
        if (playerTotal === dealerTotal) {
          return { result: "push", payoutMultiplier: 0 };
        }
        return playerTotal > dealerTotal
          ? { result: "player_win", payoutMultiplier: 1 }
          : { result: "dealer_win", payoutMultiplier: 0 };
      }
      ```
    files:
      - "src/blackjack/handModel.ts"
      - "src/blackjack/outcomeResolver.ts"
    rationale: |
      Centralises AC3 (both natural -> push), AC4 (player-only natural -> 3:2), AC7 (dealer-only
      natural -> player loses), and AC5's "pays 1:1 if it wins" (falls through to the plain total
      comparison, which returns `payoutMultiplier: 1` since neither side is flagged natural) in one
      function, mirroring how `CartService.addPizzaToCart` centralises its rules rather than
      spreading them across callers.
tests:
  - |
    AC1 - GIVEN the player's initial two cards are an Ace and any ten-value card WHEN the deal
    completes THEN the engine flags the player hand as a natural Blackjack.
    ```ts
    test("AC1: player Ace + ten-value card on the initial two-card deal is flagged as natural blackjack", () => {
      const playerHand: Card[] = [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "hearts" },
      ];
      assert.equal(isNaturalBlackjack(playerHand), true);
    });
    ```
  - |
    AC2 - GIVEN the dealer's initial two cards are an Ace and any ten-value card WHEN the dealer's
    hole card is revealed THEN the engine flags the dealer hand as a natural Blackjack.
    ```ts
    test("AC2: dealer Ace + ten-value card is flagged as natural blackjack once the hole card is revealed", () => {
      const dealerHand: Card[] = [
        { rank: "A", suit: "diamonds" },
        { rank: "10", suit: "clubs" },
      ];
      assert.equal(isNaturalBlackjack(dealerHand), true);
    });
    ```
  - |
    AC3 - GIVEN both player and dealer hold a natural Blackjack WHEN outcome is resolved THEN the
    result is a push (no win, no loss).
    ```ts
    test("AC3: both player and dealer natural blackjack resolves as a push", () => {
      const player: Hand = { cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }] };
      const dealer: Hand = { cards: [{ rank: "A", suit: "clubs" }, { rank: "Q", suit: "diamonds" }] };
      assert.deepEqual(resolveOutcome(player, dealer), { result: "push", payoutMultiplier: 0 });
    });
    ```
  - |
    AC4 - GIVEN the player holds a natural Blackjack and the dealer does not WHEN outcome is
    resolved THEN the player wins at 3:2 on the original bet.
    ```ts
    test("AC4: player natural blackjack without dealer blackjack wins 3:2", () => {
      const player: Hand = { cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "hearts" }] };
      const dealer: Hand = { cards: [{ rank: "9", suit: "clubs" }, { rank: "8", suit: "diamonds" }] };
      assert.deepEqual(resolveOutcome(player, dealer), { result: "player_win", payoutMultiplier: 1.5 });
    });
    ```
  - |
    AC5 - GIVEN a player hand totals 21 in three or more cards WHEN outcome is resolved THEN the
    hand is NOT treated as a natural Blackjack and pays at 1:1 if it wins.
    ```ts
    test("AC5: a three-card 21 is not flagged as natural and pays 1:1 when it wins", () => {
      const threeCardTwentyOne: Card[] = [
        { rank: "7", suit: "spades" },
        { rank: "6", suit: "hearts" },
        { rank: "8", suit: "clubs" },
      ];
      assert.equal(calculateHandTotal(threeCardTwentyOne), 21);
      assert.equal(isNaturalBlackjack(threeCardTwentyOne), false);

      const dealer: Hand = { cards: [{ rank: "9", suit: "diamonds" }, { rank: "9", suit: "clubs" }] };
      assert.deepEqual(resolveOutcome({ cards: threeCardTwentyOne }, dealer), {
        result: "player_win",
        payoutMultiplier: 1,
      });
    });
    ```
  - |
    AC6 - GIVEN a player hand totals 21 with two cards neither of which is an Ace (e.g., two
    ten-value cards) WHEN the deal completes THEN the hand is NOT flagged as a natural Blackjack.
    ```ts
    test("AC6: two ten-value cards totalling 21 are not flagged as a natural blackjack", () => {
      const hand: Card[] = [
        { rank: "K", suit: "spades" },
        { rank: "Q", suit: "hearts" },
      ];
      assert.equal(calculateHandTotal(hand), 20);
      assert.equal(isNaturalBlackjack(hand), false);
    });
    ```
  - |
    AC7 - GIVEN the dealer holds a natural Blackjack and the player does not WHEN outcome is
    resolved THEN the player loses the original bet.
    ```ts
    test("AC7: dealer natural blackjack without player blackjack loses the player's bet", () => {
      const player: Hand = { cards: [{ rank: "9", suit: "spades" }, { rank: "8", suit: "hearts" }] };
      const dealer: Hand = { cards: [{ rank: "A", suit: "clubs" }, { rank: "K", suit: "diamonds" }] };
      assert.deepEqual(resolveOutcome(player, dealer), { result: "dealer_win", payoutMultiplier: 0 });
    });
    ```
assumptions_or_open_questions:
  - "A full-repo grep for blackjack/card/hand/dealer/deck terms returned nothing outside design-system CSS/HTML and the pizza/auth code — there is genuinely no existing game engine to extend. This plan starts the `src/blackjack/` module from scratch as the first slice of the 'Core Game Engine' epic."
  - "Unlike the earlier Pizza Customisation story, these ACs are phrased purely in engine terms ('the engine flags...', 'outcome is resolved') with no screen or endpoint mentioned, so this is implemented as a plain, framework-agnostic TypeScript module unit-tested directly with node:test — no new HTTP route is added to src/app.ts. Flagging for reviewer confirmation that no API surface is expected yet for this story."
  - "Deck construction, shuffling/RNG, and actually dealing cards are assumed to belong to a separate 'RNG/shuffle' story in the same epic; tests construct Card/Hand values directly by hand rather than drawing from a deck."
  - "AC2's 'dealer's hole card is revealed' is modeled simply as calling `isNaturalBlackjack` on the dealer's already-known two-card hand — the concealment/reveal state transition itself is assumed to belong to the 'hand state machine' part of the epic and is out of scope here."
  - "Bust handling (a hand exceeding 21) is out of scope for this story; the non-natural comparison branch in `resolveOutcome` (only reachable for AC5/AC7-style differentiation) is exercised in tests only with hands that stay at or under 21, so it does not depend on bust rules from a not-yet-built general outcome-resolution story."
  - "Payout is expressed as a multiplier of the original bet (0, 1, or 1.5) rather than a currency amount, since no bet/wager/currency model exists yet in this codebase; applying the multiplier to an actual stake is left to whichever story introduces wagering."
  - "A push is represented as `{ result: \"push\", payoutMultiplier: 0 }` (no money changes hands) rather than `payoutMultiplier: 1` (return of stake), since there's no bet-ledger to distinguish those two representations yet — flagging for reviewer confirmation this is the intended shape."
package_dependencies: []
notes: |
  This module has no existing callers to wire into (`src/app.ts` is untouched) since no AC requests
  an HTTP surface; it is a self-contained slice of the "Core Game Engine" epic. Dependency graph
  among the new files:

  ```mermaid
  flowchart TD
    cardModel["src/blackjack/cardModel.ts (new)"]
    handModel["src/blackjack/handModel.ts (new)"]
    handValue["src/blackjack/handValue.ts (new)"]
    naturalBlackjack["src/blackjack/naturalBlackjack.ts (new)"]
    outcomeResolver["src/blackjack/outcomeResolver.ts (new)"]
    detectionTest["test/naturalBlackjackDetection.test.ts (new)"]
    outcomeTest["test/blackjackOutcomeResolution.test.ts (new)"]

    handValue -->|"cardValue(), isAce() for total calc"| cardModel
    naturalBlackjack -->|"isAce(), isTenValueCard()"| cardModel
    outcomeResolver -->|"cards"| handModel
    outcomeResolver -->|"isNaturalBlackjack() for push/3:2/loss"| naturalBlackjack
    outcomeResolver -->|"calculateHandTotal() for AC5 non-natural compare"| handValue
    detectionTest -->|"drives AC1/AC2/AC5/AC6"| naturalBlackjack
    detectionTest -->|"drives AC5/AC6 totals"| handValue
    outcomeTest -->|"drives AC3/AC4/AC5/AC7"| outcomeResolver

    classDef touched fill:#f96,color:#000
    class cardModel,handModel,handValue,naturalBlackjack,outcomeResolver,detectionTest,outcomeTest touched
  ```
