export type ApplicationState = "draft" | "submitted" | "under_review" | "approved" | "rejected";

export interface Application {
  id: string;
  providerId: string;
  state: ApplicationState;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
}

export const VALID_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["approved", "rejected"],
  approved: [],
  rejected: ["submitted"],
};

export const NOTIFIED_TRANSITIONS = new Set<string>([
  "submitted->under_review",
  "under_review->approved",
  "under_review->rejected",
]);
