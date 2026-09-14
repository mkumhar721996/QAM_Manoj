export type ApplicationStatus = "submitted" | "rejected" | "approved";
export type ScanStatus = "pending" | "clean" | "infected";

export interface ApplicationDocument {
  id: string;
  fileName: string;
  scanStatus: ScanStatus;
  uploadedAt: number;
}

export interface ReviewIteration {
  iterationNumber: number;
  submittedAt: number;
  profileSnapshot: Record<string, unknown>;
  documentIds: string[];
  status: ApplicationStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: number;
}

export interface ProviderApplication {
  id: string;
  providerId: string;
  providerEmail: string;
  status: ApplicationStatus;
  profile: Record<string, unknown>;
  documents: ApplicationDocument[];
  history: ReviewIteration[];
  createdAt: number;
  updatedAt: number;
}
