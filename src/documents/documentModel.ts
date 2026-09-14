export type ScanStatus = "pending_scan" | "ready" | "failed";

export interface DocumentRecord {
  id: string;
  providerId: string;
  fileName: string;
  contentType: string;
  content: Buffer;
  status: ScanStatus;
  uploadedAt: number;
}

export function toStatusLabel(status: ScanStatus): string {
  switch (status) {
    case "pending_scan":
      return "pending scan";
    case "ready":
      return "ready";
    case "failed":
      return "failed — file could not be verified";
  }
}
