import type { DocumentRepository } from "./documentRepository.ts";
import type { MalwareScanner } from "./malwareScanner.ts";
import type { DocumentRecord } from "./documentModel.ts";

export const ACCEPTED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export class UnsupportedFileFormatError extends Error {
  constructor() {
    super("Only PDF, JPG, and PNG files are accepted");
  }
}

export class DocumentAccessDeniedError extends Error {}

export class DocumentService {
  private repository: DocumentRepository;
  private scanner: MalwareScanner;

  constructor(repository: DocumentRepository, scanner: MalwareScanner) {
    this.repository = repository;
    this.scanner = scanner;
  }

  upload(
    providerId: string,
    fileName: string,
    contentType: string,
    content: Buffer,
    now: number = Date.now(),
  ): DocumentRecord {
    if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
      throw new UnsupportedFileFormatError();
    }

    const doc = this.repository.create(providerId, fileName, contentType, content, now);
    void this.scanner
      .scan({ buffer: content, fileName })
      .then((result) => {
        this.repository.updateStatus(doc.id, result === "clean" ? "ready" : "failed");
      })
      .catch((err) => {
        console.error(`malware scan failed for document ${doc.id}:`, err);
        this.repository.updateStatus(doc.id, "failed");
      });
    return doc;
  }

  listForProvider(providerId: string): DocumentRecord[] {
    return this.repository.listByProviderId(providerId);
  }

  listReviewQueue(): DocumentRecord[] {
    return this.repository.listReadyForReviewQueue();
  }

  getContentForProvider(documentId: string, requestingProviderId: string): DocumentRecord {
    const doc = this.repository.findById(documentId);
    if (!doc || doc.providerId !== requestingProviderId) {
      throw new DocumentAccessDeniedError();
    }
    return doc;
  }

  getContentForAdmin(documentId: string): DocumentRecord {
    const doc = this.repository.findById(documentId);
    if (!doc || doc.status !== "ready") {
      throw new DocumentAccessDeniedError();
    }
    return doc;
  }
}
