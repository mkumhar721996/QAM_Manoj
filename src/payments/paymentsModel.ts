export type DisbursementStatus = "pending_payout" | "disbursed";

export interface Transaction {
  id: string;
  stripeChargeId: string;
  providerId: string;
  amount: number;
  disbursementStatus: DisbursementStatus;
}

export type PayoutStatus = "pending" | "held" | "clawed_back";

export interface Payout {
  id: string;
  providerId: string;
  amount: number;
  status: PayoutStatus;
  createdAt: number;
}

export type ReversalAction = "clawback_from_pending_payout" | "hold_future_payouts" | "direct_clawback";

export interface ChargebackWebhookEvent {
  id: string;
  stripeChargeId: string;
  amount: number;
}

export interface ChargebackReversal {
  chargebackId: string;
  transactionId: string;
  providerId: string;
  amount: number;
  action: ReversalAction;
  createdAt: number;
}
