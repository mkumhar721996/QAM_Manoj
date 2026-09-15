import type { Invoice } from "./invoiceModel.ts";

export class InvoiceRepository {
  private invoicesById: Map<string, Invoice> = new Map();
  private invoiceByPaymentCaptureId: Map<string, Invoice> = new Map();
  private invoicesByCustomerId: Map<string, Invoice[]> = new Map();

  save(invoice: Invoice): void {
    this.invoicesById.set(invoice.id, invoice);
    this.invoiceByPaymentCaptureId.set(invoice.paymentCaptureId, invoice);
    const list = this.invoicesByCustomerId.get(invoice.customerId) ?? [];
    list.push(invoice);
    this.invoicesByCustomerId.set(invoice.customerId, list);
  }

  findByPaymentCaptureId(paymentCaptureId: string): Invoice | undefined {
    return this.invoiceByPaymentCaptureId.get(paymentCaptureId);
  }

  findByCustomerId(customerId: string): Invoice[] {
    return this.invoicesByCustomerId.get(customerId) ?? [];
  }
}
