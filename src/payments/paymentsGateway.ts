import type { CancellationOutcome } from "../bookings/cancellationPolicy.ts";

export interface CancellationOutcomeSignal {
  bookingId: string;
  customerId: string;
  outcome: CancellationOutcome;
  signalledAt: number;
}

export interface PaymentsGateway {
  signalCancellationOutcome(signal: CancellationOutcomeSignal): void;
}

export class InMemoryPaymentsGateway implements PaymentsGateway {
  readonly signals: CancellationOutcomeSignal[] = [];

  signalCancellationOutcome(signal: CancellationOutcomeSignal): void {
    this.signals.push(signal);
  }
}
