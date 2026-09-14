import crypto from "node:crypto";
import type { ApplicationRepository } from "./applicationRepository.ts";
import type { DocumentScanner } from "./documentScanner.ts";
import type { EmailService } from "../notifications/emailService.ts";
import type { ApplicationDocument, ProviderApplication } from "./applicationModel.ts";

export class ApplicationNotFoundError extends Error {}
export class ApplicationNotResubmittableError extends Error {}
export class DocumentInfectedError extends Error {
  constructor(fileName: string) {
    super(`Document "${fileName}" failed malware scanning`);
  }
}

export interface ResubmitApplicationInput {
  profile?: Record<string, unknown>;
  newDocuments?: Array<{ fileName: string; contentBase64: string }>;
}

export class ApplicationService {
  private applicationRepository: ApplicationRepository;
  private documentScanner: DocumentScanner;
  private emailService: EmailService;

  constructor(applicationRepository: ApplicationRepository, documentScanner: DocumentScanner, emailService: EmailService) {
    this.applicationRepository = applicationRepository;
    this.documentScanner = documentScanner;
    this.emailService = emailService;
  }

  async resubmit(
    applicationId: string,
    providerId: string,
    updates: ResubmitApplicationInput,
    now: number = Date.now(),
  ): Promise<ProviderApplication> {
    const application = this.applicationRepository.findById(applicationId);
    if (!application || application.providerId !== providerId) {
      throw new ApplicationNotFoundError();
    }
    if (application.status !== "rejected") {
      throw new ApplicationNotResubmittableError();
    }

    const scannedDocs: ApplicationDocument[] = [];
    for (const doc of updates.newDocuments ?? []) {
      const result = await this.documentScanner.scan(doc.fileName, doc.contentBase64);
      if (result === "infected") {
        throw new DocumentInfectedError(doc.fileName);
      }
      scannedDocs.push({ id: crypto.randomUUID(), fileName: doc.fileName, scanStatus: "clean", uploadedAt: now });
    }

    application.profile = { ...application.profile, ...updates.profile };
    application.documents = [...application.documents, ...scannedDocs];
    application.status = "submitted";
    application.updatedAt = now;
    application.history.push({
      iterationNumber: application.history.length + 1,
      submittedAt: now,
      profileSnapshot: application.profile,
      documentIds: application.documents.map((d) => d.id),
      status: "submitted",
    });

    this.applicationRepository.save(application);
    await this.emailService.send(
      application.providerEmail,
      "Your application is back under review",
      "We've received your corrected application and it is now under review.",
    );
    return application;
  }
}
