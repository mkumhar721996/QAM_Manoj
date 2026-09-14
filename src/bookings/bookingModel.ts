export type BookingStatus = "confirmed" | "cancelled";

export interface Booking {
  id: string;
  customerId: string;
  providerId: string;
  appointmentAt: number;
  status: BookingStatus;
  cancelledAt?: number;
  cancelledBy?: string;
}
