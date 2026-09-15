import crypto from "node:crypto";
import type { DeliveryLogEntry, DeliveryStatus, NotificationType } from "./notificationModel.ts";

export class DeliveryLogRepository {
  private entries: DeliveryLogEntry[] = [];
  private pendingKeys: Set<string> = new Set();

  private pendingKey(notificationType: NotificationType, transactionId: string): string {
    return `${notificationType}:${transactionId}`;
  }

  /**
   * Atomically checks that no successful delivery is logged and no delivery is
   * already in flight for this notification, then marks one as in flight.
   * Must be called synchronously (no await in between) relative to any prior
   * check, otherwise concurrent callers could both pass the check.
   */
  tryReserve(notificationType: NotificationType, transactionId: string): boolean {
    if (this.hasSucceeded(notificationType, transactionId)) {
      return false;
    }
    const key = this.pendingKey(notificationType, transactionId);
    if (this.pendingKeys.has(key)) {
      return false;
    }
    this.pendingKeys.add(key);
    return true;
  }

  release(notificationType: NotificationType, transactionId: string): void {
    this.pendingKeys.delete(this.pendingKey(notificationType, transactionId));
  }

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
