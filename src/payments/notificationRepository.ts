export type NotificationRecipientRole = "admin" | "provider";

export interface Notification {
  recipientRole: NotificationRecipientRole;
  recipientId: string;
  chargebackId: string;
  amount: number;
}

export class NotificationRepository {
  private notifications: Notification[] = [];

  save(notification: Notification): void {
    this.notifications.push(notification);
  }

  findByRecipientRole(role: NotificationRecipientRole): Notification[] {
    return this.notifications.filter((n) => n.recipientRole === role);
  }
}
