export interface ProviderCancellationNotification {
  bookingId: string;
  providerId: string;
  notifiedAt: number;
}

export interface NotificationsGateway {
  notifyProviderOfCancellation(notification: ProviderCancellationNotification): void;
}

export class InMemoryNotificationsGateway implements NotificationsGateway {
  readonly notifications: ProviderCancellationNotification[] = [];

  notifyProviderOfCancellation(notification: ProviderCancellationNotification): void {
    this.notifications.push(notification);
  }
}
