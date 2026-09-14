export type SlotStatus = "available" | "held" | "booked";

export interface Slot {
  id: string;
  providerId: string;
  providerName: string;
  date: string;
  time: string;
  status: SlotStatus;
}
