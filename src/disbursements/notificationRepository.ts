import type { Notification, RecoveryTask } from "./disbursementModel.ts";

export class NotificationRepository {
  private notifications: Notification[] = [];
  private recoveryTasks: RecoveryTask[] = [];

  notifyAdmin(bookingId: string, message: string, now: number = Date.now()): void {
    this.notifications.push({ timestamp: now, recipient: "admin", bookingId, message });
  }

  notifyProvider(bookingId: string, message: string, now: number = Date.now()): void {
    this.notifications.push({ timestamp: now, recipient: "provider", bookingId, message });
  }

  createRecoveryTask(bookingId: string, providerId: string, reason: string, now: number = Date.now()): void {
    this.recoveryTasks.push({ bookingId, providerId, createdAt: now, reason });
  }

  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  getRecoveryTasks(): RecoveryTask[] {
    return [...this.recoveryTasks];
  }
}
