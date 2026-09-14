export type BookingStatus = "confirmed" | "cancelled" | "completed";

export interface RescheduleEvent {
  timestamp: number;
  actingUserId: string;
  previousStartTime: number;
  newStartTime: number;
}

export interface Booking {
  id: string;
  customerId: string;
  providerId: string;
  startTime: number;
  endTime: number;
  status: BookingStatus;
  cancellationPolicyWindowStart: number;
  rescheduleHistory: RescheduleEvent[];
}
