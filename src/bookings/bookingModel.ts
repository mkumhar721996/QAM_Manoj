export type BookingStatus = "confirmed" | "cancelled" | "noshow";

export interface FinancialOutcome {
  type: "fee" | "no_charge";
  amount: number;
  policyId?: string;
  policyVersion?: number;
}

export interface Booking {
  id: string;
  customerId: string;
  providerId: string;
  service: string;
  appointmentTime: number;
  policyId?: string;
  status: BookingStatus;
  cancellationConfirmedAt?: number;
  noShowDetectedAt?: number;
  financialOutcome?: FinancialOutcome;
}
