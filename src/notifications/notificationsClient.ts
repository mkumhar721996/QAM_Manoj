import type { Booking } from "../bookings/bookingModel.ts";

export interface NoShowNotification {
  bookingId: string;
  recipient: "customer" | "provider";
  sentAt: number;
  payload: Record<string, unknown>;
}

export interface NotificationsClient {
  notifyCustomerNoShow(booking: Booking, now: number): void;
  notifyProviderNoShow(booking: Booking, now: number): void;
}

export class InMemoryNotificationsClient implements NotificationsClient {
  sent: NoShowNotification[] = [];

  notifyCustomerNoShow(booking: Booking, now: number): void {
    this.sent.push({
      bookingId: booking.id,
      recipient: "customer",
      sentAt: now,
      payload: {
        service: booking.service,
        appointmentTime: booking.appointmentTime,
        financialOutcome: booking.financialOutcome,
      },
    });
  }

  notifyProviderNoShow(booking: Booking, now: number): void {
    this.sent.push({
      bookingId: booking.id,
      recipient: "provider",
      sentAt: now,
      payload: {
        bookingId: booking.id,
        customerId: booking.customerId,
        service: booking.service,
        appointmentTime: booking.appointmentTime,
        financialOutcome: booking.financialOutcome,
      },
    });
  }
}
