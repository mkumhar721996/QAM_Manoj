summary: |
  This repo (`qam-manoj-story-007-login-session-management`) is a headless Node `http` API with
  `auth/`, `sessions/`, `users/`, `pizzas/`, and `cart/` modules, each following a
  repository -> service -> controller layering wired into `src/app.ts`. There is no `game`,
  `blackjack`, `hand`, `card`, or `deck` code anywhere yet - this is the first story under the
  "Core Game Engine" epic. Unlike the earlier Cart story (whose ACs described a UI "screen" and
  were translated into an HTTP contract), this story's ACs are phrased entirely in engine/domain
  terms ("the state transitions to...", "the engine rejects the action") with no mention of a
  request, response, or endpoint. This plan therefore adds a small, framework-agnostic domain
  module - `src/game/card.ts` (a `Card` model and 21-aware `handTotal()`) and
  `src/game/handStateMachine.ts` (a `HandStateMachine` class implementing the `new -> player-turn
  -> {bust | dealer-turn -> outcome -> complete}` lifecycle) - driven by a single new unit test
  file, `test/handStateMachine.test.ts`, that exercises the class directly with `node:test`
  (no HTTP server, no wiring into `src/app.ts`). Card dealing is done through an injected
  `CardSource` interface so this story does not need to implement RNG/shuffling or a real 52-card
  deck; that is left for a later "RNG/shuffle" item in the same epic. Likewise, the actual
  dealer-play strategy and win/lose/push computation are separate epic items - this story only
  provides the two state-transition trigger points (`completeDealerTurn()`, `resolveOutcome()`)
  that those future stories will call into.
scope:
  - description: |
      Write the failing unit tests first, covering all 10 ACs, against the not-yet-existing
      `HandStateMachine` class and `Card`/`handTotal` helpers. These must fail with an import
      error (module not found) before any production code exists.
    files:
      - "test/handStateMachine.test.ts"
    rationale: |
      Establishes the test-first contract for the whole state machine before any implementation
      exists, matching the existing `node:test` + `node:assert/strict` style already used in
      `test/login.test.ts` / `test/cartCustomisation.test.ts`, but exercising the class directly
      (unit-level) since these ACs describe engine behaviour, not an HTTP contract.
  - description: |
      Add the card model and hand-total calculation, `src/game/card.ts`:

      ```ts
      export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
      export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

      export interface Card {
        rank: Rank;
        suit: Suit;
      }

      const RANK_VALUES: Record<Rank, number> = {
        "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
        J: 10, Q: 10, K: 10, A: 11,
      };

      export function handTotal(cards: Card[]): number {
        let total = cards.reduce((sum, c) => sum + RANK_VALUES[c.rank], 0);
        let aces = cards.filter((c) => c.rank === "A").length;
        while (total > 21 && aces > 0) {
          total -= 10;
          aces--;
        }
        return total;
      }
      ```
    files:
      - "src/game/card.ts"
    rationale: |
      AC2/AC3 require correctly deciding whether a post-hit total is "21 or under" versus "over
      21"; standard blackjack ace handling (11, dropping to 1 to avoid busting) is the minimal
      correct way to compute that total, isolated in its own module so `HandStateMachine` doesn't
      own card-value rules.
  - description: |
      Add the state machine, `src/game/handStateMachine.ts`:

      ```ts
      import type { Card } from "./card.ts";
      import { handTotal } from "./card.ts";

      export type HandState = "new" | "player-turn" | "bust" | "dealer-turn" | "outcome" | "complete";
      export type PlayerAction = "hit" | "stand" | "double-down";

      export interface DealtCard extends Card {
        faceUp: boolean;
      }

      export interface CardSource {
        draw(): Card;
      }

      export class IllegalActionError extends Error {}

      export class HandStateMachine {
        private state: HandState = "new";
        private playerCards: DealtCard[] = [];
        private dealerCards: DealtCard[] = [];

        constructor(private readonly cardSource: CardSource) {}

        getState(): HandState {
          return this.state;
        }

        getPlayerCards(): readonly DealtCard[] {
          return this.playerCards;
        }

        getDealerCards(): readonly DealtCard[] {
          return this.dealerCards;
        }

        deal(): void {
          this.playerCards = [this.draw(true), this.draw(true)];
          this.dealerCards = [this.draw(true), this.draw(false)];
          this.state = "player-turn";
        }

        hit(): void {
          this.assertPlayerTurn("hit");
          this.playerCards.push(this.draw(true));
          if (handTotal(this.playerCards) > 21) {
            this.state = "bust";
          }
        }

        stand(): void {
          this.assertPlayerTurn("stand");
          this.state = "dealer-turn";
        }

        doubleDown(): void {
          this.assertPlayerTurn("double-down");
          this.playerCards.push(this.draw(true));
          this.state = "dealer-turn";
        }

        completeDealerTurn(): void {
          if (this.state !== "dealer-turn") {
            throw new IllegalActionError(`cannot complete dealer turn while in state "${this.state}"`);
          }
          this.state = "outcome";
        }

        resolveOutcome(): void {
          if (this.state !== "outcome") {
            throw new IllegalActionError(`cannot resolve outcome while in state "${this.state}"`);
          }
          this.state = "complete";
        }

        private draw(faceUp: boolean): DealtCard {
          return { ...this.cardSource.draw(), faceUp };
        }

        private assertPlayerTurn(action: PlayerAction): void {
          if (this.state !== "player-turn") {
            throw new IllegalActionError(`cannot ${action} while in state "${this.state}"`);
          }
        }
      }
      ```
    files:
      - "src/game/handStateMachine.ts"
    rationale: |
      Centralises every legal transition (`new -> player-turn`, `player-turn -> {player-turn |
      bust | dealer-turn}`, `dealer-turn -> outcome`, `outcome -> complete`) and the single guard
      (`assertPlayerTurn`) that rejects `hit`/`stand`/`double-down` in any other state, so illegal
      actions throw before any mutation happens - satisfying AC7 (rejected) and AC8 (state
      unchanged) with one code path instead of duplicating the check per method. Card dealing is
      delegated to an injected `CardSource` so this story stays decoupled from the not-yet-built
      RNG/shuffle deck.
tests:
  - |
    AC1 - deal transitions 'new' to 'player-turn' with 2 player cards and 2 dealer cards, one
    dealer card face-down:
    ```ts
    test("AC1: deal transitions to player-turn with 2 player cards and 2 dealer cards, one dealer card face-down", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
      hand.deal();
      assert.equal(hand.getState(), "player-turn");
      assert.equal(hand.getPlayerCards().length, 2);
      assert.equal(hand.getDealerCards().length, 2);
      assert.equal(hand.getDealerCards()[0].faceUp, true);
      assert.equal(hand.getDealerCards()[1].faceUp, false);
    });
    ```
  - |
    AC2 - a hit that keeps the total at 21 or under stays in 'player-turn':
    ```ts
    test("AC2: hit that keeps total at 21 or under stays in player-turn", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10", "8"]));
      hand.deal();
      hand.hit();
      assert.equal(hand.getState(), "player-turn");
    });
    ```
  - |
    AC3 - a hit that brings the total over 21 transitions to 'bust':
    ```ts
    test("AC3: hit that brings total over 21 transitions to bust", () => {
      const hand = new HandStateMachine(fixedCardSource(["10", "9", "2", "3", "5"]));
      hand.deal();
      hand.hit();
      assert.equal(hand.getState(), "bust");
    });
    ```
  - |
    AC4 - stand transitions 'player-turn' to 'dealer-turn':
    ```ts
    test("AC4: stand transitions player-turn to dealer-turn", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
      hand.deal();
      hand.stand();
      assert.equal(hand.getState(), "dealer-turn");
    });
    ```
  - |
    AC5 - double-down deals one additional card to the player:
    ```ts
    test("AC5: double-down deals one additional card to the player", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10", "7"]));
      hand.deal();
      hand.doubleDown();
      assert.equal(hand.getPlayerCards().length, 3);
    });
    ```
  - |
    AC6 - double-down transitions 'player-turn' to 'dealer-turn':
    ```ts
    test("AC6: double-down transitions player-turn to dealer-turn", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10", "7"]));
      hand.deal();
      hand.doubleDown();
      assert.equal(hand.getState(), "dealer-turn");
    });
    ```
  - |
    AC7 - a player action (hit, stand, or double-down) received outside 'player-turn' is
    rejected (throws):
    ```ts
    test("AC7: player actions are rejected outside player-turn", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
      assert.throws(() => hand.hit(), IllegalActionError);

      hand.deal();
      hand.stand();
      assert.throws(() => hand.hit(), IllegalActionError);
      assert.throws(() => hand.stand(), IllegalActionError);
      assert.throws(() => hand.doubleDown(), IllegalActionError);
    });
    ```
  - |
    AC8 - the state does not change when a player action is rejected:
    ```ts
    test("AC8: state does not change when a player action is rejected", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
      hand.deal();
      hand.stand();
      assert.equal(hand.getState(), "dealer-turn");
      assert.throws(() => hand.hit(), IllegalActionError);
      assert.equal(hand.getState(), "dealer-turn");
    });
    ```
  - |
    AC9 - dealer play completing moves 'dealer-turn' to 'outcome':
    ```ts
    test("AC9: completing dealer play moves dealer-turn to outcome", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
      hand.deal();
      hand.stand();
      hand.completeDealerTurn();
      assert.equal(hand.getState(), "outcome");
    });
    ```
  - |
    AC10 - resolving the outcome moves 'outcome' to 'complete':
    ```ts
    test("AC10: resolving the outcome moves outcome to complete", () => {
      const hand = new HandStateMachine(fixedCardSource(["5", "6", "9", "10"]));
      hand.deal();
      hand.stand();
      hand.completeDealerTurn();
      hand.resolveOutcome();
      assert.equal(hand.getState(), "complete");
    });
    ```
assumptions_or_open_questions:
  - |
    This story's ACs are phrased entirely in engine/domain terms (state transitions, action
    rejection) with no mention of a request, response, or endpoint - unlike the earlier Cart
    story where UI-screen ACs were explicitly translated into an HTTP contract. This plan
    therefore implements and tests `HandStateMachine` as a plain TypeScript class with unit
    tests only, NOT wired into `src/app.ts` or exposed over HTTP. Please confirm this is the
    intended scope, or point to where/how a hand should be exposed via the API.
  - |
    Card dealing is delegated to an injected `CardSource` interface (`draw(): Card`) rather than
    a real shuffled 52-card deck, since RNG/shuffle is called out as a separate item under the
    same "Core Game Engine" epic. Tests use a small fixed-sequence test double for
    `CardSource` defined in the test file itself.
  - |
    The actual dealer-play strategy (when the dealer hits vs. stands) and outcome computation
    (win/lose/push) are separate epic items. `completeDealerTurn()` and `resolveOutcome()` are
    implemented here purely as the state-transition trigger points AC9/AC10 describe, with no
    dealer-strategy or win/lose logic - future stories are expected to call these once their own
    logic decides the dealer is done / the outcome is computed.
  - |
    No AC specifies behaviour for calling `deal()` when the hand is not in the `new` state (e.g.
    re-dealing mid-hand), so `deal()` is left unguarded (always resets and deals). Flagging this
    in case the reviewer wants `deal()` restricted to the `new` state as well.
  - |
    Ace soft/hard total handling (ace = 11, dropping to 1 to avoid busting) is assumed as the
    correct rule for computing the "total" AC2/AC3 refer to, even though no AC mentions aces
    explicitly, since it's the standard Blackjack rule.
package_dependencies: []
notes: |
  Layering for the touched modules, plus how the new test drives them (no existing module is
  modified - this is a purely additive new `src/game/` domain package with no HTTP wiring):

  ```mermaid
  flowchart TD
    testFile["test/handStateMachine.test.ts (new)"]
    handStateMachine["src/game/handStateMachine.ts (new)"]
    card["src/game/card.ts (new)"]

    testFile -->|"drives HandStateMachine directly (unit test, no HTTP/app.ts involved)"| handStateMachine
    handStateMachine -->|"handTotal() to detect 21-or-under vs. bust"| card

    classDef touched fill:#f96,color:#000
    class testFile,handStateMachine,card touched
  ```
