import type { FinancialOutcome } from "../bookings/bookingModel.ts";

export interface NoShowFinancialSignal {
  bookingId: string;
  outcome: FinancialOutcome;
  signalledAt: number;
}

export interface PaymentsInvoicingClient {
  signalNoShowOutcome(signal: NoShowFinancialSignal): void;
}

export class InMemoryPaymentsInvoicingClient implements PaymentsInvoicingClient {
  signals: NoShowFinancialSignal[] = [];

  signalNoShowOutcome(signal: NoShowFinancialSignal): void {
    this.signals.push(signal);
  }
}
