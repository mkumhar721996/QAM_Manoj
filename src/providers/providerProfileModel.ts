export type ProviderApplicationStatus = "pending" | "approved" | "rejected";

export interface ProviderProfile {
  providerId: string;
  status: ProviderApplicationStatus;
  businessName: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  updatedAt: number;
}
