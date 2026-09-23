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

test("AC1: player bust emits a 'bust' settlement event regardless of dealer hand", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  service.resolve(hand(23, true), hand(19), 10);
  assert.equal(emitter.events.length, 1);
  assert.equal(emitter.events[0].outcome, "bust");
});

test("AC2: dealer bust and player not bust emits a 'win' settlement event", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(18), hand(24, true), 10);
  assert.equal(event.outcome, "win");
});

test("AC3: player total higher than dealer (neither bust) emits a 'win' settlement event", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(20), hand(18), 10);
  assert.equal(event.outcome, "win");
});

test("AC4: dealer total higher than player (neither bust) emits a 'loss' settlement event", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(17), hand(20), 10);
  assert.equal(event.outcome, "loss");
});

test("AC5: equal totals (neither bust) emits a 'push' settlement event", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(19), hand(19), 10);
  assert.equal(event.outcome, "push");
});

test("AC6: a natural blackjack win carries a 3:2 payout multiplier", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(21, false, true), hand(20), 10);
  assert.equal(event.outcome, "win");
  assert.equal(event.payoutMultiplier, 1.5);
});

test("AC7: a non-blackjack win carries a 1:1 payout multiplier", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(20), hand(18), 10);
  assert.equal(event.payoutMultiplier, 1);
});

test("AC8: the settlement event includes outcome type, payout multiplier, and bet amount", () => {
  const emitter = new RecordingEmitter();
  const service = new OutcomeResolutionService(emitter);
  const event = service.resolve(hand(20), hand(18), 25);
  assert.deepEqual(event, { outcome: "win", payoutMultiplier: 1, betAmount: 25 });
});
