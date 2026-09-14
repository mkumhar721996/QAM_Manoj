import type { DocumentService } from "./documentService.ts";
import { DocumentAccessDeniedError, UnsupportedFileFormatError } from "./documentService.ts";
import { toStatusLabel } from "./documentModel.ts";
import type { DocumentRecord } from "./documentModel.ts";
import { authenticateBearerToken } from "../auth/authGuard.ts";

export interface ControllerResponse {
  status: number;
  body?: Record<string, unknown>;
}

export interface DownloadControllerResponse extends ControllerResponse {
  fileBuffer?: Buffer;
  contentType?: string;
  fileName?: string;
}

function toDocumentView(doc: DocumentRecord): Record<string, unknown> {
  return {
    id: doc.id,
    file_name: doc.fileName,
    uploaded_at: new Date(doc.uploadedAt).toISOString(),
    status: toStatusLabel(doc.status),
  };
}

export function handleUploadDocument(
  service: DocumentService,
  input: { authorizationHeader?: string; contentType?: string; fileName?: string; body: Buffer },
): ControllerResponse {
  const payload = authenticateBearerToken(input.authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }
  if (payload.role !== "provider") {
    return { status: 403, body: { error: "only providers may upload documents" } };
  }
  if (!input.fileName || !input.contentType) {
    return { status: 400, body: { error: "X-File-Name and Content-Type headers are required" } };
  }

  try {
    const doc = service.upload(payload.userId, input.fileName, input.contentType, input.body);
    return { status: 202, body: toDocumentView(doc) };
  } catch (err) {
    if (err instanceof UnsupportedFileFormatError) {
      return { status: 400, body: { error: err.message } };
    }
    throw err;
  }
}

export function handleListDocuments(service: DocumentService, authorizationHeader?: string): ControllerResponse {
  const payload = authenticateBearerToken(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }
  if (payload.role !== "provider") {
    return { status: 403, body: { error: "only providers may list their documents" } };
  }

  const documents = service.listForProvider(payload.userId).map(toDocumentView);
  return { status: 200, body: { documents } };
}

export function handleReviewQueue(service: DocumentService, authorizationHeader?: string): ControllerResponse {
  const payload = authenticateBearerToken(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }
  if (payload.role !== "admin") {
    return { status: 403, body: { error: "only admins may view the review queue" } };
  }

  const documents = service.listReviewQueue().map(toDocumentView);
  return { status: 200, body: { documents } };
}

export function handleDownloadDocument(
  service: DocumentService,
  authorizationHeader: string | undefined,
  documentId: string,
): DownloadControllerResponse {
  const payload = authenticateBearerToken(authorizationHeader);
  if (!payload) {
    return { status: 401, body: { error: "missing or malformed authorization header" } };
  }

  try {
    const doc =
      payload.role === "admin"
        ? service.getContentForAdmin(documentId)
        : service.getContentForProvider(documentId, payload.userId);
    return { status: 200, fileBuffer: doc.content, contentType: doc.contentType, fileName: doc.fileName };
  } catch (err) {
    if (err instanceof DocumentAccessDeniedError) {
      return { status: 404, body: { error: "not found" } };
    }
    throw err;
  }
}
