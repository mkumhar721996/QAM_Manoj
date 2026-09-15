import type { Invoice } from "./fixtures/testInvoices.ts";

export class InvoiceRepository {
  private invoicesByNumber: Map<string, Invoice>;

  constructor(invoices: Invoice[] = []) {
    this.invoicesByNumber = new Map(invoices.map((i) => [i.invoiceNumber, i]));
  }

  findByInvoiceNumber(invoiceNumber: string): Invoice | undefined {
    return this.invoicesByNumber.get(invoiceNumber);
  }
}
