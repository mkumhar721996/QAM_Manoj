export type BookingStatus = "completed" | "cancelled";

export interface Booking {
  id: string;
  customerId: string;
  providerId: string;
  status: BookingStatus;
  appointmentTime: number;
}
