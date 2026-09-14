import crypto from "node:crypto";
import type { DocumentRecord, ScanStatus } from "./documentModel.ts";

export class DocumentRepository {
  private documentsById: Map<string, DocumentRecord> = new Map();

  create(
    providerId: string,
    fileName: string,
    contentType: string,
    content: Buffer,
    now: number = Date.now(),
  ): DocumentRecord {
    const doc: DocumentRecord = {
      id: crypto.randomUUID(),
      providerId,
      fileName,
      contentType,
      content,
      status: "pending_scan",
      uploadedAt: now,
    };
    this.documentsById.set(doc.id, doc);
    return doc;
  }

  findById(id: string): DocumentRecord | undefined {
    return this.documentsById.get(id);
  }

  listByProviderId(providerId: string): DocumentRecord[] {
    return [...this.documentsById.values()].filter((doc) => doc.providerId === providerId);
  }

  listReadyForReviewQueue(): DocumentRecord[] {
    return [...this.documentsById.values()].filter((doc) => doc.status === "ready");
  }

  updateStatus(id: string, status: ScanStatus): void {
    const doc = this.documentsById.get(id);
    if (doc) {
      doc.status = status;
    }
  }
}
