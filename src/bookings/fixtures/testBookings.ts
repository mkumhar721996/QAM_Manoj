import type { Booking } from "../bookingModel.ts";

export const testBookings: Booking[] = [
  {
    id: "booking-1",
    customerId: "user-customer-1",
    providerId: "user-provider-1",
    status: "completed",
    appointmentTime: Date.parse("2024-03-10T14:00:00Z"),
  },
  {
    id: "booking-2",
    customerId: "user-customer-1",
    providerId: "user-provider-1",
    status: "cancelled",
    appointmentTime: Date.parse("2024-04-01T09:30:00Z"),
  },
  {
    id: "booking-old",
    customerId: "user-customer-1",
    providerId: "user-provider-1",
    status: "completed",
    appointmentTime: Date.now() - 5 * 365 * 24 * 60 * 60 * 1000,
  },
  {
    id: "booking-3",
    customerId: "user-customer-2",
    providerId: "user-provider-2",
    status: "completed",
    appointmentTime: Date.parse("2024-05-20T11:00:00Z"),
  },
];
