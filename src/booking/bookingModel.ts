export type BookingStatus = "awaiting_confirmation" | "confirmed" | "pending_payment";

export interface BookingInput {
  customerId: string;
  amount: number;
  currency: string;
}

export interface Booking extends BookingInput {
  id: string;
  status: BookingStatus;
}
