import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { UserRepository } from "./users/userRepository.ts";
import { SessionRepository } from "./sessions/sessionRepository.ts";
import { AuthService } from "./auth/authService.ts";
import { handleGetSession, handleLogin, handleLogout, handleRefresh } from "./auth/authController.ts";
import { PayloadTooLargeError, readJsonBody, readRawBody, sendJson } from "./httpUtils.ts";
import { DocumentRepository } from "./documents/documentRepository.ts";
import { StubMalwareScanner } from "./documents/malwareScanner.ts";
import type { MalwareScanner } from "./documents/malwareScanner.ts";
import { DocumentService, MAX_DOCUMENT_SIZE_BYTES } from "./documents/documentService.ts";
import {
  handleDownloadDocument,
  handleListDocuments,
  handleReviewQueue,
  handleUploadDocument,
} from "./documents/documentController.ts";

export interface AppDependencies {
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  documentRepository?: DocumentRepository;
  malwareScanner?: MalwareScanner;
}

export interface App {
  requestListener: RequestListener;
}

const DOCUMENT_CONTENT_ROUTE = /^\/documents\/([^/]+)\/content$/;

export function createApp(deps: AppDependencies = {}): App {
  const userRepository = deps.userRepository ?? new UserRepository();
  const sessionRepository = deps.sessionRepository ?? new SessionRepository();
  const documentRepository = deps.documentRepository ?? new DocumentRepository();
  const malwareScanner = deps.malwareScanner ?? new StubMalwareScanner();
  const authService = new AuthService(userRepository, sessionRepository);
  const documentService = new DocumentService(documentRepository, malwareScanner);

  const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, authService, documentService);
  };

  return { requestListener };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authService: AuthService,
  documentService: DocumentService,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${method} ${url.pathname}`;
  const contentMatch = method === "GET" ? url.pathname.match(DOCUMENT_CONTENT_ROUTE) : null;

  try {
    if (route === "GET /auth/session") {
      const result = handleGetSession(req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (contentMatch) {
      const result = handleDownloadDocument(documentService, req.headers.authorization, contentMatch[1]);
      if (result.fileBuffer) {
        res.writeHead(result.status, {
          "Content-Type": result.contentType ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${result.fileName}"`,
          "Content-Length": result.fileBuffer.length,
        });
        res.end(result.fileBuffer);
        return;
      }
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /documents") {
      const result = handleListDocuments(documentService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "GET /admin/documents") {
      const result = handleReviewQueue(documentService, req.headers.authorization);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /documents") {
      const rawBody = await readRawBody(
        req,
        MAX_DOCUMENT_SIZE_BYTES,
        `File exceeds the ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB size limit`,
      );
      const result = handleUploadDocument(documentService, {
        authorizationHeader: req.headers.authorization,
        contentType: req.headers["content-type"],
        fileName: req.headers["x-file-name"] as string | undefined,
        body: rawBody,
      });
      sendJson(res, result.status, result.body);
      return;
    }

    if (route !== "POST /auth/login" && route !== "POST /auth/refresh" && route !== "POST /auth/logout") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const body = await readJsonBody(req);

    if (route === "POST /auth/login") {
      const result = await handleLogin(authService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (route === "POST /auth/refresh") {
      const result = handleRefresh(authService, body);
      sendJson(res, result.status, result.body);
      return;
    }

    const result = handleLogout(authService, body);
    sendJson(res, result.status, result.body);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: err.message });
      return;
    }
    console.error(`unhandled error for ${route}:`, err);
    sendJson(res, 400, { error: "invalid request" });
  }
}
