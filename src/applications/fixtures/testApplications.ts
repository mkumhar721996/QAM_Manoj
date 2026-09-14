import type { ProviderApplication } from "../applicationModel.ts";

const SUBMITTED_AT = Date.parse("2026-08-01T09:00:00.000Z");
const REJECTED_AT = Date.parse("2026-08-05T14:30:00.000Z");

export const rejectedApplicationFixture: ProviderApplication = {
  id: "application-1",
  providerId: "user-provider-1",
  providerEmail: "provider1@example.com",
  status: "rejected",
  profile: { bio: "Original bio", specialty: "Physical Therapy" },
  documents: [{ id: "document-1", fileName: "license-original.pdf", scanStatus: "clean", uploadedAt: SUBMITTED_AT }],
  history: [
    {
      iterationNumber: 1,
      submittedAt: SUBMITTED_AT,
      profileSnapshot: { bio: "Original bio", specialty: "Physical Therapy" },
      documentIds: ["document-1"],
      status: "rejected",
      rejectionReason: "Missing malpractice insurance certificate",
      reviewedBy: "user-admin-1",
      reviewedAt: REJECTED_AT,
    },
  ],
  createdAt: SUBMITTED_AT,
  updatedAt: REJECTED_AT,
};

export const testApplications: ProviderApplication[] = [rejectedApplicationFixture];
