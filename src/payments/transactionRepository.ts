import { testTransactions } from "./fixtures/testTransactions.ts";
import type { Transaction } from "./paymentsModel.ts";

export class TransactionRepository {
  private transactionsByChargeId: Map<string, Transaction>;

  constructor(transactions: Transaction[] = testTransactions) {
    this.transactionsByChargeId = new Map(transactions.map((t) => [t.stripeChargeId, t]));
  }

  findByStripeChargeId(chargeId: string): Transaction | undefined {
    return this.transactionsByChargeId.get(chargeId);
  }
}
