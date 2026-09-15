import type { Transaction } from "../paymentsModel.ts";

export const testTransactions: Transaction[] = [
  {
    id: "txn-1",
    stripeChargeId: "ch_test_1",
    providerId: "user-provider-1",
    amount: 40,
    disbursementStatus: "pending_payout",
  },
];
