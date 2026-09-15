export class InvoiceNumberSequence {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return `INV-${String(this.counter).padStart(5, "0")}`;
  }
}
