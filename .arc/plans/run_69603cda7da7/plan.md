summary: |
  This repo (`qam-manoj-story-007-login-session-management`) currently implements a headless
  Node `http` API for a pizza-ordering flow only: `auth/`, `sessions/`, `users/`, `pizzas/`, and
  `cart/` modules, each following a repository -> service -> controller layering, in-memory
  `Map`-backed repositories, snake_case JSON wire format, and `node:test` + raw `fetch` against an
  ephemeral `startTestServer()`. There is NO Blackjack domain anywhere in this codebase yet - no
  hand model, no dealer logic, no bust/total computation, and no Wallet & Betting layer. This story
  (Outcome Resolution) is the first slice of the "Core Game Engine" epic to land, so this plan adds
  a brand-new, self-contained `src/game/` module: an `OutcomeResolutionService` that takes
  already-computed player/dealer `HandResult`s (total, bust flag, blackjack flag) and a bet amount,
  applies the win/loss/push/bust rules and the 3:2 / 1:1 payout-multiplier rule, and emits a
  `SettlementEvent` through an injectable `SettlementEmitter` seam that the (not-yet-built) Wallet &
  Betting layer will implement. Since no hand state machine, dealer logic, or HTTP surface for this
  story exists or is implied by the acceptance criteria, this is implemented and tested as a plain
  unit-tested TypeScript module, not wired into `src/app.ts`.
scope:
  - description: |
      Write the failing unit tests first, one per acceptance criterion, against the
      not-yet-existing `OutcomeResolutionService`. These must fail with a module-not-found error
      before any implementation exists.

      ```ts
      // test/outcomeResolution.test.ts
      import { test } from "node:test";
      import assert from "node:assert/strict";
      import { OutcomeResolutionService } from "../src/game/outcomeResolutionService.ts";
      import type { HandResult, SettlementEvent } from "../src/game/outcomeModel.ts";

      class RecordingEmitter {
        events: SettlementEvent[] = [];
        emit(event: SettlementEvent): void {
          this.events.push(event);
        }
      }

      function hand(total: number, isBust = false, isBlackjack = false): HandResult {
        return { total, isBust, isBlackjack };
      }
      ```
    files:
      - "test/outcomeResolution.test.ts"
    rationale: |
      Establishes the test-first contract for the whole feature before writing any production
      code, matching the existing `test/*.test.ts` convention of asserting behaviour end-to-end
      (here: constructing the service, calling `resolve()`, and inspecting both the returned
      event and what was passed to the injected emitter) rather than testing internals.
  - description: |
      Add the domain types for this module: the hand-result shape this story consumes, the
      outcome/settlement-event shapes it produces, and the emitter seam it calls out to.

      ```ts
      // src/game/outcomeModel.ts
      export interface HandResult {
        total: number;
        isBust: boolean;
        isBlackjack: boolean;
      }

      export type OutcomeType = "win" | "loss" | "push" | "bust";

      export interface SettlementEvent {
        outcome: OutcomeType;
        payoutMultiplier: number;
        betAmount: number;
      }

      export interface SettlementEmitter {
        emit(event: SettlementEvent): void;
      }
      ```
    files:
      - "src/game/outcomeModel.ts"
    rationale: |
      AC8 requires the settlement event to carry outcome type, payout multiplier, and bet amount
      - this is the source-of-truth shape for that event. `HandResult` is the minimal input this
      story needs from the (not-yet-built) hand state machine/dealer logic stories in the same
      epic. `SettlementEmitter` is the seam the (not-yet-built) Wallet & Betting layer will
      implement, mirroring how `CartService` depends on injected repository interfaces rather
      than concrete infra.
  - description: |
      Add `OutcomeResolutionService` implementing the win/loss/push/bust rules and the
      blackjack payout multiplier, then call the injected emitter with the resulting event.

      ```ts
      // src/game/outcomeResolutionService.ts
      import type { HandResult, SettlementEmitter, SettlementEvent } from "./outcomeModel.ts";

      const BLACKJACK_MULTIPLIER = 1.5;
      const STANDARD_WIN_MULTIPLIER = 1;
      const NO_PAYOUT_MULTIPLIER = 0;
      const PUSH_MULTIPLIER = 1;

      export class OutcomeResolutionService {
        constructor(private settlementEmitter: SettlementEmitter) {}

        resolve(player: HandResult, dealer: HandResult, betAmount: number): SettlementEvent {
          const event = this.determineSettlement(player, dealer, betAmount);
          this.settlementEmitter.emit(event);
          return event;
        }

        private determineSettlement(player: HandResult, dealer: HandResult, betAmount: number): SettlementEvent {
          if (player.isBust) {
            return { outcome: "bust", payoutMultiplier: NO_PAYOUT_MULTIPLIER, betAmount };
          }
          if (dealer.isBust) {
            return { outcome: "win", payoutMultiplier: this.winMultiplier(player), betAmount };
          }
          if (player.total > dealer.total) {
            return { outcome: "win", payoutMultiplier: this.winMultiplier(player), betAmount };
          }
          if (dealer.total > player.total) {
            return { outcome: "loss", payoutMultiplier: NO_PAYOUT_MULTIPLIER, betAmount };
          }
          return { outcome: "push", payoutMultiplier: PUSH_MULTIPLIER, betAmount };
        }

        private winMultiplier(player: HandResult): number {
          return player.isBlackjack ? BLACKJACK_MULTIPLIER : STANDARD_WIN_MULTIPLIER;
        }
      }
      ```
    files:
      - "src/game/outcomeResolutionService.ts"
    rationale: |
      Centralises every branch from AC1-AC7 in one pure decision function
      (`determineSettlement`), with bust checked first regardless of the dealer's hand (AC1),
      then dealer-bust (AC2), then total comparison (AC3/AC4/AC5), and the blackjack multiplier
      factored into a single `winMultiplier()` helper shared by both win branches (AC6/AC7) so
      the 3:2 vs 1:1 rule can't drift between them.
tests:
  - |
    AC1 - GIVEN the player is bust WHEN outcome is resolved THEN a 'bust' settlement event is
    emitted, regardless of the dealer's hand.
    ```ts
    test("AC1: player bust emits a 'bust' settlement event regardless of dealer hand", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      service.resolve(hand(23, true), hand(19), 10);
      assert.equal(emitter.events.length, 1);
      assert.equal(emitter.events[0].outcome, "bust");
    });
    ```
  - |
    AC2 - GIVEN the dealer is bust and the player is not bust WHEN outcome is resolved THEN a
    'win' settlement event is emitted.
    ```ts
    test("AC2: dealer bust and player not bust emits a 'win' settlement event", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(18), hand(24, true), 10);
      assert.equal(event.outcome, "win");
    });
    ```
  - |
    AC3 - GIVEN neither player nor dealer is bust WHEN the player's total is higher than the
    dealer's THEN a 'win' settlement event is emitted.
    ```ts
    test("AC3: player total higher than dealer (neither bust) emits a 'win' settlement event", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(20), hand(18), 10);
      assert.equal(event.outcome, "win");
    });
    ```
  - |
    AC4 - GIVEN neither player nor dealer is bust WHEN the dealer's total is higher than the
    player's THEN a 'loss' settlement event is emitted.
    ```ts
    test("AC4: dealer total higher than player (neither bust) emits a 'loss' settlement event", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(17), hand(20), 10);
      assert.equal(event.outcome, "loss");
    });
    ```
  - |
    AC5 - GIVEN neither player nor dealer is bust WHEN both totals are equal THEN a 'push'
    settlement event is emitted.
    ```ts
    test("AC5: equal totals (neither bust) emits a 'push' settlement event", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(19), hand(19), 10);
      assert.equal(event.outcome, "push");
    });
    ```
  - |
    AC6 - GIVEN a natural Blackjack win WHEN the settlement event is emitted THEN it carries a
    3:2 payout multiplier.
    ```ts
    test("AC6: a natural blackjack win carries a 3:2 payout multiplier", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(21, false, true), hand(20), 10);
      assert.equal(event.outcome, "win");
      assert.equal(event.payoutMultiplier, 1.5);
    });
    ```
  - |
    AC7 - GIVEN any other win WHEN the settlement event is emitted THEN it carries a 1:1 payout
    multiplier.
    ```ts
    test("AC7: a non-blackjack win carries a 1:1 payout multiplier", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(20), hand(18), 10);
      assert.equal(event.payoutMultiplier, 1);
    });
    ```
  - |
    AC8 - GIVEN outcome is resolved WHEN the settlement event is emitted THEN it includes the
    outcome type, payout multiplier, and the original bet amount.
    ```ts
    test("AC8: the settlement event includes outcome type, payout multiplier, and bet amount", () => {
      const emitter = new RecordingEmitter();
      const service = new OutcomeResolutionService(emitter);
      const event = service.resolve(hand(20), hand(18), 25);
      assert.deepEqual(event, { outcome: "win", payoutMultiplier: 1, betAmount: 25 });
    });
    ```
assumptions_or_open_questions:
  - "No Wallet & Betting layer exists anywhere in this codebase yet. This plan implements outcome resolution as a self-contained `src/game/` module that emits `SettlementEvent`s through an injectable `SettlementEmitter` interface. The concrete consumer (a real event bus, queue, or wallet service) is out of scope for this story and will implement this interface when it's built - please confirm this seam is the intended integration point."
  - "No hand state machine or dealer logic exists yet (both are separate stories in the same 'Core Game Engine' epic), so this plan accepts already-computed `HandResult` (`total`, `isBust`, `isBlackjack`) for player and dealer as direct inputs to `resolve()`, rather than computing hand totals, bust, or blackjack detection itself."
  - "Payout multiplier for non-win outcomes: bust and loss use `0` (player forfeits the bet - no AC specifies a numeric value here, only that a win carries 3:2 or 1:1), and push uses `1` (stake returned, breakeven). Please confirm this matches the numeric contract the Wallet & Betting layer will expect."
  - "Per AC5's literal wording, a push is any case of equal totals with neither side bust, with no blackjack exception - so a player natural blackjack (21 on 2 cards) that ties a dealer's non-blackjack 21 is treated as a push, not a win, even though some real Blackjack rule variants give blackjack precedence over a plain 21. Flagging this in case AC5 was meant to carry an implicit blackjack carve-out."
  - "No HTTP endpoint is specified or implied by any acceptance criterion, so this is implemented and tested as a plain unit-tested TypeScript module (`test/outcomeResolution.test.ts` calling `OutcomeResolutionService` directly), rather than through the existing HTTP-integration test style (`startTestServer` + `fetch`) used by every other test file in this codebase."
  - "`betAmount` is assumed to be a plain non-negative `number` already known and validated at resolution time - validating that a bet was actually placed/funded is assumed to belong to the (not-yet-built) Wallet & Betting layer, not this story."
package_dependencies: []
notes: |
  This plan is purely additive - it introduces two brand-new files (`src/game/outcomeModel.ts`,
  `src/game/outcomeResolutionService.ts`) with no existing module calling into them yet (no hand
  state machine or Wallet & Betting layer exists to wire them into), and does not modify
  `src/app.ts` or any existing route, repository, or service. A call-graph diagram was skipped per
  the "purely-additive, no real existing callers/edges" guidance - it would only show two isolated
  new nodes with no verified edges to existing code, which adds nothing beyond the file list above.

  Naming mirrors the existing `cart/` module's convention of a plain `*Model.ts` file for
  interfaces/types plus a `*Service.ts` file for behaviour (e.g. `cartModel.ts` + `cartService.ts`),
  and constructor-injects its one collaborator (`SettlementEmitter`) the same way `CartService`
  constructor-injects `PizzaRepository`/`CartRepository` - so a future story can supply a real
  Wallet & Betting emitter without changing this service's tests.
