export const DEFAULT_HOLD_DURATION_MS = 10 * 60 * 1000;

export class HoldConfigRepository {
  private holdDurationMs: number;

  constructor(holdDurationMs: number = DEFAULT_HOLD_DURATION_MS) {
    this.holdDurationMs = holdDurationMs;
  }

  getHoldDurationMs(): number {
    return this.holdDurationMs;
  }

  setHoldDurationMs(ms: number): void {
    this.holdDurationMs = ms;
  }
}
