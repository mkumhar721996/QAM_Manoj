summary: |
  This repo (`qam-manoj-story-007-login-session-management`) currently implements login/session
  management, a pizza catalog, and a cart - there is NO existing Blackjack/card-game code anywhere
  (no `Card`, `Hand`, `Dealer`, `Deck`, or RNG/shuffle module), even though the parent epic ("Core
  Game Engine") implies a broader system. This plan implements ONLY the dealer's fixed drawing rule
  (STORY-063) as a new, self-contained, framework-agnostic domain module `src/blackjack/`, following
  the existing repo convention of one folder per domain (`auth/`, `sessions/`, `users/`, `cart/`,
  `pizzas/`). Since no `Hand`/`Card` model exists yet, this plan introduces the minimal `Card`/`Hand`
  primitives needed to express "hand total", "soft/hard", and "hole card face-up/face-down" from the
  ACs - and nothing beyond that (no full state machine, no deck/shuffle/RNG, no outcome resolution;
  those are separate stories under the same epic). The dealer draw loop takes card-drawing as an
  injected function (`drawCard: () => Card`) rather than depending on a not-yet-built deck/RNG
  module, keeping this story's surface area limited to exactly what STORY-063 requires. All ACs are
  pure domain behaviour (no "screen" or HTTP endpoint is mentioned), so this is tested as a plain
  `node:test` unit-test module with no HTTP server, unlike the existing HTTP-integration tests.
scope:
  - description: |
      Write the failing unit tests first, covering all 5 ACs against the not-yet-existing
      `src/blackjack/cardModel.ts`, `src/blackjack/handModel.ts`, and `src/blackjack/dealerService.ts`
      modules. These must fail (module-not-found/type errors) before any implementation exists.
    files:
      - "test/dealerLogic.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before writing production code,
      matching the plain `node:test` + `node:assert/strict` style already used in
      `test/login.test.ts`, but without `startTestServer()`/`fetch` since none of the ACs describe
      an HTTP-observable behaviour - this is pure domain logic.
  - description: |
      Add the minimal card/hand domain types and hand-value calculation (hard/soft total), modeled
      as a new domain folder the same way `src/cart/cartModel.ts` and `src/pizzas/pizzaRepository.ts`
      introduced new domains.

      ```ts
      // src/blackjack/cardModel.ts
      export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
      export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

      export interface Card {
        rank: Rank;
        suit: Suit;
        faceUp: boolean;
      }
      ```

      ```ts
      // src/blackjack/handModel.ts
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
      ```
    files:
      - "src/blackjack/cardModel.ts"
      - "src/blackjack/handModel.ts"
    rationale: |
      AC3 ("soft 17") is only checkable if the total correctly reduces an Ace from 11 to 1 as needed
      - this is the single source of truth both `dealerService.ts` and this test suite rely on to
      distinguish a soft 17 (Ace+6) from a hard 17 (10+7), and it is deliberately kept minimal
      (no `Deck`, no shuffle, no bet/outcome fields) since those belong to other stories under the
      same "Core Game Engine" epic.
  - description: |
      Add `dealerService.ts` implementing the fixed drawing rule and hole-card reveal.

      ```ts
      // src/blackjack/dealerService.ts
      import type { Card } from "./cardModel.ts";
      import { computeHandValue, type Hand } from "./handModel.ts";

      export interface DealerTurnResult {
        hand: Hand;
        isBust: boolean;
      }

      export function playDealerTurn(hand: Hand, drawCard: () => Card): DealerTurnResult {
        for (const card of hand.cards) {
          card.faceUp = true;
        }

        let value = computeHandValue(hand.cards);
        while (value.total <= 16) {
          const card = drawCard();
          card.faceUp = true;
          hand.cards.push(card);
          value = computeHandValue(hand.cards);
        }

        return { hand, isBust: value.total > 21 };
      }
      ```
    files:
      - "src/blackjack/dealerService.ts"
    rationale: |
      Reveals the hole card unconditionally before evaluating whether to draw (AC5), then applies a
      single, simple loop condition (`total <= 16`) that is sufficient to satisfy AC1/AC2/AC3 together:
      standing on hard 17+ and soft 17 both fall out of "total is never <= 16 for either", so no
      separate soft-17 branch is needed for this stand-on-soft-17 (S17) rule - `isSoft` is still
      returned by `computeHandValue` and asserted on directly in the AC3 test so a future accidental
      switch to an H17 (hit-soft-17) loop condition is caught. `drawCard` is an injected function
      rather than a call into a real deck/RNG module, since shuffling/RNG is explicitly out of scope
      for this story (separate epic item) - a future story can supply a real `Deck.draw` here.
tests:
  - |
    AC1 - dealer draws another card while total is 16 or less.
    ```ts
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
    ```
  - |
    AC2 - dealer stands and draws no further cards on a hard 17 or higher.
    ```ts
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
    ```
  - |
    AC3 - dealer stands on a soft 17 (Ace counted as 11, total 17).
    ```ts
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
    ```
  - |
    AC4 - dealer is marked bust when the total exceeds 21 after drawing.
    ```ts
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
    ```
  - |
    AC5 - the hole card (previously face-down) is revealed before any additional cards are drawn.
    ```ts
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
    ```
assumptions_or_open_questions:
  - "This codebase has NO existing Blackjack/card-game code at all (no Card/Hand/Dealer/Deck/RNG), even though the parent epic describes a full 'Core Game Engine'. This plan treats STORY-063 as introducing only the minimal Card/Hand primitives needed for the dealer's fixed drawing rule, and nothing from the epic's other listed pieces (full hand state machine, outcome resolution, RNG/shuffle, hand history). Please confirm this narrow interpretation, or point to where a broader game-engine scaffold is expected to already live."
  - "No AC describes an HTTP endpoint or UI screen, so this is implemented and tested as a plain in-process TypeScript module (`src/blackjack/`) with `node:test` unit tests, not wired into `src/app.ts`. If dealer's-turn logic needs to be reachable over HTTP for this story specifically (not a later integration story), please say so."
  - "Card drawing is injected as a `drawCard: () => Card` function rather than calling a real deck/shuffle/RNG module, since none exists yet and RNG/shuffle is explicitly a separate item under the same epic. A future story wiring in a real `Deck` can supply `deck.draw` as this function."
  - "'Hole card' is modeled generically as any card in the dealer's hand with `faceUp: false` at the start of the dealer's turn (normally exactly one, the second card dealt) rather than a dedicated `holeCardIndex` field; `playDealerTurn` reveals all face-down cards unconditionally before evaluating whether to draw, which satisfies AC5 regardless of how many cards were face-down."
  - "Dealer 'stands' is represented simply by `playDealerTurn` returning without further mutation past the point the loop condition (`total <= 16`) becomes false - there is no separate explicit 'standing' boolean/state on the returned result beyond `isBust`, since no AC asks for one."
package_dependencies: []
notes: |
  Existing conventions checked before writing this plan: `tsconfig.json` uses `NodeNext` module
  resolution with `verbatimModuleSyntax`, so all local imports use explicit `.ts` extensions and
  `import type` for type-only imports (matching `src/cart/cartModel.ts` etc.); `test/login.test.ts`
  shows the plain `node:test` + `node:assert/strict` style this new test file follows (minus the
  HTTP server, since these ACs are pure domain logic, not an HTTP contract).

  This plan is small (3 new files + 1 new test file, all new/additive, nothing modified), so a
  call-graph diagram is skipped per the "small, purely-additive plan" exception - there is no
  existing module this touches or that touches it, since no other code in the repo currently
  imports anything under a `blackjack` domain.
