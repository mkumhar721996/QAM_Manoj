import type { Slot } from "../slotModel.ts";

export const testSlots: Slot[] = [
  {
    id: "slot-1",
    providerId: "provider-approved-1",
    startTime: "2026-09-15T09:00:00.000Z",
    endTime: "2026-09-15T09:30:00.000Z",
    status: "available",
  },
  {
    id: "slot-2",
    providerId: "provider-approved-1",
    startTime: "2026-09-15T10:00:00.000Z",
    endTime: "2026-09-15T10:30:00.000Z",
    status: "available",
  },
  {
    id: "slot-3",
    providerId: "provider-approved-1",
    startTime: "2026-09-15T11:00:00.000Z",
    endTime: "2026-09-15T11:30:00.000Z",
    status: "confirmed",
  },
  {
    id: "slot-4",
    providerId: "provider-pending-1",
    startTime: "2026-09-15T09:00:00.000Z",
    endTime: "2026-09-15T09:30:00.000Z",
    status: "available",
  },
];
