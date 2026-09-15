import crypto from "node:crypto";
import type { DeliveryLogEntry, DeliveryStatus, NotificationType } from "./notificationModel.ts";

export class DeliveryLogRepository {
  private entries: DeliveryLogEntry[] = [];

  private record(
    notificationType: NotificationType,
    transactionId: string,
    recipientEmail: string,
    status: DeliveryStatus,
    now: number,
  ): DeliveryLogEntry {
    const entry: DeliveryLogEntry = {
      id: crypto.randomUUID(),
      notificationType,
      transactionId,
      recipientEmail,
      status,
      timestamp: now,
    };
    this.entries.push(entry);
    return entry;
  }

  recordSent(
    notificationType: NotificationType,
    transactionId: string,
    recipientEmail: string,
    now: number = Date.now(),
  ): DeliveryLogEntry {
    return this.record(notificationType, transactionId, recipientEmail, "sent", now);
  }

  recordPermanentlyFailed(
    notificationType: NotificationType,
    transactionId: string,
    recipientEmail: string,
    now: number = Date.now(),
  ): DeliveryLogEntry {
    return this.record(notificationType, transactionId, recipientEmail, "permanently_failed", now);
  }

  hasSucceeded(notificationType: NotificationType, transactionId: string): boolean {
    return this.entries.some(
      (e) => e.notificationType === notificationType && e.transactionId === transactionId && e.status === "sent",
    );
  }

  getAll(): DeliveryLogEntry[] {
    return this.entries;
  }
}
