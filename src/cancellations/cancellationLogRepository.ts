import crypto from "node:crypto";
import type { CancellationLogEntry } from "./cancellationModel.ts";

export class CancellationLogRepository {
  private entriesByBookingId: Map<string, CancellationLogEntry[]> = new Map();

  add(entry: Omit<CancellationLogEntry, "id">): CancellationLogEntry {
    const logEntry: CancellationLogEntry = { ...entry, id: crypto.randomUUID() };
    const entries = this.entriesByBookingId.get(entry.bookingId) ?? [];
    entries.push(logEntry);
    this.entriesByBookingId.set(entry.bookingId, entries);
    return logEntry;
  }

  findByBookingId(bookingId: string): CancellationLogEntry[] {
    return this.entriesByBookingId.get(bookingId) ?? [];
  }
}
