export interface NotificationService {
  sendBookingConfirmationEmail(customerId: string, bookingId: string): Promise<void>;
  sendBookingConfirmationSms(customerId: string, bookingId: string): Promise<void>;
}

export class LoggingNotificationService implements NotificationService {
  async sendBookingConfirmationEmail(customerId: string, bookingId: string): Promise<void> {
    console.log(`booking confirmation email sent to customerId=${customerId} for bookingId=${bookingId}`);
  }

  async sendBookingConfirmationSms(customerId: string, bookingId: string): Promise<void> {
    console.log(`booking confirmation sms sent to customerId=${customerId} for bookingId=${bookingId}`);
  }
}
