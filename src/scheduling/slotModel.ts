export type SlotStatus = "available" | "held" | "confirmed";

export interface Slot {
  id: string;
  providerId: string;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  heldByCustomerId?: string;
  holdExpiresAt?: number;
}
