export interface NotificationRecord {
  userId: string;
  message: string;
  sentAt: number;
}

export class NotificationService {
  private notificationsByUserId: Map<string, NotificationRecord[]> = new Map();

  notify(userId: string, message: string, now: number = Date.now()): void {
    const record: NotificationRecord = { userId, message, sentAt: now };
    const existing = this.notificationsByUserId.get(userId) ?? [];
    existing.push(record);
    this.notificationsByUserId.set(userId, existing);
    console.log(`notification sent to userId=${userId}: ${message}`);
  }

  getNotificationsForUser(userId: string): NotificationRecord[] {
    return this.notificationsByUserId.get(userId) ?? [];
  }
}
