export interface Invoice {
  invoiceNumber: string;
  bookingId: string;
  customerId: string;
  providerId: string;
  amount: number;
  issuedAt: string;
}

export const testInvoices: Invoice[] = [
  {
    invoiceNumber: "INV-1001",
    bookingId: "booking-1",
    customerId: "user-customer-1",
    providerId: "user-provider-1",
    amount: 120.0,
    issuedAt: "2026-08-01T10:00:00.000Z",
  },
  {
    invoiceNumber: "INV-1002",
    bookingId: "booking-2",
    customerId: "user-customer-1",
    providerId: "user-provider-1",
    amount: 75.5,
    issuedAt: "2026-08-05T14:30:00.000Z",
  },
  {
    invoiceNumber: "INV-2001",
    bookingId: "booking-3",
    customerId: "user-customer-2",
    providerId: "user-provider-2",
    amount: 60.0,
    issuedAt: "2026-08-10T09:00:00.000Z",
  },
];
